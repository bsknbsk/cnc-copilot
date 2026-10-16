import { describe, it, expect } from 'vitest';
import { parseAndVerifyGCode } from '../src/engine/gcode.js';

describe('G-Code Verification Engine (src/engine/gcode.ts)', () => {
  it('G-code sample O1001: exactly NO_G43 and RAPID_PLUNGE as CRITICAL on line 6; corrected program has zero CRITICAL', () => {
    const brokenO1001 = `%
O1001
G21 G90 G17
G54
T01 M06
G00 X20.0 Y20.0 Z-15.0
M30
%`;

    const resBroken = parseAndVerifyGCode(brokenO1001, 'fanuc');

    // Filter line 6 findings
    const line6Findings = resBroken.findings.filter((f) => f.line === 6);
    expect(line6Findings).toHaveLength(2);
    expect(line6Findings.every((f) => f.severity === 'CRITICAL')).toBe(true);

    const line6Codes = line6Findings.map((f) => f.code).sort();
    expect(line6Codes).toEqual(['NO_G43', 'RAPID_PLUNGE'].sort());

    // Verify all critical findings in the program are exactly these two on line 6
    const allCritical = resBroken.findings.filter((f) => f.severity === 'CRITICAL');
    expect(allCritical).toHaveLength(2);
    expect(resBroken.criticalCount).toBe(2);

    // Corrected program with proper clearance, G43 H01 offset, and controlled G01 feed
    const correctedO1001 = `%
O1001
G21 G90 G17
G54
T01 M06
G00 X20.0 Y20.0
G43 H01 Z50.0
S2000 M03
G01 Z-15.0 F500.0
G00 Z50.0
M30
%`;

    const resCorrected = parseAndVerifyGCode(correctedO1001, 'fanuc');
    expect(resCorrected.criticalCount).toBe(0);
    expect(resCorrected.findings.filter((f) => f.severity === 'CRITICAL')).toHaveLength(0);
  });
});
