import { Router } from 'express';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb } from '../firebase.js';
import { getGemini, executeWithRetry, getFriendlyErrorMessage } from '../geminiClient.js';
import { MODEL_FLASH } from '../config.js';
import {
  ACADEMY_MISSIONS,
  calculateMissionXP,
  calculateLevel,
  computeStreak,
  evaluateGCodeRun,
} from '../../src/engine/crash.js';
import { requireAuth, requireAdmin } from '../authMiddleware.js';
import { rateLimitAI } from '../rateLimiter.js';
import { logAIRequest } from '../logger.js';

export const academyRouter = Router();

function getKolkataDate(date: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(date);
}

function getInitialMissions(): Record<string, any> {
  const missions: Record<string, any> = {};
  ACADEMY_MISSIONS.forEach((m, idx) => {
    missions[m.id] = {
      status: idx === 0 ? 'current' : 'locked',
      attempts: 0,
      crashes: 0,
      hintsUsed: 0,
      bestXp: 0,
      firstPassAt: null,
      objectivesMet: [],
    };
  });
  return missions;
}

// POST /api/academy/enroll
academyRouter.post('/academy/enroll', requireAuth, async (req: any, res) => {
  const uid = req.user.uid;
  const nowIso = new Date().toISOString();
  const kolkataToday = getKolkataDate();

  try {
    const traineeRef = adminDb.collection('trainees').doc(uid);
    const traineeSnap = await traineeRef.get();

    let isNew = false;
    if (!traineeSnap.exists) {
      isNew = true;
      const initialData = {
        displayName: req.user.name || req.user.displayName || req.user.email?.split('@')[0] || 'Trainee',
        photoURL: req.user.picture || req.user.photoURL || null,
        enrolledAt: nowIso,
        lastActiveAt: nowIso,
        xp: 0,
        level: 'Trainee',
        streakDays: 1,
        lastStreakDate: kolkataToday,
        badges: [],
        missions: getInitialMissions(),
        totalSimRuns: 0,
      };
      await traineeRef.set(initialData);
    } else {
      await traineeRef.update({
        lastActiveAt: nowIso,
      });
    }

    // Compute activeLast7Days with count() aggregation on trainees
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const countSnap = await adminDb
      .collection('trainees')
      .where('lastActiveAt', '>=', sevenDaysAgo)
      .count()
      .get();
    const activeLast7Days = countSnap.data().count;

    // Update global academy_stats
    const globalStatsRef = adminDb.collection('academy_stats').doc('global');
    const globalSnap = await globalStatsRef.get();

    if (!globalSnap.exists) {
      await globalStatsRef.set({
        learners: isNew ? 1 : 0,
        activeLast7Days,
        completions: 0,
        totalRuns: 0,
        totalCrashes: 0,
        crashCounts: {},
        avgCrashesBeforePass: 0,
        updatedAt: nowIso,
      });
    } else {
      const updatePayload: Record<string, any> = {
        activeLast7Days,
        updatedAt: nowIso,
      };
      if (isNew) {
        updatePayload.learners = FieldValue.increment(1);
      }
      await globalStatsRef.update(updatePayload);
    }

    const updatedTrainee = (await traineeRef.get()).data();
    return res.json({
      success: true,
      isNew,
      trainee: updatedTrainee,
    });
  } catch (err: any) {
    console.error(JSON.stringify({ route: 'POST /api/academy/enroll', error: err?.message || String(err) }));
    return res.status(500).json({ error: 'Failed to enroll in academy' });
  }
});

