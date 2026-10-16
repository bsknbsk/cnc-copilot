import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { PORT } from './server/config.js';
import { healthRouter } from './server/routes/health.js';
import { userRouter } from './server/routes/user.js';
import { explainRouter } from './server/routes/explain.js';
import { agentRouter } from './server/routes/agent.js';
import { academyRouter } from './server/routes/academy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '25mb' }));
  app.use(express.urlencoded({ extended: true, limit: '25mb' }));

  // Mount API endpoints
  app.use('/api', healthRouter);
  app.use('/api', explainRouter);
  app.use('/api', academyRouter);
  app.use('/api/user', userRouter);
  app.use('/api/agent', agentRouter);

  const isDev = process.env.NODE_ENV !== 'production';

  if (isDev) {
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[CNC Copilot] Unified full-stack server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('[CNC Copilot] Server failed to start:', err);
  process.exit(1);
});
