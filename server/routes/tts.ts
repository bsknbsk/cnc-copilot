import { Router, Request, Response } from 'express';
import { requireAuth } from '../authMiddleware.js';
import { rateLimitAI } from '../rateLimiter.js';
import { MODEL_TTS } from '../config.js';
import { getGemini, executeWithRetry } from '../geminiClient.js';
import { adminStorage } from '../firebase.js';
import { logAIRequest } from '../logger.js';

export const ttsRouter = Router();

export function wrapPcmToWav(
  pcmData: Buffer,
  sampleRate: number = 24000,
  numChannels: number = 1,
  bitsPerSample: number = 16
): Buffer {
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmData.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcmData.length, 40);

  return Buffer.concat([header, pcmData]);
}

ttsRouter.post('/tts', requireAuth, rateLimitAI, async (req: Request, res: Response) => {
  const startTime = Date.now();
  const { messageId, text, language = 'en' } = req.body;
  const user = req.user!;

  if (!messageId || typeof messageId !== 'string' || !text || typeof text !== 'string') {
    res.status(400).json({ error: 'invalid_parameters', message: 'messageId and text are required' });
    return;
  }

  const safeMessageId = messageId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const safeLanguage = (typeof language === 'string' ? language : 'en').replace(/[^a-zA-Z0-9_-]/g, '_');
  const filePath = `tts/${user.uid}/${safeMessageId}_${safeLanguage}.wav`;

  try {
    const bucket = adminStorage.bucket();
    const file = bucket.file(filePath);

    // If the file exists, return its URL without calling Gemini
    const [exists] = await file.exists();
    if (exists) {
      const [signedUrl] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + 60 * 60 * 1000, // 1 hour
      });
      res.json({ audioUrl: signedUrl });
      return;
    }

    const ai = getGemini();
    const response = await executeWithRetry(async () => {
      return await ai.models.generateContent({
        model: MODEL_TTS,
        contents: text,
        config: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: 'Puck',
              },
            },
          },
        },
      });
    }, safeLanguage);

    const candidate = response.candidates?.[0];
    const part = candidate?.content?.parts?.find((p: any) => p.inlineData?.data);
    if (!part || !part.inlineData?.data) {
      throw new Error('No audio returned from Gemini TTS');
    }

    const rawBuffer = Buffer.from(part.inlineData.data, 'base64');
    const isWav = rawBuffer.length >= 4 && rawBuffer.toString('ascii', 0, 4) === 'RIFF';
    const wavBuffer = isWav ? rawBuffer : wrapPcmToWav(rawBuffer, 24000, 1, 16);

    await file.save(wavBuffer, {
      contentType: 'audio/wav',
      metadata: {
        cacheControl: 'public, max-age=3600',
      },
    });

    const [signedUrl] = await file.getSignedUrl({
      action: 'read',
      expires: Date.now() + 60 * 60 * 1000, // 1 hour
    });

    logAIRequest({
      route: 'POST /api/tts',
      uid: user.uid,
      model: MODEL_TTS,
      latencyMs: Date.now() - startTime,
      language: safeLanguage,
    });
    res.json({ audioUrl: signedUrl });
  } catch (error: any) {
    console.error(JSON.stringify({ route: 'POST /api/tts', error: error?.message || String(error) }));
    res.status(500).json({ error: 'tts_failed', message: 'Failed to synthesize speech' });
  }
});