// POST /api/academy/event
academyRouter.post('/academy/event', requireAuth, async (req: any, res) => {
  const uid = req.user.uid;
  const { sessionId, missionId, type, detail } = req.body;

  if (!sessionId || typeof sessionId !== 'string') {
    return res.status(400).json({ error: 'invalid_session_id', message: 'sessionId is required' });
  }
  if (!missionId || typeof missionId !== 'string') {
    return res.status(400).json({ error: 'invalid_mission_id', message: 'missionId is required' });
  }

  const validTypes = ['run', 'step', 'crash', 'hint', 'edit', 'pass', 'quiz'];
  if (!type || !validTypes.includes(type)) {
    return res.status(400).json({ error: 'invalid_type', message: `type must be one of: ${validTypes.join(', ')}` });
  }

  const mission = ACADEMY_MISSIONS.find((m) => m.id === missionId);
  if (!mission) {
    return res.status(404).json({ error: 'mission_not_found', message: 'Mission not found' });
  }

  const nowIso = new Date().toISOString();
  const kolkataToday = getKolkataDate();

  try {
    const traineeRef = adminDb.collection('trainees').doc(uid);
    let traineeSnap = await traineeRef.get();

    if (!traineeSnap.exists) {
      // Auto-enroll if somehow called before explicit enrollment
      await traineeRef.set({
        displayName: req.user.name || req.user.displayName || req.user.email?.split('@')[0] || 'Trainee',
        photoURL: req.user.picture || req.user.photoURL || null,
        enrolledAt: nowIso,
        lastActiveAt: nowIso,
        xp: 0,
        level: 'Trainee',
        streakDays: 1,
        lastStreakDate: kolkataToday,
        badges: [],
        missions: getInitialMissions(),
        totalSimRuns: 0,
      });
      traineeSnap = await traineeRef.get();
    }

    const traineeData = traineeSnap.data() || {};
    const sessionRef = traineeRef.collection('sessions').doc(sessionId);

    // Save event to session
    await sessionRef.set(
      {
        missionId,
        startedAt: traineeData?.sessions?.[sessionId]?.startedAt || nowIso,
        endedAt: type === 'pass' ? nowIso : null,
        events: FieldValue.arrayUnion({
          t: nowIso,
          type,
          detail: detail || null,
        }),
      },
      { merge: true }
    );

    const globalStatsRef = adminDb.collection('academy_stats').doc('global');

    if (type === 'hint') {
      await traineeRef.update({
        lastActiveAt: nowIso,
        [`missions.${missionId}.hintsUsed`]: FieldValue.increment(1),
      });
      return res.json({ success: true });
    }

    if (type === 'run') {
      const program = typeof detail?.program === 'string' ? detail.program : typeof req.body.program === 'string' ? req.body.program : '';
      if (!program) {
        return res.status(400).json({ error: 'invalid_program', message: 'Program string is required for run event' });
      }

      // Server-authoritative parse and crash check
      const evalResult = evaluateGCodeRun(program, mission);
      const isCrash = !!evalResult.crashEvent;
      const isPass = evalResult.isSafe;

      // Update basic run counters
      const traineeUpdates: Record<string, any> = {
        lastActiveAt: nowIso,
        totalSimRuns: FieldValue.increment(1),
        [`missions.${missionId}.attempts`]: FieldValue.increment(1),
      };

      const globalUpdates: Record<string, any> = {
        totalRuns: FieldValue.increment(1),
        updatedAt: nowIso,
      };

      if (isCrash && evalResult.crashEvent) {
        traineeUpdates[`missions.${missionId}.crashes`] = FieldValue.increment(1);
        globalUpdates.totalCrashes = FieldValue.increment(1);
        globalUpdates[`crashCounts.${evalResult.crashEvent.type}`] = FieldValue.increment(1);

        // Record crash event in session
        await sessionRef.set(
          {
            events: FieldValue.arrayUnion({
              t: nowIso,
              type: 'crash',
              detail: evalResult.crashEvent,
            }),
          },
          { merge: true }
        );
      }

      let xpEarned = 0;
      let newXP = traineeData.xp || 0;
      let newLevel = traineeData.level || 'Trainee';
      let streakDays = traineeData.streakDays || 1;
      let badgeEarned: string | null = null;

      if (isPass) {
        const currentMissionState = traineeData.missions?.[missionId];
        const isFirstPass = currentMissionState?.status !== 'passed';

        const hintsUsed = typeof detail?.hintsUsed === 'number'
          ? detail.hintsUsed
          : currentMissionState?.hintsUsed || 0;

        if (isFirstPass) {
          xpEarned = calculateMissionXP(mission.targetXP, hintsUsed);
          newXP = (traineeData.xp || 0) + xpEarned;
          newLevel = calculateLevel(newXP);

          traineeUpdates.xp = newXP;
          traineeUpdates.level = newLevel;

          // Streak update
          const streakRes = computeStreak(traineeData.streakDays || 0, traineeData.lastStreakDate);
          streakDays = streakRes.streakDays;
          traineeUpdates.streakDays = streakDays;
          traineeUpdates.lastStreakDate = streakRes.lastStreakDate;

          // Badges
          if (mission.badgeId && !(traineeData.badges || []).includes(mission.badgeId)) {
            badgeEarned = mission.badgeId;
            traineeUpdates.badges = FieldValue.arrayUnion(mission.badgeId);
          }

          // Mission state update
          traineeUpdates[`missions.${missionId}.status`] = 'passed';
          traineeUpdates[`missions.${missionId}.bestXp`] = xpEarned;
          traineeUpdates[`missions.${missionId}.firstPassAt`] = nowIso;

          // Unlock next mission if locked
          const missionIndex = ACADEMY_MISSIONS.findIndex((m) => m.id === missionId);
          if (missionIndex >= 0 && missionIndex + 1 < ACADEMY_MISSIONS.length) {
            const nextMission = ACADEMY_MISSIONS[missionIndex + 1];
            const nextMissionState = traineeData.missions?.[nextMission.id];
            if (!nextMissionState || nextMissionState.status === 'locked') {
              traineeUpdates[`missions.${nextMission.id}.status`] = 'current';
            }
          }

          // Global completions and avgCrashesBeforePass
          globalUpdates.completions = FieldValue.increment(1);

          // Read global stats to compute avgCrashesBeforePass
          const currentGlobalSnap = await globalStatsRef.get();
          const currentGlobalData = currentGlobalSnap.data() || {};
          const currentTotalCrashes = (currentGlobalData.totalCrashes || 0) + (isCrash ? 1 : 0);
          const newCompletions = (currentGlobalData.completions || 0) + 1;
          const avgCrashesBeforePass = newCompletions > 0 ? Number((currentTotalCrashes / newCompletions).toFixed(1)) : 0;
          globalUpdates.avgCrashesBeforePass = avgCrashesBeforePass;

          // Record pass event in session
          await sessionRef.set(
            {
              endedAt: nowIso,
              events: FieldValue.arrayUnion({
                t: nowIso,
                type: 'pass',
                detail: { xpEarned, hintsUsed },
              }),
            },
            { merge: true }
          );

          // Record user activity
          try {
            await adminDb.collection('users').doc(uid).collection('activity').add({
              type: 'academy',
              title: `Mission Passed: ${mission.name}`.slice(0, 120),
              summary: `Passed with zero crashes. +${xpEarned} XP awarded.`.slice(0, 300),
              link: 'academy',
              createdAt: nowIso,
            });
          } catch (actErr: any) {
            console.warn(JSON.stringify({ level: 'warn', route: 'POST /api/academy/event:activity', error: actErr?.message || String(actErr) }));
          }
        }
      }

      await traineeRef.update(traineeUpdates);
      await globalStatsRef.set(globalUpdates, { merge: true });

      return res.json({
        success: true,
        crashEvent: evalResult.crashEvent,
        criticalFindings: evalResult.criticalFindings,
        passed: isPass,
        xpEarned,
        newXP,
        newLevel,
        streakDays,
        badgeEarned,
      });
    }

    // Default for step, edit, quiz
    await traineeRef.update({
      lastActiveAt: nowIso,
    });
    return res.json({ success: true });
  } catch (err: any) {
    console.error(JSON.stringify({ route: 'POST /api/academy/event', error: err?.message || String(err) }));
    return res.status(500).json({ error: 'Failed to record event' });
  }
});

