import { describe, it, expect } from 'vitest';
import {
  ACADEMY_MISSIONS,
  checkCollision,
  sampleSegmentPoints,
  calculateMissionXP,
  calculateLevel,
  CollisionEvent,
} from '../src/engine/crash.js';
import { parseAndVerifyGCode, GCodeSegment } from '../src/engine/gcode.js';

function simulateProgram(program: string, missionPitch?: number): {
  crashEvent: CollisionEvent | null;
  findings: ReturnType<typeof parseAndVerifyGCode>['findings'];
} {
  const parseResult = parseAndVerifyGCode(program);
  const lines = program.split('\n');
  let crashEvent: CollisionEvent | null = null;

  for (const segment of parseResult.segments) {
    let spindleOn = false;
    let toolLengthComp = false;
    let tapMode = false;
    let feed = 0;
    let rpm = 0;

    for (let i = 0; i < lines.length; i++) {
      if (i + 1 > segment.line) break;
      const l = lines[i].toUpperCase();
      if (l.includes('M03') || l.includes('M3')) spindleOn = true;
      if (l.includes('M05') || l.includes('M5')) spindleOn = false;
      if (l.includes('G43')) toolLengthComp = true;
      if (l.includes('G49')) toolLengthComp = false;
      if (l.includes('M29')) tapMode = true;
      if (l.includes('G80')) tapMode = false;

      const fMatch = l.match(/F(\d+(\.\d+)?)/);
      if (fMatch) feed = parseFloat(fMatch[1]);

      const sMatch = l.match(/S(\d+(\.\d+)?)/);
      if (sMatch) rpm = parseFloat(sMatch[1]);
    }

    const modalState = {
      spindleOn,
      toolLengthComp,
      tapMode,
      feed,
      rpm,
      program,
      pitch: missionPitch,
    };
    const col = checkCollision(segment, modalState);
    if (col) {
      crashEvent = col;
      break;
    }
  }

  return { crashEvent, findings: parseResult.findings };
}

describe('Academy Mission Collision Engine', () => {
  it('Mission 1 (missing-offset): broken program produces VISE_CRASH first', () => {
    const mission = ACADEMY_MISSIONS.find((m) => m.id === 'missing-offset')!;
    expect(mission).toBeDefined();

    const { crashEvent } = simulateProgram(mission.initialCode, mission.pitch);
    expect(crashEvent).not.toBeNull();
    expect(crashEvent?.type).toBe('VISE_CRASH');
  });

  it('Mission 1 (missing-offset): fixed program produces zero crashes and zero critical findings', () => {
    const fixedCode = `%
O1001 (THE MISSING OFFSET - FIXED)
T01 M06 (16MM FLAT END MILL)
G00 G90 G54 X10. Y10.
G43 H01 Z50.
S2500 M03
Z10.
G01 Z-5. F500.
X70.
G00 Z50.
M30
%`;
    const { crashEvent, findings } = simulateProgram(fixedCode);
    expect(crashEvent).toBeNull();
    const criticals = findings.filter((f) => f.severity === 'CRITICAL');
    expect(criticals).toHaveLength(0);
  });

  it('Mission 2 (rapid-stock): broken program produces STOCK_CRASH first', () => {
    const mission = ACADEMY_MISSIONS.find((m) => m.id === 'rapid-stock')!;
    expect(mission).toBeDefined();

    const { crashEvent } = simulateProgram(mission.initialCode, mission.pitch);
    expect(crashEvent).not.toBeNull();
    expect(crashEvent?.type).toBe('STOCK_CRASH');
  });

  it('Mission 2 (rapid-stock): fixed program produces zero crashes and zero critical findings', () => {
    const fixedCode = `%
O1002 (RAPID INTO STOCK - FIXED)
T01 M06 (10MM FLAT END MILL)
G00 G90 G54 X20. Y20.
G43 H01 Z50.
S3000 M03
G00 Z5.
G01 Z-10. F800.
X60.
G00 Z50.
M30
%`;
    const { crashEvent, findings } = simulateProgram(fixedCode);
    expect(crashEvent).toBeNull();
    const criticals = findings.filter((f) => f.severity === 'CRITICAL');
    expect(criticals).toHaveLength(0);
  });

  it('Mission 3 (stripped-tap): broken program produces SYNC_ERROR first', () => {
    const mission = ACADEMY_MISSIONS.find((m) => m.id === 'stripped-tap')!;
    expect(mission).toBeDefined();

    const { crashEvent } = simulateProgram(mission.initialCode, mission.pitch);
    expect(crashEvent).not.toBeNull();
    expect(crashEvent?.type).toBe('SYNC_ERROR');
  });

  it('Mission 3 (stripped-tap): fixed program produces zero crashes and zero critical findings', () => {
    const fixedCode = `%
O1003 (STRIPPED TAP - FIXED)
T01 M06 (M10x1.5)
G00 G90 G54 X40. Y25.
G43 H01 Z20.
S500 M03
M29 S500
G84 Z-20. R5. F750.
G80
G00 Z50.
M30
%`;
    const { crashEvent, findings } = simulateProgram(fixedCode, 1.5);
    expect(crashEvent).toBeNull();
    const criticals = findings.filter((f) => f.severity === 'CRITICAL');
    expect(criticals).toHaveLength(0);
  });

  it('Mission 4 (dead-spindle): broken program produces SPINDLE_STALL first', () => {
    const mission = ACADEMY_MISSIONS.find((m) => m.id === 'dead-spindle')!;
    expect(mission).toBeDefined();

    const { crashEvent } = simulateProgram(mission.initialCode, mission.pitch);
    expect(crashEvent).not.toBeNull();
    expect(crashEvent?.type).toBe('SPINDLE_STALL');
  });

  it('Mission 4 (dead-spindle): fixed program produces zero crashes and zero critical findings', () => {
    const fixedCode = `%
O1004 (DEAD SPINDLE - FIXED)
T01 M06 (10MM FLAT END MILL)
G00 G90 G54 X30. Y30.
G43 H01 Z10.
S3000 M03
G01 Z-5. F100.
X50.
G00 Z50.
M30
%`;
    const { crashEvent, findings } = simulateProgram(fixedCode);
    expect(crashEvent).toBeNull();
    const criticals = findings.filter((f) => f.severity === 'CRITICAL');
    expect(criticals).toHaveLength(0);
  });
});

