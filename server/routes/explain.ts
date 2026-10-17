import { Router } from 'express';
import { Type } from '@google/genai';
import { requireAuth } from '../authMiddleware.js';
import { rateLimitAI } from '../rateLimiter.js';
import { MODEL_FLASH, MODEL_PRO } from '../config.js';
import { getGemini, executeWithRetry, getFriendlyErrorMessage } from '../geminiClient.js';
import { logAIRequest } from '../logger.js';
import { adminDb } from '../firebase.js';
import { parseAndVerifyGCode } from '../../src/engine/gcode.js';

export const explainRouter = Router();

explainRouter.post('/explain', requireAuth, rateLimitAI, async (req, res) => {
  const startTime = Date.now();
  const { inputs, results, language = 'en' } = req.body;
  const user = req.user!;

  if (!inputs || !results) {
    res.status(400).json({ error: 'missing_parameters', message: 'inputs and results are required' });
    return;
  }

  const prompt = `You are a senior CNC process engineer. Explain these cutting parameters to a machine operator in under 120 words. Do not change or recompute any number. Flag risks: power above 80% of machine limit, Vc outside the recommended band, deep holes, long overhang. Respond in plain English unless the operator question was asked in another language. Keep numbers and technical symbols (RPM, mm/min, kW) standard.

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
    } catch (err: any) {
      console.warn(JSON.stringify({ level: 'warn', route: 'POST /api/explain:activity', error: err?.message || String(err) }));
    }

    res.json({
      explanation,
      latencyMs,
    });
  } catch (error: any) {
    console.error(JSON.stringify({ route: 'POST /api/explain', error: error?.message || String(error) }));
    res.status(500).json({
      error: 'explanation_failed',
      message: error.message || 'Failed to explain parameters',
    });
  }
});

explainRouter.post('/gcode-review', requireAuth, rateLimitAI, async (req, res) => {
  const startTime = Date.now();
  const { program, controller = 'fanuc', language = 'en' } = req.body;
  const user = req.user!;

  if (!program || typeof program !== 'string') {
    res.status(400).json({ error: 'missing_program', message: 'program is required and must be a string' });
    return;
  }

  // Re-run parseAndVerifyGCode on the server (do not trust client findings)
  const parseResult = parseAndVerifyGCode(program, controller);
  const findings = parseResult.findings;

  if (findings.length === 0) {
    res.json({
      reviews: [],
      additionalRisks: [],
      latencyMs: Date.now() - startTime,
    });
    return;
  }

  const prompt = `You are a senior CNC programmer for ${controller}. The deterministic checker found: ${JSON.stringify(findings)}. Explain each issue plainly for an operator, give the corrected code lines, and list any additional risks. Do not contradict the checker; you may add issues. Respond in English unless the question was asked in a specific language.`;

  try {
    const ai = getGemini();

    const response = await executeWithRetry(async () => {
      return await ai.models.generateContent({
        model: MODEL_PRO,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              reviews: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    line: { type: Type.INTEGER },
                    code: { type: Type.STRING },
                    explanation: { type: Type.STRING },
                    fix: { type: Type.STRING },
                  },
                  required: ['line', 'code', 'explanation', 'fix'],
                },
              },
              additionalRisks: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
            required: ['reviews', 'additionalRisks'],
          },
        },
      });
    }, language);

    const latencyMs = Date.now() - startTime;

    // Structured JSON Logging (no user message text logged)
    logAIRequest({
      route: '/api/gcode-review',
      uid: user.uid,
      controller: controller || user.preferredController || 'generic',
      language,
      toolNames: ['gcode_verifier'],
      citationCount: 0,
      latencyMs,
      model: MODEL_PRO,
      promptTokens: response.usageMetadata?.promptTokenCount,
      outputTokens: response.usageMetadata?.candidatesTokenCount,
    });

    let reviews: Array<{ line: number; code: string; explanation: string; fix: string }> = [];
    let additionalRisks: string[] = [];

    try {
      if (response.text) {
        const raw = JSON.parse(response.text);
        if (Array.isArray(raw)) {
          reviews = raw;
        } else if (raw && typeof raw === 'object') {
          reviews = Array.isArray(raw.reviews) ? raw.reviews : [];
          additionalRisks = Array.isArray(raw.additionalRisks) ? raw.additionalRisks : [];
        }
      }
    } catch (parseErr: any) {
      console.warn(JSON.stringify({ level: 'warn', route: 'POST /api/gcode-review:parse', error: parseErr?.message || String(parseErr) }));
    }

    res.json({
      reviews,
      additionalRisks,
      latencyMs,
    });
  } catch (error: any) {
    console.error(JSON.stringify({ route: 'POST /api/gcode-review', error: error?.message || String(error) }));
    res.status(503).json({
      error: 'ai_unavailable',
      message: getFriendlyErrorMessage(language),
    });
  }
});

