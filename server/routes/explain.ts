import { Router } from 'express';
import { requireAuth } from '../authMiddleware.js';
import { rateLimitAI } from '../rateLimiter.js';
import { MODEL_FLASH } from '../config.js';
import { getGemini, executeWithRetry } from '../geminiClient.js';
import { logAIRequest } from '../logger.js';
import { adminDb } from '../firebase.js';

export const explainRouter = Router();

explainRouter.post('/explain', requireAuth, rateLimitAI, async (req, res) => {
  const startTime = Date.now();
  const { inputs, results, language = 'en' } = req.body;
  const user = req.user!;

  if (!inputs || !results) {
    res.status(400).json({ error: 'missing_parameters', message: 'inputs and results are required' });
    return;
  }

  const prompt = `You are a senior CNC process engineer. Explain these cutting parameters to a machine operator in under 120 words. Do not change or recompute any number. Flag risks: power above 80% of machine limit, Vc outside the recommended band, deep holes, long overhang. Answer in ${language}.

Operation Setup:
- Process: ${inputs.process}
- Workpiece Material: ${inputs.material?.name || 'Standard'} (kc1=${inputs.material?.kc1}, ISO ${inputs.material?.isoClass})
- Tooling: ${inputs.toolMaterial?.toUpperCase()} Ø${inputs.diameter}mm, ${inputs.flutes || 1} flutes
- Parameters: Vc=${inputs.vc} m/min, feed=${inputs.feed}, ap=${inputs.ap || 0}mm, ae=${inputs.ae || 0}mm

Computed Physics Output:
- Spindle RPM: ${results.rpm} RPM
- Table Feed Rate: ${results.feedRate} mm/min
- Material Removal Rate (MRR): ${results.mrr} cm³/min
- Spindle Power Load: ${results.powerKw} kW (${results.powerPercent}% of ${inputs.machineMaxKw} kW Limit, Zone: ${results.powerZone})
- Spindle Torque: ${results.torqueNm} Nm
- Tangential Force: ${results.tangentialForce} N
- Warnings from Engine: ${results.validation?.warnings?.join('; ') || 'None'}`;

  try {
    const ai = getGemini();

    const response = await executeWithRetry(async () => {
      return await ai.models.generateContent({
        model: MODEL_FLASH,
        contents: prompt,
      });
    }, language);

    const explanation = response.text || 'Process analysis completed safely within standard limits.';
    const latencyMs = Date.now() - startTime;

    // Structured JSON Logging (no message text logged)
    logAIRequest({
      route: '/api/explain',
      uid: user.uid,
      controller: user.preferredController || 'generic',
      language,
      toolNames: ['cutting_engine'],
      citationCount: 0,
      latencyMs,
      model: MODEL_FLASH,
      promptTokens: response.usageMetadata?.promptTokenCount,
      outputTokens: response.usageMetadata?.candidatesTokenCount,
    });

    // Write activity row to users/{uid}/activity
    try {
      const summaryText = `${inputs.process.toUpperCase()} ${inputs.diameter}mm in ${inputs.material?.name || 'Metal'} • ${results.rpm} RPM, ${results.powerKw} kW`;
      await adminDb
        .collection('users')
        .doc(user.uid)
        .collection('activity')
        .add({
          type: 'calc',
          title: `${inputs.diameter}mm ${inputs.toolMaterial?.toUpperCase()} ${inputs.process.toUpperCase()}`,
          summary: summaryText,
          link: 'calculator',
          createdAt: new Date().toISOString(),
        });
    } catch (err) {
      console.warn('[explainRouter] Activity write notice:', err);
    }

    res.json({
      explanation,
      latencyMs,
    });
  } catch (error: any) {
    console.error('[explainRouter] Error generating explanation:', error?.message);
    res.status(500).json({
      error: 'explanation_failed',
      message: error.message || 'Failed to explain parameters',
    });
  }
});
