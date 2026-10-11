import { spawn } from 'node:child_process';
import { readFile, readdir, mkdir, open } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const root = process.cwd(),
  dataDir = resolve(process.env.AGENTHUB_DATA_DIR ?? join(root, '.agenthub'));
async function current(): Promise<
  { pid: number; port: number; token: string; unresponsive?: boolean } | undefined
> {
  let record: { pid: number; port: number; token: string } | undefined;
  try {
    record = JSON.parse(await readFile(join(dataDir, 'server.json'), 'utf8'));
    if (
      !record ||
      !Number.isInteger(record.pid) ||
      record.pid < 1 ||
      !Number.isInteger(record.port) ||
      record.port < 1 ||
      record.port > 65535
    )
      return;
    const response = await fetch(`http://127.0.0.1:${record.port}/healthz`, {
      signal: AbortSignal.timeout(5000),
    });
    const health = await response.json();
    if (health.name === 'agenthub' && health.pid === record.pid) return record;
  } catch {}
  if (record)
    try {
      process.kill(record.pid, 0);
      return { ...record, unresponsive: true };
    } catch {}
}
async function run(args: string[], env = process.env) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit', env });
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`命令退出：${code}`))));
  });
}
const action = process.argv[2] ?? 'start';
if (action === 'build') {
  await run(['node_modules/typescript/bin/tsc', '--noEmit']);
  await run(['node_modules/vite/bin/vite.js', 'build']);
  process.exit(0);
}
if (action === 'test') {
  const files = (await readdir('test'))
    .filter((f) => f.endsWith('.test.ts'))
    .map((f) => 'test/' + f);
  await run(['--import', 'tsx', '--test', ...files]);
  process.exit(0);
}
if (action === 'test-browser') {
  await run(['node_modules/@playwright/test/cli.js', 'test']);
  process.exit(0);
}
if (action === 'dev') {
  await run(['--import', 'tsx', join(root, 'server/main.ts')], {
    ...process.env,
    AGENTHUB_DEV: '1',
  });
  process.exit(0);
}
if (action === '--help' || action === 'help') {
  console.log('Usage: agenthub.sh [start|dashboard|stop|status|build|dev|test|test-browser]');
  process.exit(0);
}
const record = await current();
if (action === 'status') {
  console.log(
    record?.unresponsive
      ? `Unresponsive: recorded process ${record.pid} exists; try stop or inspect server.log`
      : record
        ? `Running: http://127.0.0.1:${record.port}`
        : 'Stopped',
  );
  process.exit(record && !record.unresponsive ? 0 : 1);
}
if (action === 'stop') {
  if (!record) {
    console.log('Already stopped');
    process.exit(0);
  }
  const response = await fetch(`http://127.0.0.1:${record.port}/api/shutdown`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Agenthub-Token': record.token },
    body: '{}',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error('无法停止该服务');
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && (await current())) await delay(100);
  if (await current()) throw new Error('服务仍在停止，请稍后查询状态');
  console.log('Stopped');
  process.exit(0);
}
if (!['start', 'dashboard'].includes(action))
  throw new Error('Usage: agenthub.sh [start|dashboard|stop|status]');
if (record?.unresponsive)
  throw new Error('服务进程存在但没有响应，请先 stop 或检查 server.log；不会重复启动实例');
if (record) {
  console.log(`http://127.0.0.1:${record.port}`);
  process.exit(0);
}
try {
  await readFile(join(root, 'dist/web/index.html'));
} catch {
  throw new Error('先运行 npm run build（Node.js 22.13+）');
}
await mkdir(dataDir, { recursive: true, mode: 0o700 });
const log = await open(join(dataDir, 'server.log'), 'a', 0o600);
const child = spawn(process.execPath, ['--import', 'tsx', join(root, 'server/main.ts')], {
  cwd: root,
  detached: true,
  stdio: ['ignore', log.fd, log.fd],
  env: process.env,
});
child.unref();
await log.close();
for (let i = 0; i < 100; i++) {
  await delay(100);
  const ready = await current();
  if (ready && !ready.unresponsive) {
    console.log(`http://127.0.0.1:${ready.port}`);
    process.exit(0);
  }
}
throw new Error(`启动失败，请查看 ${join(dataDir, 'server.log')}`);
