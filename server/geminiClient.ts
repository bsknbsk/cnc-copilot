import { GoogleGenAI } from '@google/genai';
import { GEMINI_API_KEY } from './config.js';

let aiInstance: GoogleGenAI | null = null;

export function getGemini(): GoogleGenAI {
  if (!aiInstance) {
    aiInstance = new GoogleGenAI({
      apiKey: GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiInstance;
}

export interface FriendlyErrorMessages {
  en: string;
  hi: string;
  ml: string;
  ta: string;
}

const FRIENDLY_ERRORS: FriendlyErrorMessages = {
  en: 'CNC Copilot is temporarily experiencing high load. Please retry in a moment.',
  hi: 'सीएनसी कोपायलट पर अभी अधिक लोड है। कृपया कुछ क्षणों में पुनः प्रयास करें।',
  ml: 'സിഎൻസി കോപൈലറ്റ് ഇപ്പോൾ ഉയർന്ന ലോഡിലാണ്. ദയവായി അല്പം കഴിഞ്ഞ് വീണ്ടും ശ്രമിക്കുക.',
  ta: 'சிஎன்சி கோபைலட் தற்போது அதிக சுமையில் உள்ளது. சிறிது நேரம் கழித்து மீண்டும் முயற்சிக்கவும்.',
};

export function getFriendlyErrorMessage(language: string = 'en'): string {
  const lang = (language in FRIENDLY_ERRORS ? language : 'en') as keyof FriendlyErrorMessages;
  return FRIENDLY_ERRORS[lang];
}

/**
 * Execute a Gemini call with a 45-second timeout and 1 retry on 429, 503, or timeout with a 2-second backoff.
 */
export async function executeWithRetry<T>(
  action: () => Promise<T>,
  language: string = 'en'
): Promise<T> {
  const timeoutMs = 45000;

  const runWithTimeout = async (): Promise<T> => {
    return Promise.race([
      action(),
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error('TIMEOUT_45S')), timeoutMs)
      ),
    ]);
  };

  try {
    return await runWithTimeout();
  } catch (err: any) {
    const status = err?.status || err?.statusCode || (err?.message?.includes('429') ? 429 : err?.message?.includes('503') ? 503 : 0);
    const isRetryable = status === 429 || status === 503 || err?.message?.includes('TIMEOUT');
    if (isRetryable) {
      console.warn(`[Gemini] Retrying after ${err?.message || status} with 2s backoff...`);
      await new Promise(r => setTimeout(r, 2000));
      try {
        return await runWithTimeout();
      } catch (retryErr: any) {
        console.error('[Gemini] Final failure after retry:', retryErr?.message || retryErr);
        throw new Error(getFriendlyErrorMessage(language));
      }
    }
    console.error('[Gemini] Call failure:', err?.message || err);
    throw new Error(getFriendlyErrorMessage(language));
  }
}
