import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, mkdir, symlink } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.js';
import { parseQuota, recommendProfiles } from '../server/resources.js';
import { parseJsonOutput, planSchema, configSchema } from '../server/types.js';
import { changedFiles, snapshot, projectPath } from '../server/artifacts.js';
import { config, plan } from './helpers.js';

test('额度正确解析，缺失/未知不当作零，百分比边界钳制', () => {
  const q = parseQuota({
    usage: { limit: '100', remaining: '65', resetTime: '2030-01-01T00:00:00Z' },
    limits: [{ window: { duration: 5, timeUnit: 'HOUR' }, detail: { limit: 20, used: 6 } }],
  });
  assert.equal(q.status, 'ok');
  assert.equal(q.windows[0].usedPercent, 35);
  assert.equal(q.windows[1].usedPercent, 30);
  assert.equal(q.windows[0].resetsAt, '2030-01-01T00:00:00.000Z');
  for (const detail of [
    { limit: 100 },
    { limit: 100, remaining: null },
    { limit: 0, used: 2 },
    { limit: 'bad', used: 2 },
    { limit: 100, used: 'NaN' },
  ]) {
    const result = parseQuota({ usage: detail });
    assert.equal(result.status, 'unknown');
    assert.equal(result.windows.length, 0);
  }
  assert.equal(parseQuota({ usage: { limit: 100, used: 120 } }).windows[0].usedPercent, 100);
  assert.equal(parseQuota({ usage: { limit: 100, used: -3 } }).windows[0].usedPercent, 0);
});
test('推荐只使用真实模型与有效 thinking，同一模型可以有多个角色', () => {
  const models = [{ id: 'one', name: 'Only', efforts: ['low'], default: true, source: 'test' }];
  for (const strategy of ['balanced', 'economy', 'quality'] as const) {
    const team = recommendProfiles(models, strategy);
    assert.equal(team.length, 3);
    assert.ok(team.every((p) => p.model === 'one' && p.thinking === 'low'));
    configSchema.parse({ ...config, profiles: team });
  }
  assert.throws(() => recommendProfiles([], 'balanced'));
});
test('模型 JSON 支持代码围栏、前后解释、字符串括号，拒绝非法契约', () => {
  assert.deepEqual(parseJsonOutput('```json\n' + JSON.stringify(plan) + '\n```', planSchema), plan);
  assert.deepEqual(
    parseJsonOutput(
      '解释\n' + JSON.stringify({ ...plan, summary: 'a { b } "c"' }) + '\n完成',
      planSchema,
    ).summary,
    'a { b } "c"',
  );
  assert.throws(() => parseJsonOutput('{"steps":[]}', planSchema));
});
test('文件快照包含增删改，排除 .env、依赖、二进制及符号链接', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agenthub-files-'));
  try {
    await writeFile(join(dir, 'before.txt'), 'old');
    const before = await snapshot(dir);
    await writeFile(join(dir, 'before.txt'), 'new');
    await writeFile(join(dir, 'new.txt'), 'added');
    await writeFile(join(dir, '.env'), 'secret');
    await writeFile(join(dir, '.env.local'), 'secret');
    await writeFile(join(dir, 'binary'), Buffer.from([1, 0, 3]));
    await mkdir(join(dir, 'node_modules'));
    await writeFile(join(dir, 'node_modules', 'ignore'), 'dependency');
    await symlink('/etc/passwd', join(dir, 'link'));
    const after = await snapshot(dir);
    assert.deepEqual(Object.keys(after).sort(), ['before.txt', 'new.txt']);
    assert.deepEqual(
      changedFiles(before, after).map((a) => a.kind),
      ['modified', 'added'],
    );
    assert.equal(changedFiles(after, {})[0].kind, 'removed');
    assert.equal(changedFiles({}, { huge: 'a'.repeat(80_000) })[0].truncated, true);
    assert.equal(await projectPath(dir), dir.startsWith('/var') ? '/private' + dir : dir);
    await assert.rejects(projectPath('relative'));
    await assert.rejects(projectPath('/'));
    await assert.rejects(projectPath(homedir()));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('SQLite 保存、重开恢复中断，但不重放；等待确认和已完成任务保持状态', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agenthub-store-'));
  try {
    let store = new Store(join(dir, 'db.sqlite'));
    store.set('config', config);
    const task = (id: string, status: any, pendingInputs: any[] = []) => ({
      id,
      status,
      config,
      projectPath: dir,
      title: id,
      rounds: [],
      logs: [],
      pendingInputs,
      createdAt: '',
      updatedAt: '',
    });
    store.saveTask(task('running', 'executing'));
    store.saveTask(task('waiting', 'awaiting_confirmation'));
    store.saveTask(task('done', 'completed'));
    store.saveTask(task('input', 'planning', [{}]));
    store.close();
    store = new Store(join(dir, 'db.sqlite'));
    store.recoverInterrupted();
    assert.equal(store.config()?.version, 1);
    assert.equal(store.task('running')?.status, 'interrupted');
    assert.equal(store.task('input')?.pendingInputs.length, 0);
    assert.equal(store.task('waiting')?.status, 'awaiting_confirmation');
    assert.equal(store.task('done')?.status, 'completed');
    store.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('只读命令分类不接受 shell 注入或隐式写文件', async () => {
  const { isReadOnlyTool } = await import('../server/permissions.js');
  for (const command of [
    'ls -la',
    'cat package.json',
    'rg -n test .',
    "sed -n '1,100p' index.html",
    'git diff --stat',
    'find . -type f',
    'ls -la && cat README.md',
  ])
    assert.equal(isReadOnlyTool({ title: 'Bash', rawInput: { command } }), true, command);
  for (const command of [
    'node -e "write()"',
    'ls > out',
    'cat $(rm -rf foo)',
    'ls; touch pwn',
    'find . -delete',
    'find . -fprintf out x',
    'git diff --output=result',
    "sed -n 'w file' source",
    'git diff --ext-diff',
    'cat file | tee other',
    'pwd & rm foo',
  ])
    assert.equal(isReadOnlyTool({ title: 'Bash', rawInput: { command } }), false, command);
});
test('公开模型定位必须精确匹配官方模型池，highspeed 不等于便宜', async () => {
  const { publicModelNote } = await import('../server/resources.js');
  const document =
    '```toml\n[secondary_model.models]\n"kimi-code/k3" = "Reasoning"\n"kimi-code/kimi-for-coding-highspeed" = "Fast but priced higher"\n```';
  assert.match(publicModelNote('kimi-code/k3', document)!, /复杂推理/);
  assert.equal(publicModelNote('kimi-code/k3-256k', document), undefined);
  assert.match(publicModelNote('kimi-code/kimi-for-coding-highspeed', document)!, /价格较高/);
  assert.equal(publicModelNote('kimi-code/k3', ''), undefined);
});
test('同一数据目录服务租约阻止多实例，不误伤已有实例', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'agenthub-lease-'));
  const path = join(dir, 'store.sqlite');
  const one = new Store(path),
    two = new Store(path);
  try {
    one.acquireService();
    assert.throws(() => two.acquireService(), /已有服务/);
    two.close();
    assert.ok(one.get('_runtime'));
    one.close();
    const three = new Store(path);
    three.acquireService();
    three.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test('新版本额度接口 usages 数组及 300 分钟窗口', async () => {
  const quota = parseQuota({
    usages: [{ limit: '100', used: '20', remaining: '80' }],
    limits: [
      {
        window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' },
        detail: { limit: '100', remaining: '72' },
      },
    ],
  });
  assert.equal(quota.windows[0].name, '账号额度');
  assert.equal(quota.windows[0].usedPercent, 20);
  assert.equal(quota.windows[1].name, '5 小时额度');
  assert.ok(Math.abs(quota.windows[1].usedPercent - 28) < 0.001);
});
test('本机真实 Kimi 2.1.1 额度对象，保留月额度并合并重复 5 小时窗口', () => {
  const quota = parseQuota({
    usages: {
      limit_5h: { used_ratio: 0.5694, reset_time: '2026-10-10T20:29:33Z' },
      limit_month_total: { used_ratio: 0.0892 },
      limit_month_code: { used_ratio: 0.0892 },
      unknown: { used_ratio: null },
    },
    limits: [
      {
        window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' },
        detail: { limit: '100', used: '57' },
      },
    ],
  });
  assert.equal(quota.status, 'ok');
  assert.equal(quota.windows.length, 3);
  assert.equal(quota.windows[0].name, '5 小时额度');
  assert.ok(Math.abs(quota.windows[0].usedPercent - 56.94) < 0.001);
  assert.equal(quota.windows[1].name, '月总额度');
  assert.ok(Math.abs(quota.windows[1].usedPercent - 8.92) < 0.001);
});
test('项目目录互斥覆盖父子关系，不误判相似名称', async () => {
  const { pathsOverlap } = await import('../server/artifacts.js');
  assert.equal(pathsOverlap('/repo', '/repo/src'), true);
  assert.equal(pathsOverlap('/repo/src', '/repo'), true);
  assert.equal(pathsOverlap('/repo/a', '/repo/abc'), false);
  assert.equal(pathsOverlap('/one', '/two'), false);
});
