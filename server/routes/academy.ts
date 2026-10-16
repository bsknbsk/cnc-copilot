import { Router } from 'express';
import { adminDb } from '../firebase.js';
import { getGeminiResponse } from '../geminiClient.js';
import { parseAndVerifyGCode } from '../../src/engine/gcode.js';
import { checkCollision, ACADEMY_MISSIONS } from '../../src/engine/crash.js';
import { requireAuth } from '../authMiddleware.js';

export const academyRouter = Router();

// GET /api/academy/stats
academyRouter.get('/academy/stats', requireAuth, async (req: any, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  try {
    // In a real app, these would be aggregations. 
    // For now, let's return some realistic-looking mocked stats from Firestore if they exist, or defaults.
    const statsDoc = await adminDb.collection('stats').doc('academy').get();
    if (statsDoc.exists) {
      return res.json(statsDoc.data());
    }

    // Default stats
    return res.json({
      learners: 124,
      completions: 482,
      avgCrashes: 3.2,
      mostCommonCrash: 'Rapid Into Stock'
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch academy stats' });
  }
});

// POST /api/instructor
academyRouter.post('/instructor', async (req, res) => {
  const { missionId, message, context } = req.body;
  
  const mission = ACADEMY_MISSIONS.find(m => m.id === missionId);
  if (!mission) {
    return res.status(404).json({ error: 'Mission not found' });
  }

  const prompt = `
    You are a CNC Academy Instructor in a "Crash Lab". 
    The student is working on the mission: "${mission.name}".
    Scenario: ${mission.description}
    Fault: ${mission.faultDescription}
    Student Message: "${message}"
    Hints revealed so far: ${context.hintsRevealed} of 3.
    
    Keep your response short, industrial, and helpful. 
    Don't give the answer directly, but guide them to look at the specific G-code block that causes the crash.
    Use professional CNC terminology.
  `;

  try {
    const reply = await getGeminiResponse(prompt);
    res.json({ reply });
  } catch (err) {
    res.status(500).json({ error: 'Instructor is currently unavailable' });
  }
});

// POST /api/academy/complete
academyRouter.post('/academy/complete', requireAuth, async (req: any, res) => {
  const { missionId, xpEarned, badgeId } = req.body;
  const uid = req.user.uid;

  const mission = ACADEMY_MISSIONS.find(m => m.id === missionId);
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

    await userRef.set({
      xp: newXP,
      level,
      completedMissions,
      badges,
      lastUpdated: new Date().toISOString()
    }, { merge: true });

    // Update global stats
    const statsRef = adminDb.collection('stats').doc('academy');
    await adminDb.runTransaction(async (t: any) => {
      const sSnap = await t.get(statsRef);
      const sData = sSnap.exists ? sSnap.data() : { learners: 0, completions: 0, avgCrashes: 3, mostCommonCrash: 'Rapid Into Stock' };
      t.set(statsRef, {
        ...sData,
        completions: (sData?.completions || 0) + 1
      }, { merge: true });
    });

    res.json({ success: true, newXP, level });
  } catch (err) {
    console.error('Failed to complete mission:', err);
    res.status(500).json({ error: 'Failed to record progress' });
  }
});
