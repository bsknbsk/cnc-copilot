import { Router, Request, Response } from 'express';
import { adminDb } from '../firebase.js';
import { MODEL_FLASH } from '../config.js';
import { getGemini, executeWithRetry, getFriendlyErrorMessage } from '../geminiClient.js';
import { logAIRequest } from '../logger.js';
import { requireAuth } from '../authMiddleware.js';
import { rateLimitAI } from '../rateLimiter.js';

export const agentRouter = Router();

// 1. Diagnostic Chat endpoint
agentRouter.post('/chat', requireAuth, rateLimitAI, async (req: Request, res: Response) => {
  const startTime = Date.now();
  const { message, image, controller = 'Fanuc 0i-MF', language = 'en', chatId } = req.body;
  const user = req.user!;

  if (!message && !image) {
    res.status(400).json({ error: 'missing_input', message: 'Message or image snapshot is required' });
    return;
  }

  const prompt = `You are CNC Copilot's Senior Shopfloor Diagnostic AI, specialized in CNC machining centers, lathes, and mill-turns.
Machine Controller: ${controller}
Preferred Response Language: ${language}

Operator Query / Alarm Input:
${message || 'Analyze the provided controller screen image and identify all alarms and remediation steps.'}

Instructions:
1. Identify the exact Alarm Number, Name, and Interlock Severity (e.g. Emergency Stop, Feed Hold, Spindle Inhibit, or Warning).
2. Detail the root mechanical, pneumatic, electrical, lubrication, or G-code cause.
3. Provide a concise, step-by-step physical recovery protocol for the shopfloor operator. Include safety lockouts if needed.
4. Provide authoritative OEM Manual citations with document code and section/page numbers (e.g. Fanuc 0i-MF Maintenance Manual B-64605EN §4.3 p.184, Mitsubishi M80 Alarm Spec IB-1501252-D §2.1 p.54, or ISO 6983 G-code Standards).
5. If the operator requested in Hindi, Malayalam, or Tamil, provide the explanation directly in that language with technical terms retained in English/Latin script.`;

  try {
    const ai = getGemini();
    const parts: any[] = [];

    if (image && typeof image === 'string' && image.includes('base64,')) {
      const mimeMatch = image.match(/^data:([^;]+);base64,/);
      const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
      const base64Data = image.split('base64,')[1];
      parts.push({
        inlineData: {
          mimeType,
          data: base64Data,
        },
      });
    }

    parts.push({ text: prompt });

    const response = await executeWithRetry(async () => {
      return await ai.models.generateContent({
        model: MODEL_FLASH,
        contents: parts,
      });
    }, language);

    const replyText = response.text || 'Diagnostic analysis complete. Verify machine interlocks and clear alarms.';
    const latencyMs = Date.now() - startTime;

    // Citations stay an empty array until real grounding is configured
    const citations: Array<{ documentName: string; pageNumber: number; snippet: string }> = [];

    // Log request
    logAIRequest({
      route: '/api/agent/chat',
      uid: user.uid,
      controller,
      language,
      toolNames: ['alarm_diagnostics', 'manual_search'],
      citationCount: citations.length,
      latencyMs,
      model: MODEL_FLASH,
      promptTokens: response.usageMetadata?.promptTokenCount,
      outputTokens: response.usageMetadata?.candidatesTokenCount,
    });

    // If chatId provided, persist messages to Firestore
    if (chatId) {
      try {
        const userChatsRef = adminDb.collection('users').doc(user.uid).collection('chats').doc(chatId);
        
        // 1. Add user message (URLs only for imageUrl, max 500 chars, no base64)
        const storedImageUrl = image && typeof image === 'string' && !image.startsWith('data:') && image.length <= 500 ? image : null;
        await userChatsRef.collection('messages').add({
          role: 'user',
          text: (message || 'Pendant Camera Screen Snapshot').slice(0, 20000),
          imageUrl: storedImageUrl,
          createdAt: new Date(startTime).toISOString(),
        });

        // 2. Add assistant message
        await userChatsRef.collection('messages').add({
          role: 'model',
          text: replyText.slice(0, 20000),
          citations,
          createdAt: new Date().toISOString(),
        });

        // 3. Update chat session metadata
        await userChatsRef.set({
          title: (message || 'Alarm Diagnostic').slice(0, 48),
          controller,
          updatedAt: new Date().toISOString(),
        }, { merge: true });

        // 4. Log to user activity (type in ['chat','calc','gcode','academy'], title <= 120, summary <= 300)
        await adminDb.collection('users').doc(user.uid).collection('activity').add({
          type: 'chat',
          title: `Alarm Diagnostic: ${(message || controller).slice(0, 40)}`.slice(0, 120),
          summary: replyText.slice(0, 300),
          link: chatId,
          createdAt: new Date().toISOString(),
        });
      } catch (dbErr: any) {
        console.warn(JSON.stringify({ level: 'warn', route: 'POST /api/agent/chat:db', error: dbErr?.message || String(dbErr) }));
      }
    }

    res.json({
      reply: replyText,
      citations,
      latencyMs,
    });
  } catch (error: any) {
    console.error(JSON.stringify({ route: 'POST /api/agent/chat', error: error?.message || String(error) }));
    res.status(503).json({
      error: 'ai_unavailable',
      message: getFriendlyErrorMessage(language),
    });
  }
});
