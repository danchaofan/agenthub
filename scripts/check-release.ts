import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const exec = promisify(execFile);
const root = resolve('.');
let temporaryGit: string | undefined;
try {
  let args: string[] = [];
  try {
    await exec('git', ['rev-parse', '--show-toplevel'], { cwd: root });
  } catch {
    temporaryGit = await mkdtemp(join(tmpdir(), 'agenthub-release-'));
    await exec('git', ['init', '--quiet', '--bare', temporaryGit]);
    args = [`--git-dir=${temporaryGit}`, `--work-tree=${root}`];
  }
  const { stdout } = await exec(
    'git',
    [...args, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: root, maxBuffer: 10 * 1024 * 1024 },
  );
  const files = [...new Set(stdout.split('\0').filter(Boolean))];
  const findings: string[] = [];
  const blockedFile =
    /(?:^|\/)(?:\.agenthub(?:-[^/]+)?|\.kimi-code|\.aws|node_modules|dist|coverage|botmux|references|artifacts|test-results|playwright-report)(?:\/|$)|(?:^|\/)\.env(?:\..*)?$|\.(?:sqlite(?:-.*)?|db(?:-.*)?|pem|key|log)$/;
  const patterns = [
    { label: '个人机器绝对路径', regex: /\/(?:Users|home)\/[a-zA-Z0-9_.-]+\// },
    { label: '私钥内容', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
    {
      label: '疑似访问令牌',
      regex:
        /\b(?:gh[pousr]_[a-zA-Z0-9]{30,}|github_pat_[a-zA-Z0-9_]{40,}|sk-(?:proj-|ant-)?[a-zA-Z0-9_-]{32,})\b/,
    },
  ];
  for (const file of files) {
    if (file !== '.env.example' && blockedFile.test(file)) {
      findings.push(`${file}: 不应进入发布内容的文件`);
      continue;
    }
    const bytes = await readFile(join(root, file));
    if (bytes.includes(0) || bytes.length > 2_000_000) continue;
    const lines = bytes.toString('utf8').split('\n');
    for (let i = 0; i < lines.length; i++)
      for (const rule of patterns)
        if (rule.regex.test(lines[i])) findings.push(`${file}:${i + 1}: ${rule.label}`);
  }
  if (findings.length) {
    console.error(findings.join('\n'));
    process.exitCode = 1;
  } else
    console.log(
      `Release check passed: ${files.length} candidate files; local data, archives and high-confidence secrets excluded.`,
    );
} finally {
  if (temporaryGit) await rm(temporaryGit, { recursive: true, force: true });
}
