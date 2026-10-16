import { GCodeSegment } from './gcode.js';

export interface CollisionEvent {
  line: number;
  type: 'STOCK_CRASH' | 'VISE_CRASH' | 'SPINDLE_STALL' | 'SYNC_ERROR';
  description: string;
  part: string;
  cost: number;
  downtime: number;
  rootCause: string;
  position: { x: number; y: number; z: number };
}

export const ACADEMY_GEOMETRY = {
  table: { z: -60 },
  vise: { x: [-10, 90], y: [-15, 65], z: [-60, -10] },
  stock: { x: [0, 80], y: [0, 50], z: [-10, 0] }
};

export interface ModalState {
  spindleOn: boolean;
  toolLengthComp: boolean;
  tapMode: boolean;
  feed: number;
  rpm: number;
  pitch?: number;
  program?: string;
}

/**
 * Samples 3D points along a segment every stepSize mm (default 0.5mm).
 * Linear segments: interpolated from segment.from to segment.to.
 * Arc segments: interpolated around segment.center in the XY plane.
 */
export function sampleSegmentPoints(
  segment: GCodeSegment,
  stepSize: number = 0.5
): Array<{ x: number; y: number; z: number }> {
  const from = segment.from;
  const to = segment.to;

  if (!from || !to) {
    return [to || { x: 0, y: 0, z: 0 }];
  }

  if (segment.type === 'arc' && segment.center) {
    const cx = segment.center.x;
    const cy = segment.center.y;
    const rFrom = Math.hypot(from.x - cx, from.y - cy);
    const rTo = Math.hypot(to.x - cx, to.y - cy);
    const r = (rFrom + rTo) / 2 || rFrom || 1;

    const startAngle = Math.atan2(from.y - cy, from.x - cx);
    let endAngle = Math.atan2(to.y - cy, to.x - cx);

    let deltaAngle = endAngle - startAngle;
    if (Math.abs(deltaAngle) < 1e-6 && (from.x !== to.x || from.y !== to.y)) {
      deltaAngle = 2 * Math.PI;
    }

    const arcLength = Math.hypot(r * deltaAngle, to.z - from.z);
    const steps = Math.max(1, Math.ceil(arcLength / stepSize));
    const points: Array<{ x: number; y: number; z: number }> = [];

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const angle = startAngle + t * deltaAngle;
      points.push({
        x: cx + r * Math.cos(angle),
        y: cy + r * Math.sin(angle),
        z: from.z + t * (to.z - from.z),
      });
    }
    return points;
  }

  // Linear motion (rapid or feed)
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const dist = Math.hypot(dx, dy, dz);

  if (dist === 0) {
    return [{ ...to }];
  }

  const steps = Math.max(1, Math.ceil(dist / stepSize));
  const points: Array<{ x: number; y: number; z: number }> = [];

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    points.push({
      x: from.x + t * dx,
      y: from.y + t * dy,
      z: from.z + t * dz,
    });
  }

  return points;
}

export function checkCollision(
  segment: GCodeSegment,
  modalState: ModalState,
  options?: { program?: string; pitch?: number }
): CollisionEvent | null {
  const points = sampleSegmentPoints(segment, 0.5);

  // 1. Spindle Stall Check (M03 missing)
  if (!modalState.spindleOn && (segment.type === 'feed' || segment.type === 'arc')) {
    for (const pt of points) {
      if (pt.z < 2.0) {
        return {
          line: segment.line,
          type: 'SPINDLE_STALL',
          description: 'COLLISION DETECTED: SPINDLE STALLED',
          part: 'Spindle Motor / Inverter',
          cost: 450000,
          downtime: 5,
          rootCause: 'Attempted to cut material without spindle rotation (M03 missing).',
          position: pt,
        };
      }
    }
  }

  // 2. Tapping Sync Error
  if (modalState.tapMode) {
    let resolvedPitch = 1.5;
    const programText = options?.program || modalState.program;
    if (programText) {
      const match = programText.match(/\(M\d+(?:\.\d+)?[xX](\d+(?:\.\d+)?)[^)]*\)/i);
      if (match) {
        resolvedPitch = parseFloat(match[1]);
      } else if (options?.pitch !== undefined || modalState.pitch !== undefined) {
        resolvedPitch = options?.pitch ?? modalState.pitch ?? 1.5;
      }
    } else if (options?.pitch !== undefined || modalState.pitch !== undefined) {
      resolvedPitch = options?.pitch ?? modalState.pitch ?? 1.5;
    }

    const expectedFeed = modalState.rpm * resolvedPitch;
    if (Math.abs(modalState.feed - expectedFeed) > 1) {
      return {
        line: segment.line,
        type: 'SYNC_ERROR',
        description: 'COLLISION DETECTED: TAP STRIPPED',
        part: 'Tapping Head / Workpiece',
        cost: 120000,
        downtime: 2,
        rootCause: 'Feed and Spindle Speed are not synchronized for rigid tapping (P=1.5).',
        position: segment.to,
      };
    }
    return null;
  }

  // 3 & 4. Physical Geometry Collisions (Vise and Stock sampled along path)
  // Vertical retracts to safe clearance (dz > 0, to.z >= 0, no XY motion) are safe exit motions.
  const isRetractToClearance = segment.from.x === segment.to.x &&
                              segment.from.y === segment.to.y &&
                              segment.to.z > segment.from.z &&
                              segment.to.z >= 0;

  for (const pt of points) {
    // If G43 is missing and a Z motion is commanded or tool is below initial clearance (Z=50),
    // the physical spindle nose is 100mm lower than programmed.
    const isZMotionWithoutComp = !modalState.toolLengthComp && (
      segment.from.z !== segment.to.z || segment.to.z < 50 || segment.from.z < 50
    );
    const physicalZ = isZMotionWithoutComp ? pt.z - 100 : pt.z;

    // Vise Crash
    const inViseXY = pt.x >= ACADEMY_GEOMETRY.vise.x[0] && pt.x <= ACADEMY_GEOMETRY.vise.x[1] &&
                     pt.y >= ACADEMY_GEOMETRY.vise.y[0] && pt.y <= ACADEMY_GEOMETRY.vise.y[1];
    const inStockXY = pt.x >= ACADEMY_GEOMETRY.stock.x[0] && pt.x <= ACADEMY_GEOMETRY.stock.x[1] &&
                      pt.y >= ACADEMY_GEOMETRY.stock.y[0] && pt.y <= ACADEMY_GEOMETRY.stock.y[1];

    // Inside stock XY, the vise fixture is strictly below the stock (physicalZ < -10).
    // Outside stock XY, the vise jaws are at physicalZ <= -10.
    const inViseZ = inStockXY
      ? (physicalZ >= ACADEMY_GEOMETRY.vise.z[0] && physicalZ < ACADEMY_GEOMETRY.stock.z[0])
      : (physicalZ >= ACADEMY_GEOMETRY.vise.z[0] && physicalZ <= ACADEMY_GEOMETRY.vise.z[1]);

    if (!isRetractToClearance && inViseXY && inViseZ) {
      return {
        line: segment.line,
        type: 'VISE_CRASH',
        description: 'COLLISION DETECTED: VISE IMPACT',
        part: 'Kurt Vise / Spindle Bearings',
        cost: 340000,
        downtime: 6,
        rootCause: 'Rapid tool motion or incorrect height offset caused tool to slam into fixture.',
        position: pt,
      };
    }

    // Stock Crash (Rapid into stock)
    if (segment.type === 'rapid' && !isRetractToClearance && !modalState.tapMode) {
      if (
        inStockXY &&
        physicalZ >= ACADEMY_GEOMETRY.stock.z[0] && physicalZ <= ACADEMY_GEOMETRY.stock.z[1]
      ) {
        return {
          line: segment.line,
          type: 'STOCK_CRASH',
          description: 'COLLISION DETECTED: RAPID INTO STOCK',
          part: 'End Mill / Tool Holder',
          cost: 85000,
          downtime: 1,
          rootCause: 'G00 rapid move commanded below the stock top boundary (Z0).',
          position: pt,
        };
      }
    }
  }

  return null;
}

