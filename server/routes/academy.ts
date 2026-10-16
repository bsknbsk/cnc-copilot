import { Router } from 'express';
import { adminDb } from '../firebase.js';
import { getGeminiResponse } from '../geminiClient.js';
import { parseAndVerifyGCode } from '../../src/engine/gcode.js';
import { checkCollision, ACADEMY_MISSIONS } from '../../src/engine/crash.js';
import { requireAuth, requireAdmin } from '../authMiddleware.js';

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
academyRouter.post('/instructor', requireAuth, async (req: any, res) => {
  const { missionId, message, context } = req.body;

  const mission = ACADEMY_MISSIONS.find((m) => m.id === missionId);
  if (!mission) {
    return res.status(404).json({ error: 'Mission not found' });
  }

  const prompt = `
    You are a CNC Academy Instructor in a "Crash Lab". 
    The student is working on the mission: "${mission.name}".
    Scenario: ${mission.description}
    Fault: ${mission.faultDescription}
    Student Message: "${message}"
    Hints revealed so far: ${context?.hintsRevealed || 0} of 3.
    
    Keep your response short, industrial, and helpful. 
    Don't give the answer directly, but guide them to look at the specific G-code block that causes the crash.
    Use professional CNC terminology.
  `;

  try {
    const reply = await getGeminiResponse(prompt);
    res.json({ reply });
  } catch (err: any) {
    console.error(JSON.stringify({ route: 'POST /api/instructor', error: err?.message || String(err) }));
    res.status(500).json({ error: 'Instructor is currently unavailable' });
  }
});

// POST /api/academy/complete
academyRouter.post('/academy/complete', requireAuth, async (req: any, res) => {
  const { missionId, xpEarned, badgeId } = req.body;
  const uid = req.user.uid;

  const mission = ACADEMY_MISSIONS.find((m) => m.id === missionId);
  if (!mission) return res.status(404).json({ error: 'Mission not found' });

  try {
    const userRef = adminDb.collection('users').doc(uid).collection('academy').doc('progress');
    const userSnap = await userRef.get();
    const currentData = userSnap.exists ? userSnap.data() : { xp: 0, completedMissions: [], badges: [] };

    const completedMissions = Array.from(new Set([...(currentData?.completedMissions || []), missionId]));
    const badges = Array.from(new Set([...(currentData?.badges || []), ...(badgeId ? [badgeId] : [])]));
    const newXP = (currentData?.xp || 0) + xpEarned;

    // Determine new level
    let level = 'Trainee';
    if (newXP >= 400) level = 'Setter';
    else if (newXP >= 200) level = 'Operator';

    await userRef.set(
      {
        xp: newXP,
        level,
        completedMissions,
        badges,
        lastUpdated: new Date().toISOString(),
      },
      { merge: true }
    );

    res.json({ success: true, newXP, level });
  } catch (err: any) {
    console.error(JSON.stringify({ route: 'POST /api/academy/complete', error: err?.message || String(err) }));
    res.status(500).json({ error: 'Failed to record progress' });
  }
});
