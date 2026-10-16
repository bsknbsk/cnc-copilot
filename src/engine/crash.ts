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

export function checkCollision(
  segment: GCodeSegment,
  modalState: { spindleOn: boolean; toolLengthComp: boolean; tapMode: boolean; feed: number; rpm: number }
): CollisionEvent | null {
  const { to } = segment;
  const { x, y, z } = to;

  // 1. Spindle Stall Check (M03 missing)
  if (!modalState.spindleOn && z < 2.0 && segment.type === 'feed') {
    return {
      line: segment.line,
      type: 'SPINDLE_STALL',
      description: 'COLLISION DETECTED: SPINDLE STALLED',
      part: 'Spindle Motor / Inverter',
      cost: 450000,
      downtime: 5,
      rootCause: 'Attempted to cut material without spindle rotation (M03 missing).',
      position: to
    };
  }

  // 2. Tool Length Compensation Check (G43 missing)
  // If G43 is missing, the machine assumes tool length is 0.
  // In our simulation, let's assume the "actual" tool length is 100mm.
  // If compensation is off, the physical spindle nose is 100mm lower than the program thinks.
  const physicalZ = modalState.toolLengthComp ? z : z - 100;

  // 3. Vise Crash
  if (
    x >= ACADEMY_GEOMETRY.vise.x[0] && x <= ACADEMY_GEOMETRY.vise.x[1] &&
    y >= ACADEMY_GEOMETRY.vise.y[0] && y <= ACADEMY_GEOMETRY.vise.y[1] &&
    physicalZ >= ACADEMY_GEOMETRY.vise.z[0] && physicalZ <= ACADEMY_GEOMETRY.vise.z[1]
  ) {
    return {
      line: segment.line,
      type: 'VISE_CRASH',
      description: 'COLLISION DETECTED: VISE IMPACT',
      part: 'Kurt Vise / Spindle Bearings',
      cost: 340000,
      downtime: 6,
      rootCause: 'Rapid tool motion or incorrect height offset caused tool to slam into fixture.',
      position: to
    };
  }

  // 4. Stock Crash (Rapid into stock)
  if (
    x >= ACADEMY_GEOMETRY.stock.x[0] && x <= ACADEMY_GEOMETRY.stock.x[1] &&
    y >= ACADEMY_GEOMETRY.stock.y[0] && y <= ACADEMY_GEOMETRY.stock.y[1] &&
    physicalZ >= ACADEMY_GEOMETRY.stock.z[0] && physicalZ <= ACADEMY_GEOMETRY.stock.z[1]
  ) {
    if (segment.type === 'rapid') {
      return {
        line: segment.line,
        type: 'STOCK_CRASH',
        description: 'COLLISION DETECTED: RAPID INTO STOCK',
        part: 'End Mill / Tool Holder',
        cost: 85000,
        downtime: 1,
        rootCause: 'G00 rapid move commanded below the stock top boundary (Z0).',
        position: to
      };
    }
  }

  // 5. Tapping Sync Error
  if (modalState.tapMode) {
    // Check feed/speed ratio for M10x1.5 (Mission 3)
    // F = S * P
    const expectedFeed = modalState.rpm * 1.5;
    if (Math.abs(modalState.feed - expectedFeed) > 1) {
       return {
        line: segment.line,
        type: 'SYNC_ERROR',
        description: 'COLLISION DETECTED: TAP STRIPPED',
        part: 'Tapping Head / Workpiece',
        cost: 120000,
        downtime: 2,
        rootCause: 'Feed and Spindle Speed are not synchronized for rigid tapping (P=1.5).',
        position: to
      };
    }
  }

  return null;
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
    levelReq: 0
  },
  {
    id: 'rapid-stock',
    name: 'Rapid Into Stock',
    description: 'High-speed Z-plunge without feed control.',
    faultDescription: 'Program commands a G00 move directly into the raw material. Rapids are for positioning, not for entering stock.',
    initialCode: `%
O1002 (RAPID INTO STOCK)
T01 M06
G00 G90 G54 X20. Y20.
G43 H01 Z50.
S3000 M03
G00 Z-10. (CRASH: RAPID INTO STOCK)
G01 X60. F800.
G00 Z50.
M30
%`,
    targetXP: 150,
    badgeId: 'safe-approach',
    levelReq: 0
  },
  {
    id: 'stripped-tap',
    name: 'Stripped Tap',
    description: 'M29 rigid tapping synchronization error.',
    faultDescription: 'Rigid tapping requires strict F = S * Pitch ratio. If sync is lost, threads are stripped or tap breaks.',
    initialCode: `%
O1003 (STRIPPED TAP)
T01 M06 (M10X1.5 TAP)
G00 G90 G54 X40. Y25.
G43 H01 Z20.
S500
M29 S500 (RIGID MODE)
G84 Z-20. R5. F250. (WRONG FEED: SHOULD BE 750)
G80
G00 Z50.
M30
%`,
    targetXP: 150,
    badgeId: 'tap-whisperer',
    levelReq: 200
  },
  {
    id: 'dead-spindle',
    name: 'Dead Spindle',
    description: 'Attempting to cut with a stationary spindle.',
    faultDescription: 'Mechanical interlock failure or programming oversight. Entering material without M03 rotation will snap the tool instantly.',
    initialCode: `%
O1004 (DEAD SPINDLE)
T01 M06
G00 G90 G54 X30. Y30.
G43 H01 Z10.
(MISSING M03 SPINDLE START)
G01 Z-5. F100.
X50.
G00 Z50.
M30
%`,
    targetXP: 200,
    badgeId: 'safe-starter',
    levelReq: 400
  }
];
