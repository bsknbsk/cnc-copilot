import dotenv from 'dotenv';
dotenv.config();

export const MODEL_FLASH = 'gemini-3.1-flash-lite';
export const MODEL_PRO = 'gemini-3.1-pro-preview';
export const MODEL_TTS = 'gemini-3.8-flash-tts';

export const FIREBASE_PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'cnc-copilot-abc26';
export const STORAGE_BUCKET = process.env.STORAGE_BUCKET || `${FIREBASE_PROJECT_ID}.firebasestorage.app`;
export const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || 'biju0716@gmail.com')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

export const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
export const PORT = parseInt(process.env.PORT || '3000', 10);
export const APP_URL = process.env.APP_URL || 'https://cnc-copilot-857267445589.asia-south1.run.app';
export const CORS_ALLOWLIST = [
  APP_URL,
  'https://cnc-copilot-857267445589.asia-south1.run.app',
  'http://localhost:3000',
  'http://localhost:8080',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:8080',
].filter(Boolean);