export function calculateMissionXP(targetXP: number, hintsUsed: number): number {
  const hints = Math.max(0, hintsUsed);
  return Math.max(0, Math.round(targetXP * (1 - 0.2 * Math.min(hints, 3))));
}

export function calculateLevel(xp: number): 'Trainee' | 'Operator' | 'Setter' {
  if (xp >= 400) return 'Setter';
  if (xp >= 200) return 'Operator';
  return 'Trainee';
}

export interface Mission {
  id: string;
  name: string;
  description: string;
  faultDescription: string;
  initialCode: string;
  targetXP: number;
  badgeId?: string;
  levelReq: number;
  pitch?: number;
}

export const ACADEMY_MISSIONS: Mission[] = [
  {
    id: 'missing-offset',
    name: 'The Missing Offset',
    description: 'WCS G54 Z-Datum mismatch on billet face.',
    faultDescription: 'Operator ran G00 rapid without invoking G43 H01 tool height offset. The 16mm carbide end mill slammed directly into the datum fixture.',
    initialCode: `%
O1001 (THE MISSING OFFSET)
T01 M06 (16MM FLAT END MILL)
G00 G90 G54 X10. Y10.
S2500 M03
Z10.
G01 Z-5. F500.
X70.
G00 Z50.
M30
%`,
    targetXP: 150,
    badgeId: 'offset-master',
    levelReq: 0,
  },
  {
    id: 'rapid-stock',
    name: 'Rapid Into Stock',
    description: 'High-speed Z-plunge without feed control.',
    faultDescription: 'Program commands a G00 move directly into the raw material. Rapids are for positioning, not for entering stock.',
    initialCode: `%
O1002 (RAPID INTO STOCK)
T01 M06 (10MM FLAT END MILL)
G00 G90 G54 X20. Y20.
G43 H01 Z50.
S3000 M03
G00 Z-10.
G01 X60. F800.
G00 Z50.
M30
%`,
    targetXP: 150,
    badgeId: 'safe-approach',
    levelReq: 0,
  },
  {
    id: 'stripped-tap',
    name: 'Stripped Tap',
    description: 'M29 rigid tapping synchronization error.',
    faultDescription: 'Rigid tapping requires strict F = S * Pitch ratio. If sync is lost, threads are stripped or tap breaks.',
    initialCode: `%
O1003 (STRIPPED TAP)
T01 M06 (M10x1.5)
G00 G90 G54 X40. Y25.
G43 H01 Z20.
S500 M03
M29 S500
G84 Z-20. R5. F600.
G80
G00 Z50.
M30
%`,
    targetXP: 150,
    badgeId: 'tap-whisperer',
    levelReq: 200,
    pitch: 1.5,
  },
  {
    id: 'dead-spindle',
    name: 'Dead Spindle',
    description: 'Attempting to cut with a stationary spindle.',
    faultDescription: 'Mechanical interlock failure or programming oversight. Entering material without M03 rotation will snap the tool instantly.',
    initialCode: `%
O1004 (DEAD SPINDLE)
T01 M06 (10MM FLAT END MILL)
G00 G90 G54 X30. Y30.
G43 H01 Z10.
S3000 M03
M05
G01 Z-5. F100.
X50.
G00 Z50.
M30
%`,
    targetXP: 200,
    badgeId: 'safe-starter',
    levelReq: 400,
  },
];