describe('Path-Sampled Collision Detection (0.5 mm sampling)', () => {
  it('detects a G00 that passes through the vise and ends outside it', () => {
    // Vise geometry: X: [-10, 90], Y: [-15, 65], Z: [-60, -10]
    // A rapid move starting at X=-20 (outside) and ending at X=110 (outside) at Z=-25, Y=20
    const segment: GCodeSegment = {
      type: 'rapid',
      from: { x: -20, y: 20, z: -25 },
      to: { x: 110, y: 20, z: -25 },
      line: 42,
    };

    const modalState = {
      spindleOn: true,
      toolLengthComp: true,
      tapMode: false,
      feed: 0,
      rpm: 3000,
    };

    // End point alone is X=110 which is > 90 (outside vise)
    // But segment passes directly through the vise fixture
    const collision = checkCollision(segment, modalState);
    expect(collision).not.toBeNull();
    expect(collision?.type).toBe('VISE_CRASH');
    expect(collision?.position.x).toBeGreaterThanOrEqual(-10);
    expect(collision?.position.x).toBeLessThanOrEqual(90);
  });

  it('samples linear segments every 0.5 mm', () => {
    const segment: GCodeSegment = {
      type: 'feed',
      from: { x: 0, y: 0, z: 0 },
      to: { x: 10, y: 0, z: 0 },
      line: 10,
    };
    const points = sampleSegmentPoints(segment, 0.5);
    // Distance = 10mm, with 0.5mm step = 20 intervals = 21 points
    expect(points).toHaveLength(21);
    expect(points[0]).toEqual({ x: 0, y: 0, z: 0 });
    expect(points[20]).toEqual({ x: 10, y: 0, z: 0 });
  });

  it('resolves tap pitch from comment (M10x1.5)', () => {
    const segment: GCodeSegment = {
      type: 'feed',
      from: { x: 40, y: 25, z: 0 },
      to: { x: 40, y: 25, z: -10 },
      line: 12,
    };
    // S500, F600 with comment (M10x1.5) -> expected F is 750 -> SYNC_ERROR
    const modalState = {
      spindleOn: true,
      toolLengthComp: true,
      tapMode: true,
      feed: 600,
      rpm: 500,
      program: 'T01 M06 (M10x1.5 TAP)\nG84 Z-10. F600.',
    };
    const collision = checkCollision(segment, modalState);
    expect(collision).not.toBeNull();
    expect(collision?.type).toBe('SYNC_ERROR');
  });
});

describe('Academy XP Formula and Level Thresholds', () => {
  it('computes XP correctly with hint penalties: targetXP * (1 - 0.2 * min(hints, 3))', () => {
    const targetXP = 150;
    expect(calculateMissionXP(targetXP, 0)).toBe(150);
    expect(calculateMissionXP(targetXP, 1)).toBe(120); // 150 * 0.8
    expect(calculateMissionXP(targetXP, 2)).toBe(90);  // 150 * 0.6
    expect(calculateMissionXP(targetXP, 3)).toBe(60);  // 150 * 0.4
    expect(calculateMissionXP(targetXP, 4)).toBe(60);  // capped at 3 hints
    expect(calculateMissionXP(targetXP, -1)).toBe(150); // negative clamped to 0
    expect(calculateMissionXP(0, 0)).toBe(0);
  });

  it('determines level correctly by XP thresholds (Trainee 0-199, Operator 200-399, Setter 400+)', () => {
    expect(calculateLevel(0)).toBe('Trainee');
    expect(calculateLevel(100)).toBe('Trainee');
    expect(calculateLevel(199)).toBe('Trainee');
    expect(calculateLevel(200)).toBe('Operator');
    expect(calculateLevel(300)).toBe('Operator');
    expect(calculateLevel(399)).toBe('Operator');
    expect(calculateLevel(400)).toBe('Setter');
    expect(calculateLevel(1200)).toBe('Setter');
  });
});
