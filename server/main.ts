import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { Store } from './store.js';
import { Engine } from './engine.js';
import { KimiRunner } from './acp.js';
import { createApp } from './http.js';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = resolve(process.env.AGENTHUB_DATA_DIR ?? join(root, '.agenthub'));
const port = Number(process.env.AGENTHUB_PORT ?? 4317);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('AGENTHUB_PORT 无效');
const acceptancePath = join(dataDir, 'acceptance-project');
await mkdir(dataDir, { recursive: true, mode: 0o700 });
await mkdir(acceptancePath, { recursive: true });
const store = new Store(join(dataDir, 'agenthub.sqlite'));
store.acquireService();
const engine = new Engine(store, new KimiRunner());
let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  await app.close();
  store.close();
  await unlink(join(dataDir, 'server.json')).catch(() => {});
  process.exit(0);
};
const token = randomBytes(32).toString('hex');
const app = await createApp(engine, {
  root,
  acceptancePath,
  dev: process.env.AGENTHUB_DEV === '1',
  shutdownToken: token,
  onShutdown: () => void shutdown(),
});
app.server.on('error', (error) => {
  console.error(error.message);
  store.close();
  process.exit(1);
});
await new Promise<void>((resolve) => app.server.listen(port, '127.0.0.1', resolve));
store.recoverInterrupted();
await writeFile(join(dataDir, 'server.json'), JSON.stringify({ pid: process.pid, port, token }), {
  mode: 0o600,
});
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
console.log(`Agenthub ready: http://127.0.0.1:${port}`);
