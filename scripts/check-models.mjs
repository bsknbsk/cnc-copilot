#!/usr/bin/env node
// Lists Gemini models available to GEMINI_API_KEY (read from .env or the
// environment). Prints model IDs that support generateContent, and separately
// any TTS-capable models. No dependencies, Node built-ins only.
// The key is sent in a header and is never printed.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_FILE = path.join(ROOT, '.env');
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

async function listAllModels(apiKey) {
  const models = [];
  let pageToken = '';
  do {
    const url = new URL(BASE);
    url.searchParams.set('pageSize', '1000');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const res = await fetch(url, { headers: { 'x-goog-api-key': apiKey } });
    if (!res.ok) {
      let detail = '';
      try {
        const body = await res.json();
        detail = body?.error?.message || '';
      } catch (err) {
        console.error(`[check-models] could not parse error body: ${err.message}`);
      }
      throw new Error(`models.list failed: HTTP ${res.status} ${detail}`.trim());
    }
    const data = await res.json();
    models.push(...(data.models || []));
    pageToken = data.nextPageToken || '';
  } while (pageToken);
  return models;
}

const id = (m) => String(m.name || '').replace(/^models\//, '');
const methods = (m) => m.supportedGenerationMethods || [];
const isTts = (m) => /tts/i.test(id(m)) || /text-to-speech|\btts\b/i.test(`${m.displayName || ''} ${m.description || ''}`);

async function main() {
  loadEnv(ENV_FILE);
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('[check-models] GEMINI_API_KEY is not set in .env or the environment.');
    process.exit(1);
  }

  const models = await listAllModels(apiKey);
  const generate = models.filter((m) => methods(m).includes('generateContent')).map(id).sort();
  const tts = models.filter(isTts).sort((a, b) => id(a).localeCompare(id(b)));

  console.log(`[check-models] ${models.length} models visible to this key.\n`);
  console.log(`Models supporting generateContent (${generate.length}):`);
  for (const g of generate) console.log(`  ${g}`);

  console.log(`\nTTS-capable models (${tts.length}):`);
  if (!tts.length) console.log('  (none)');
  for (const m of tts) console.log(`  ${id(m)}  [${methods(m).join(', ')}]`);
}

main().catch((err) => {
  console.error(`[check-models] ERROR: ${err.message}`);
  process.exit(1);
});
