import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { join, relative, isAbsolute, sep } from 'node:path';
import { homedir } from 'node:os';
import type { Artifact } from './types.js';

const ignored = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.agenthub',
  '.next',
  '.venv',
  '__pycache__',
  'coverage',
]);
export async function projectPath(path: string): Promise<string> {
  if (!isAbsolute(path)) throw new Error('项目目录必须是绝对路径');
  const canonical = await realpath(path);
  if (!(await stat(canonical)).isDirectory() || canonical === sep || canonical === homedir())
    throw new Error('请选择具体项目目录');
  return canonical;
}
export async function snapshot(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  async function walk(dir: string, depth: number) {
    if (depth > 12) return;
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (Object.keys(files).length >= 1000)
        throw new Error('项目快照超过 1000 个文本文件，请选择较小的项目目录');
      if (
        ignored.has(entry.name) ||
        entry.name === '.env' ||
        entry.name.startsWith('.env.') ||
        entry.isSymbolicLink()
      )
        continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path, depth + 1);
      else if (entry.isFile() && (await stat(path)).size <= 256_000) {
        const buffer = await readFile(path);
        if (!buffer.includes(0)) files[relative(root, path)] = buffer.toString('utf8');
      }
    }
  }
  await walk(root, 0);
  return files;
}
export function changedFiles(
  before: Record<string, string>,
  after: Record<string, string>,
): Artifact[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .sort()
    .filter((p) => before[p] !== after[p])
    .map((path) => ({
      path,
      kind:
        before[path] === undefined ? 'added' : after[path] === undefined ? 'removed' : 'modified',
      before: (before[path] ?? '').slice(0, 50_000),
      after: (after[path] ?? '').slice(0, 50_000),
      truncated: (before[path]?.length ?? 0) > 50_000 || (after[path]?.length ?? 0) > 50_000,
    }));
}

export function pathsOverlap(a: string, b: string): boolean {
  return a === b || a.startsWith(b + sep) || b.startsWith(a + sep);
}
