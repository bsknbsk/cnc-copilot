import { Router } from 'express';
import { FIREBASE_PROJECT_ID } from '../config.js';

export const healthRouter = Router();

healthRouter.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    app: 'CNC Copilot',
    tagline: 'AI explains. Physics decides.',
    firebaseProject: FIREBASE_PROJECT_ID,
    timestamp: new Date().toISOString(),
  });
});
