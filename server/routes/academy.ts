import { Router } from 'express';
import { adminDb } from '../firebase.js';
import { getGemini, executeWithRetry, getFriendlyErrorMessage } from '../geminiClient.js';
import { MODEL_FLASH } from '../config.js';
import { parseAndVerifyGCode } from '../../src/engine/gcode.js';
import { checkCollision, ACADEMY_MISSIONS, calculateMissionXP, calculateLevel } from '../../src/engine/crash.js';
import { requireAuth, requireAdmin } from '../authMiddleware.js';
import { rateLimitAI } from '../rateLimiter.js';
import { logAIRequest } from '../logger.js';

export const academyRouter = Router();

// GET /api/academy/stats
academyRouter.get('/academy/stats', requireAuth, requireAdmin, async (req: any, res) => {
  try {
    const snapshot = await adminDb.collectionGroup('academy').get();
    let learners = 0;
    let completions = 0;
    let totalCrashesBeforePass = 0;
    let learnersWithCrashes = 0;
    const crashTypeCounts: Record<string, number> = {};

    snapshot.docs.forEach((doc) => {
      if (doc.id !== 'progress') return;
      learners++;
      const data = doc.data();

      // Completions: sum of completed missions
      if (Array.isArray(data.completedMissions)) {
        completions += data.completedMissions.length;
      }

      // Crashes before pass
      if (typeof data.crashesBeforePass === 'number') {
        totalCrashesBeforePass += data.crashesBeforePass;
        learnersWithCrashes++;
      } else if (typeof data.crashes === 'number') {
        totalCrashesBeforePass += data.crashes;
        learnersWithCrashes++;
      }

      // Most common crash type
      if (Array.isArray(data.crashTypes)) {
        data.crashTypes.forEach((type: string) => {
          if (typeof type === 'string') {
            crashTypeCounts[type] = (crashTypeCounts[type] || 0) + 1;
          }
        });
      } else if (Array.isArray(data.crashHistory)) {
        data.crashHistory.forEach((item: any) => {
          const type = typeof item === 'string' ? item : item?.type;
          if (type && typeof type === 'string') {
            crashTypeCounts[type] = (crashTypeCounts[type] || 0) + 1;
          }
        });
      }
    });

    let mostCommonCrash: string | null = null;
    let maxCount = 0;
    for (const [type, count] of Object.entries(crashTypeCounts)) {
      if (count > maxCount) {
        maxCount = count;
        mostCommonCrash = type;
      }
    }

    const avgCrashes = learnersWithCrashes > 0 ? Number((totalCrashesBeforePass / learnersWithCrashes).toFixed(1)) : 0;

    return res.json({
      learners,
      completions,
      avgCrashes,
      mostCommonCrash,
    });
  } catch (err: any) {
    console.error(JSON.stringify({ route: 'GET /api/academy/stats', error: err?.message || String(err) }));
    res.status(500).json({ error: 'Failed to fetch academy stats' });
  }
});

// POST /api/instructor
academyRouter.post('/instructor', requireAuth, rateLimitAI, async (req: any, res) => {
  const startTime = Date.now();
  const {
    missionId,
    program,
    crashEvent,
    hintLevel = 1,
    language = 'en',
    question,
    message,
    context,
  } = req.body;
  const user = req.user!;

  const effectiveQuestion = question || message;
  const rawLevel = typeof hintLevel === 'number' ? hintLevel : (context?.hintsRevealed || 1);
  const effectiveHintLevel = Math.max(1, Math.min(3, rawLevel));

  const mission = ACADEMY_MISSIONS.find((m) => m.id === missionId);
  if (!mission) {
    return res.status(404).json({ error: 'mission_not_found', message: 'Mission not found' });
  }

  const levelInstructions: Record<number, string> = {
    1: 'Level 1: Ask a guiding question that helps the operator identify the mistake without telling them what it is.',
    2: 'Level 2: Point directly to the specific line number and explain the CNC concept or rule that was violated, without providing the exact code fix.',
    3: 'Level 3: Provide ONLY the single corrected line of G-code. Never provide the full program.',
  };

  const prompt = `You are a CNC Academy Instructor in a "Crash Lab".
The student is working on the mission: "${mission.name}".
Scenario: ${mission.description}
Fault context: ${mission.faultDescription}

Current G-code program:
\`\`\`gcode
${program || mission.initialCode}
\`\`\`

Crash Event: ${crashEvent ? `${crashEvent.type}: ${crashEvent.description} at line ${crashEvent.line}. Root cause: ${crashEvent.rootCause}` : 'No crash event triggered yet.'}
${effectiveQuestion ? `Student Question: "${effectiveQuestion}"` : ''}

Hint Tier: ${effectiveHintLevel} (1-3)
Instruction for Hint Tier ${effectiveHintLevel}:
${levelInstructions[effectiveHintLevel]}

Constraints:
- Never output the full program.
- In Level 1, ask a guiding question only.
- In Level 2, point to the line and concept only.
- In Level 3, provide only the single corrected line.
- Reply in ${language}. Keep standard G-code notation unchanged.`;

  try {
    const ai = getGemini();
    const response = await executeWithRetry(async () => {
      return await ai.models.generateContent({
        model: MODEL_FLASH,
        contents: prompt,
      });
    }, language);

    const latencyMs = Date.now() - startTime;
    const reply = response.text || 'Instructor response unavailable.';

    logAIRequest({
      route: '/api/instructor',
      uid: user.uid,
      controller: user.preferredController || 'generic',
      language,
      toolNames: ['academy_instructor'],
      citationCount: 0,
      latencyMs,
      model: MODEL_FLASH,
      promptTokens: response.usageMetadata?.promptTokenCount,
      outputTokens: response.usageMetadata?.candidatesTokenCount,
    });

    res.json({ reply });
  } catch (err: any) {
    console.error(JSON.stringify({ route: 'POST /api/instructor', error: err?.message || String(err) }));
    res.status(503).json({
      error: 'ai_unavailable',
      message: getFriendlyErrorMessage(language),
    });
  }
});

