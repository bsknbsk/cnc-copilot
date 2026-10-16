#!/usr/bin/env node
// Design guard for CNC Copilot. No dependencies, Node built-ins only.
//
// Check mode (default):
//   1. Computes SHA-256 of every locked file listed in AGENTS.md and compares
//      with design-lock.json.
//   2. Extracts every className string literal from src/**/*.tsx and reports
//      any className recorded in design-lock.json that no longer exists.
//   Exits 1 on any locked-file change or removed className.
//   Added classNames are printed as information only.
//
// Write mode:
//   node scripts/design-guard.mjs --write
//   Creates (or replaces) design-lock.json from the current tree.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AGENTS_FILE = path.join(ROOT, 'AGENTS.md');
const LOCK_FILE = path.join(ROOT, 'design-lock.json');
const SRC_DIR = path.join(ROOT, 'src');

const toPosix = (p) => p.split(path.sep).join('/');
const rel = (abs) => toPosix(path.relative(ROOT, abs));

function walk(dir, filter) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const abs = path.join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) out.push(...walk(abs, filter));
    else if (!filter || filter(abs)) out.push(abs);
  }
  return out;
}

// Read the locked-file list from the "Never modify:" line in AGENTS.md so the
// guard and the written rules can never drift apart.
function readLockedPatterns() {
  if (!existsSync(AGENTS_FILE)) {
    throw new Error('AGENTS.md not found in repo root');
  }
  const line = readFileSync(AGENTS_FILE, 'utf8')
    .split(/\r?\n/)
    .find((l) => l.includes('Never modify:'));
  if (!line) throw new Error('No "Never modify:" line found in AGENTS.md');
  return line
    .slice(line.indexOf('Never modify:') + 'Never modify:'.length)
    .split(',')
    .map((s) => s.replace(/\(.*?\)/g, '').replace(/\.$/, '').trim())
    .filter(Boolean);
}

function expandPattern(pattern) {
  if (pattern.endsWith('/**')) {
    const base = path.join(ROOT, pattern.slice(0, -3));
    return walk(base).map(rel);
  }
  return [pattern];
}

function lockedFiles() {
  const set = new Set();
  for (const p of readLockedPatterns()) for (const f of expandPattern(p)) set.add(f);
  return [...set].sort();
}

function sha256(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!existsSync(abs)) return null;
  return createHash('sha256').update(readFileSync(abs)).digest('hex');
}

// Returns the static text parts of a template literal body, with ${...}
// expressions removed. `start` points just after the opening backtick.
function readTemplate(src, start) {
  const parts = [];
  let buf = '';
  let i = start;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\') {
      buf += src.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (ch === '`') {
      parts.push(buf);
      return { parts, end: i + 1 };
    }
    if (ch === '$' && src[i + 1] === '{') {
      parts.push(buf);
      buf = '';
      i = skipExpression(src, i + 2);
      continue;
    }
    buf += ch;
    i++;
  }
  return { parts, end: src.length };
}

// Skips a ${...} expression body, honoring nested braces, strings and
// nested template literals. Returns the index just after the closing brace.
function skipExpression(src, start) {
  let depth = 1;
  let i = start;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    if (ch === '"' || ch === "'") {
      i++;
      while (i < src.length && src[i] !== ch) i += src[i] === '\\' ? 2 : 1;
      i++;
      continue;
    }
    if (ch === '`') {
      i = readTemplate(src, i + 1).end;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    i++;
  }
  return i;
}

const normalize = (s) => s.replace(/\s+/g, ' ').trim();

function extractClassNames(src) {
  const found = [];
  // className="..." and className='...'
  const quoted = /className\s*=\s*(["'])([\s\S]*?)\1/g;
  let m;
  while ((m = quoted.exec(src))) {
    const v = normalize(m[2]);
    if (v) found.push(v);
  }
  // className={`...`} static parts
  const tpl = /className\s*=\s*\{\s*`/g;
  while ((m = tpl.exec(src))) {
    const { parts, end } = readTemplate(src, m.index + m[0].length);
    for (const p of parts) {
      const v = normalize(p);
      if (v) found.push(v);
    }
    tpl.lastIndex = end;
  }
  return found;
}

function collectClassNames() {
  const all = new Set();
  const files = walk(SRC_DIR, (f) => f.endsWith('.tsx'));
  for (const f of files) for (const c of extractClassNames(readFileSync(f, 'utf8'))) all.add(c);
  return { classNames: [...all].sort(), fileCount: files.length };
}

function writeLock() {
  const files = lockedFiles();
  const hashes = {};
  const missing = [];
  for (const f of files) {
    const h = sha256(f);
    if (h) hashes[f] = h;
    else missing.push(f);
  }
  if (missing.length) {
    console.error('[design-guard] Locked files listed in AGENTS.md are missing:');
    for (const f of missing) console.error('  - ' + f);
    process.exit(1);
  }
  const { classNames, fileCount } = collectClassNames();
  const lock = {
    note: 'Generated by scripts/design-guard.mjs --write. Do not edit by hand.',
    generatedAt: new Date().toISOString(),
    lockedFiles: hashes,
    classNames,
  };
  writeFileSync(LOCK_FILE, JSON.stringify(lock, null, 2) + '\n');
  console.log(`[design-guard] Wrote design-lock.json`);
  console.log(`  locked files: ${Object.keys(hashes).length}`);
  console.log(`  classNames:   ${classNames.length} (from ${fileCount} .tsx files)`);
}

function check() {
  if (!existsSync(LOCK_FILE)) {
    console.error('[design-guard] design-lock.json not found. Run: npm run guard:design:write');
    process.exit(1);
  }
  const lock = JSON.parse(readFileSync(LOCK_FILE, 'utf8'));
  const errors = [];

  // (a) Locked file hashes
  const current = lockedFiles();
  const lockedSet = new Set(Object.keys(lock.lockedFiles || {}));
  for (const [f, expected] of Object.entries(lock.lockedFiles || {})) {
    const actual = sha256(f);
    if (actual === null) errors.push(`locked file deleted: ${f}`);
    else if (actual !== expected) errors.push(`locked file modified: ${f}`);
  }
  for (const f of current) {
    if (!lockedSet.has(f)) errors.push(`new file in locked path (not in lock): ${f}`);
  }

  // (b) className presence
  const { classNames, fileCount } = collectClassNames();
  const now = new Set(classNames);
  const before = new Set(lock.classNames || []);
  const removed = [...before].filter((c) => !now.has(c));
  const added = [...now].filter((c) => !before.has(c));
  for (const c of removed) errors.push(`className removed: "${c}"`);

  console.log(`[design-guard] Checked ${Object.keys(lock.lockedFiles || {}).length} locked files, ${before.size} locked classNames across ${fileCount} .tsx files.`);

  if (added.length) {
    console.log(`[design-guard] INFO: ${added.length} new className(s) (information only):`);
    for (const c of added) console.log(`  + "${c}"`);
  }

  if (errors.length) {
    console.error(`[design-guard] FAIL: ${errors.length} problem(s):`);
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
  }
  console.log('[design-guard] PASS: design lock intact.');
}

try {
  if (process.argv.includes('--write')) writeLock();
  else check();
} catch (err) {
  console.error('[design-guard] ERROR: ' + (err && err.message ? err.message : String(err)));
  process.exit(1);
}