// GET /api/academy/trainees
academyRouter.get('/academy/trainees', requireAuth, requireAdmin, async (req: any, res) => {
  try {
    const snap = await adminDb.collection('trainees').get();
    const trainees = snap.docs.map((doc) => {
      const data = doc.data();
      const missions = data.missions || {};
      const missionsPassed = Object.values(missions).filter((m: any) => m?.status === 'passed').length;
      const crashes = Object.values(missions).reduce((sum: number, m: any) => sum + (m?.crashes || 0), 0);

      return {
        uid: doc.id,
        name: data.displayName || 'Trainee',
        email: data.email || '',
        level: data.level || 'Trainee',
        xp: data.xp || 0,
        missionsPassed,
        crashes,
        lastActive: data.lastActiveAt || data.enrolledAt || null,
      };
    });

    // Sort by last active descending
    trainees.sort((a, b) => {
      const timeA = a.lastActive ? new Date(a.lastActive).getTime() : 0;
      const timeB = b.lastActive ? new Date(b.lastActive).getTime() : 0;
      return timeB - timeA;
    });

    return res.json({ trainees });
  } catch (err: any) {
    console.error(JSON.stringify({ route: 'GET /api/academy/trainees', error: err?.message || String(err) }));
    return res.status(500).json({ error: 'Failed to fetch trainees' });
  }
});

// GET /api/academy/stats
academyRouter.get('/academy/stats', requireAuth, async (req: any, res) => {
  try {
    const globalSnap = await adminDb.collection('academy_stats').doc('global').get();
    if (!globalSnap.exists) {
      return res.json({
        learners: 0,
        activeLast7Days: 0,
        completions: 0,
        totalRuns: 0,
        totalCrashes: 0,
        crashCounts: {},
        avgCrashesBeforePass: 0,
        mostCommonCrash: 'None',
      });
    }

    const data = globalSnap.data() || {};
    const crashCounts = data.crashCounts || {};
    let mostCommonCrash = 'None';
    let maxCount = 0;
    for (const [type, count] of Object.entries(crashCounts)) {
      if (typeof count === 'number' && count > maxCount) {
        maxCount = count;
        mostCommonCrash = type;
      }
    }

    return res.json({
      learners: data.learners || 0,
      activeLast7Days: data.activeLast7Days || 0,
      completions: data.completions || 0,
      totalRuns: data.totalRuns || 0,
      totalCrashes: data.totalCrashes || 0,
      avgCrashesBeforePass: data.avgCrashesBeforePass || 0,
      mostCommonCrash,
    });
  } catch (err: any) {
    console.error(JSON.stringify({ route: 'GET /api/academy/stats', error: err?.message || String(err) }));
    return res.status(500).json({ error: 'Failed to fetch academy stats' });
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
- Always respond in the language the student used to type their question (e.g. Hindi, Tamil, Malayalam, or English). If asking for a system hint without a custom question or if typed in English, respond in English. Keep standard G-code notation unchanged.`;

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