// POST /api/academy/complete
academyRouter.post('/academy/complete', requireAuth, async (req: any, res) => {
  const { missionId, program, hintsUsed } = req.body;
  const uid = req.user.uid;

  const mission = ACADEMY_MISSIONS.find((m) => m.id === missionId);
  if (!mission) return res.status(404).json({ error: 'mission_not_found', message: 'Mission not found' });

  if (!program || typeof program !== 'string') {
    return res.status(400).json({ error: 'invalid_program', message: 'G-code program is required' });
  }

  try {
    // 1. Verify G-code syntax and critical findings
    const parseResult = parseAndVerifyGCode(program);
    const hasCritical = parseResult.findings.some((f) => f.severity === 'CRITICAL');

    // 2. Run collision crash engine across all segments with 0.5mm sampling
    const lines = program.split('\n');
    let crashEvent = null;

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
        pitch: mission.pitch,
      };
      const col = checkCollision(segment, modalState);
      if (col) {
        crashEvent = col;
        break;
      }
    }

    // Pass only if zero crash events and zero CRITICAL findings
    if (hasCritical || crashEvent) {
      return res.status(400).json({
        success: false,
        error: 'verification_failed',
        message: crashEvent ? crashEvent.description : 'Program contains critical safety violations',
      });
    }

    const userRef = adminDb.collection('users').doc(uid).collection('academy').doc('progress');
    const userSnap = await userRef.get();
    const currentData = userSnap.exists ? userSnap.data() : { xp: 0, completedMissions: [], badges: [] };

    const isFirstPass = !(currentData?.completedMissions || []).includes(missionId);
    const hints = typeof hintsUsed === 'number' ? Math.max(0, hintsUsed) : 0;
    const computedXP = calculateMissionXP(mission.targetXP, hints);
    const xpEarned = isFirstPass ? computedXP : 0;
    const newXP = (currentData?.xp || 0) + xpEarned;

    // Determine new level (Trainee 0-199, Operator 200-399, Setter 400+)
    const level = calculateLevel(newXP);

    // Streak days (+1 when completing on a new calendar day in Asia/Kolkata)
    const kolkataToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    let streakDays = currentData?.streakDays || 0;
    const lastCompletionDate = currentData?.lastCompletionDate;

    if (lastCompletionDate !== kolkataToday) {
      streakDays += 1;
    }

    const completedMissions = Array.from(new Set([...(currentData?.completedMissions || []), missionId]));
    const badges = Array.from(new Set([...(currentData?.badges || []), ...(mission.badgeId ? [mission.badgeId] : [])]));

    await userRef.set(
      {
        xp: newXP,
        level,
        completedMissions,
        badges,
        streakDays,
        lastCompletionDate: kolkataToday,
        lastUpdated: new Date().toISOString(),
      },
      { merge: true }
    );

    // Write activity row
    try {
      await adminDb.collection('users').doc(uid).collection('activity').add({
        type: 'academy',
        title: `Mission Passed: ${mission.name}`.slice(0, 120),
        summary: `Passed with zero crashes. +${xpEarned} XP awarded.`.slice(0, 300),
        link: 'academy',
        createdAt: new Date().toISOString(),
      });
    } catch (actErr: any) {
      console.warn(JSON.stringify({ level: 'warn', route: 'POST /api/academy/complete', error: actErr?.message || 'Activity write failed' }));
    }

    res.json({ success: true, newXP, level, streakDays, xpEarned });
  } catch (err: any) {
    console.error(JSON.stringify({ route: 'POST /api/academy/complete', error: err?.message || String(err) }));
    res.status(500).json({ error: 'Failed to record progress' });
  }
});
