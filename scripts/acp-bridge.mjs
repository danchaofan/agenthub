// Keep the CLI tied to the service connection, including abrupt parent exit.
import { spawn } from 'node:child_process';
const [executable, ...args] = process.argv.slice(2);
if (!executable) process.exit(2);
const child = spawn(executable, args, {
  stdio: ['pipe', 'pipe', 'pipe'],
  detached: process.platform !== 'win32',
});
let stopping = false;
const killGroup = (signal) => {
  try {
    if (child.pid) process.kill(process.platform === 'win32' ? child.pid : -child.pid, signal);
  } catch {}
};
const stop = () => {
  if (stopping) return;
  stopping = true;
  killGroup('SIGTERM');
  const timer = setTimeout(() => {
    killGroup('SIGKILL');
    process.exit(0);
  }, 800);
  timer.unref();
};
process.stdin.pipe(child.stdin);
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
process.stdin.on('end', stop);
process.stdin.on('error', stop);
process.stdout.on('error', stop);
process.stderr.on('error', stop);
child.stdin.on('error', stop);
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
process.on('exit', () => killGroup('SIGKILL'));
child.on('error', () => process.exit(1));
child.on('exit', (code, signal) => process.exit(stopping ? 0 : (code ?? 1)));
