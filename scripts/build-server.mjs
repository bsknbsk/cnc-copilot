import esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');

await esbuild.build({
  entryPoints: [path.join(root, 'server.ts')],
  outfile: path.join(root, 'dist-server', 'server.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  target: 'node22',
  sourcemap: true,
});

console.log('[build-server] Built dist-server/server.mjs successfully.');
