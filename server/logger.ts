import crypto from 'crypto';

export interface AIRequestLog {
  route: string;
  uid?: string;
  controller?: string;
  language?: string;
  toolNames?: string[];
  citationCount?: number;
  latencyMs: number;
  model: string;
  promptTokens?: number;
  outputTokens?: number;
}

export function hashUid(uid: string): string {
  if (!uid) return 'anonymous';
  return crypto.createHash('sha256').update(uid).digest('hex').substring(0, 12);
}

export function logAIRequest(data: AIRequestLog): void {
  const line = {
    timestamp: new Date().toISOString(),
    route: data.route,
    uidHash: data.uid ? hashUid(data.uid) : 'unknown',
    controller: data.controller || 'generic',
    language: data.language || 'en',
    toolNames: data.toolNames || [],
    citationCount: data.citationCount || 0,
    latencyMs: Math.round(data.latencyMs),
    model: data.model,
    promptTokens: data.promptTokens || 0,
    outputTokens: data.outputTokens || 0,
  };
  // Exactly one JSON line to stdout; never log message text, images or audio
  console.log(JSON.stringify(line));
}
