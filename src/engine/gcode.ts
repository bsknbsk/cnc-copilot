export interface GCodeFinding {
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  line: number;
  code: string;
  message: string;
}

export interface GCodeSegment {
  type: 'rapid' | 'feed' | 'arc';
  from: { x: number; y: number; z: number };
  to: { x: number; y: number; z: number };
  center?: { x: number; y: number; z: number };
  line: number;
}

export interface GCodeParseResult {
  segments: GCodeSegment[];
  findings: GCodeFinding[];
  blockCount: number;
  criticalCount: number;
  warningCount: number;
  infoCount: number;
}

export function parseAndVerifyGCode(program: string, _controller: string = 'fanuc'): GCodeParseResult {
  const lines = program.split(/\r?\n/);
  const findings: GCodeFinding[] = [];
  const segments: GCodeSegment[] = [];

  let currentPos = { x: 0, y: 0, z: 50 };
  let activeTool: number | null = null;
  let activeH: number | null = null;
  let spindleOn = false;
  let hasG90orG91 = false;
  let hasPlane = false;
  let hasFeed = false;
  let hasWcs = false;
  let currentFeed = 0;
  let currentSpindle = 0;
  let isAbsolute = true;
  let activeMotion: 'G00' | 'G01' | 'G02' | 'G03' = 'G00';
  let firstMotionSeen = false;
  let lastNonEmptyLine = 1;
  let endsWithM30orM02 = false;

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    let raw = lines[i].trim();
    if (!raw) continue;
    lastNonEmptyLine = lineNum;

    // Check for comments in ( )
    const pitchMatch = raw.match(/\(M(\d+(?:\.\d+)?)[xX](\d+(?:\.\d+)?)\)/i);
    let tapPitch: number | null = null;
    if (pitchMatch) {
      tapPitch = parseFloat(pitchMatch[2]);
    }

    // Strip comments in ( ) and after ;
    const stripped = raw.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').trim();
    if (!stripped) continue;

    // Tokenize
    const tokens = stripped.toUpperCase().match(/[A-Z]-?\d+(?:\.\d+)?/g) || [];

    let lineHasMotion = false;
    let newX = currentPos.x;
    let newY = currentPos.y;
    let newZ = currentPos.z;
    let movedX = false;
    let movedY = false;
    let movedZ = false;
    let arcR: number | null = null;
    let arcI: number | null = null;
    let arcJ: number | null = null;
    let isTapCycle = false;

    for (const tok of tokens) {
      const letter = tok[0];
      const val = parseFloat(tok.slice(1));

      if (letter === 'G') {
        if (val === 0) { activeMotion = 'G00'; lineHasMotion = true; }
        else if (val === 1) { activeMotion = 'G01'; lineHasMotion = true; }
        else if (val === 2) { activeMotion = 'G02'; lineHasMotion = true; }
        else if (val === 3) { activeMotion = 'G03'; lineHasMotion = true; }
        else if (val === 90) { isAbsolute = true; hasG90orG91 = true; }
        else if (val === 91) { isAbsolute = false; hasG90orG91 = true; }
        else if (val === 17 || val === 18 || val === 19) { hasPlane = true; }
        else if (val >= 54 && val <= 59) { hasWcs = true; }
        else if (val === 43) { /* Handled with H */ }
        else if (val === 49) { activeH = null; }
        else if (val === 84) { isTapCycle = true; }
      } else if (letter === 'M') {
        if (val === 3 || val === 4) spindleOn = true;
        else if (val === 5) spindleOn = false;
        else if (val === 30 || val === 2) endsWithM30orM02 = true;
      } else if (letter === 'T') {
        activeTool = Math.round(val);
      } else if (letter === 'H') {
        activeH = Math.round(val);
      } else if (letter === 'S') {
        currentSpindle = val;
      } else if (letter === 'F') {
        currentFeed = val;
        hasFeed = true;
      } else if (letter === 'X') {
        newX = isAbsolute ? val : currentPos.x + val;
        movedX = true;
      } else if (letter === 'Y') {
        newY = isAbsolute ? val : currentPos.y + val;
        movedY = true;
      } else if (letter === 'Z') {
        newZ = isAbsolute ? val : currentPos.z + val;
        movedZ = true;
      } else if (letter === 'R') {
        arcR = val;
      } else if (letter === 'I') {
        arcI = val;
      } else if (letter === 'J') {
        arcJ = val;
      }
    }

    // Motion validations
    if (movedX || movedY || movedZ || lineHasMotion) {
      if (!firstMotionSeen) {
        if (!hasG90orG91) {
          findings.push({
            severity: 'WARNING',
            line: lineNum,
            code: 'NO_ABS_INC',
            message: 'No G90/G91 modal positioning state declared before the first motion block.',
          });
        }
        firstMotionSeen = true;
      }

      // Check Arc Center
      if ((activeMotion === 'G02' || activeMotion === 'G03') && arcR === null && arcI === null && arcJ === null) {
        findings.push({
          severity: 'CRITICAL',
          line: lineNum,
          code: 'ARC_NO_CENTER',
          message: `${activeMotion} circular interpolation without defined R radius or I/J arc center vector.`,
        });
      }

      if ((activeMotion === 'G02' || activeMotion === 'G03') && !hasPlane) {
        findings.push({
          severity: 'WARNING',
          line: lineNum,
          code: 'NO_PLANE',
          message: 'No G17/G18/G19 work plane declared before the first circular arc move.',
        });
      }

      // Check Spindle Off while feeding
      if ((activeMotion === 'G01' || activeMotion === 'G02' || activeMotion === 'G03') && !spindleOn) {
        findings.push({
          severity: 'CRITICAL',
          line: lineNum,
          code: 'SPINDLE_OFF_FEED',
          message: `${activeMotion} cutting feed commanded while spindle rotation is OFF (M05 or unstarted). Immediate tool breakage risk.`,
        });
      }

      // Check Missing Feed Rate
      if (activeMotion === 'G01' && (!hasFeed || currentFeed <= 0)) {
        findings.push({
          severity: 'WARNING',
          line: lineNum,
          code: 'NO_FEED',
          message: 'G01 linear motion block executed before any F feed rate was established.',
        });
      }

      // Check Rapid Plunge into Z < 0 while moving X or Y
      if (activeMotion === 'G00' && newZ < 0 && (movedX || movedY)) {
        findings.push({
          severity: 'CRITICAL',
          line: lineNum,
          code: 'RAPID_PLUNGE',
          message: `G00 rapid traverse plunged into negative Z (${newZ.toFixed(1)}mm) while simultaneously moving X/Y. High kinematic collision risk with workpiece.`,
        });
      }

      // Check first Z move after T.. M06 without G43 H matching
      if (movedZ && activeTool !== null) {
        if (activeH === null || activeH !== activeTool) {
          findings.push({
            severity: 'CRITICAL',
            line: lineNum,
            code: 'NO_G43',
            message: `Z motion commanded after tool change (T0${activeTool}) without an active G43 H0${activeTool} tool length compensation offset.`,
          });
          activeTool = null; // Report once per tool change
        }
      }

      // Record 3D kinematic segment
      segments.push({
        type: activeMotion === 'G00' ? 'rapid' : (activeMotion === 'G02' || activeMotion === 'G03') ? 'arc' : 'feed',
        from: { ...currentPos },
        to: { x: newX, y: newY, z: newZ },
        center: arcI !== null && arcJ !== null ? { x: currentPos.x + arcI, y: currentPos.y + arcJ, z: currentPos.z } : undefined,
        line: lineNum,
      });

      currentPos = { x: newX, y: newY, z: newZ };
    }

    // Check Rigid Tapping Feed vs Speed x Pitch
    if (isTapCycle && tapPitch && currentSpindle > 0) {
      const expectedFeed = Math.round(currentSpindle * tapPitch);
      if (Math.abs(currentFeed - expectedFeed) > 5) {
        findings.push({
          severity: 'WARNING',
          line: lineNum,
          code: 'TAP_FEED',
          message: `G84 rigid tapping feed rate (F${currentFeed}) does not match Spindle (S${currentSpindle}) x Pitch (${tapPitch}mm) = F${expectedFeed}. Risk of stripped threads or tap fracture.`,
        });
      }
    }
  }

  // Final program checks
  if (!endsWithM30orM02) {
    findings.push({
      severity: 'WARNING',
      line: lastNonEmptyLine,
      code: 'NO_END',
      message: 'G-code program does not terminate with an M30 (program end & rewind) or M02 block.',
    });
  }

  if (!hasWcs) {
    findings.push({
      severity: 'INFO',
      line: 1,
      code: 'NO_WCS',
      message: 'No explicit Work Coordinate System (G54 - G59) declared; program relies on current controller active datum.',
    });
  }

  const criticalCount = findings.filter(f => f.severity === 'CRITICAL').length;
  const warningCount = findings.filter(f => f.severity === 'WARNING').length;
  const infoCount = findings.filter(f => f.severity === 'INFO').length;

  return {
    segments,
    findings,
    blockCount: lines.length,
    criticalCount,
    warningCount,
    infoCount,
  };
}
