import { isReadOnlyTool } from '../server/permissions.js';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const base = process.env.AGENTHUB_URL ?? 'http://127.0.0.1:4317';
async function api(path: string, method = 'GET', data?: unknown): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch(base + '/api' + path, {
        method,
        headers: data === undefined ? {} : { 'Content-Type': 'application/json' },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error);
      return value;
    } catch (e) {
      if (method !== 'GET' || attempt >= 3) throw e;
      await delay(1000);
    }
  }
}
const boot = await api('/bootstrap');
if (!boot.config) {
  const discovered = await api('/discover', 'POST', {});
  if (!discovered.models.length) throw new Error(discovered.error ?? '模型探测失败');
  const recommendation = await api('/recommend', 'POST', { strategy: 'balanced' });
  await api('/config', 'PUT', {
    executable: discovered.executable,
    profiles: recommendation.profiles,
    permissionMode: 'auto',
    strategy: 'balanced',
  });
}
const initial =
  '在这个目录创建一个轻量任务列表网页，支持新增、完成、删除、按全部/未完成/已完成筛选，刷新后数据保留。使用原生 HTML/CSS/JavaScript，不引入外部运行依赖；业务逻辑独立成模块，用 node:test 编写并运行测试。界面中文。提供 README 启动与测试说明。先查看目录，保留已有文件；只修改本任务需要的文件，不提交或发布。';
const task = process.env.AGENTHUB_TASK_ID
  ? await api('/tasks/' + process.env.AGENTHUB_TASK_ID)
  : await api('/tasks', 'POST', { projectPath: boot.acceptancePath, instruction: initial });
console.log(`Live task: ${task.id}`);
let last = '',
  confirmations = new Set<number>();
async function waitRound(round: number) {
  const deadline = Date.now() + 25 * 60_000;
  while (Date.now() < deadline) {
    const current = await api('/tasks/' + task.id);
    if (last !== current.status) {
      console.log(`Round ${round}: ${current.status}`);
      last = current.status;
    }
    if (current.pendingInputs.length) {
      for (const p of current.pendingInputs) {
        // Live acceptance never grants persistent or unrestricted permissions.
        const detail = p.detail ?? '',
          tool = JSON.parse(detail);
        const safe =
          isReadOnlyTool(tool) ||
          (/^(?:Write|WriteFile|Edit|EditFile)$/.test(p.title) &&
            detail.includes(boot.acceptancePath)) ||
          (p.title === 'Bash' &&
            /Running:\s*(?:node --test|npm test)\s*$/.test(
              detail.replace(/\\n/g, '\n').replace(/["}\s]+$/, ''),
            ));
        const once = p.options.find((o: any) => o.kind === 'allow_once');
        if (p.method === 'session/request_permission' && once && safe) {
          console.log(`Allow once: ${p.title}`);
          await api(`/tasks/${task.id}/input`, 'POST', { inputId: p.id, optionId: once.optionId });
        } else throw new Error(`原生请求需在工作台处理：${p.title}（任务 ${task.id}）`);
      }
    }
    if (current.status === 'awaiting_confirmation' && !confirmations.has(round)) {
      confirmations.add(round);
      console.log(`Confirming ${current.rounds.at(-1).plan.steps.length} steps`);
      await api(`/tasks/${task.id}/confirm`, 'POST', { round });
    }
    if (current.status === 'completed') return current;
    if (['failed', 'interrupted', 'cancelled'].includes(current.status))
      throw new Error(current.error ?? current.status);
    await delay(1000);
  }
  throw new Error('真实任务验收等待超时，任务保留在工作台');
}
let firstRound = task.rounds.length;
if (['interrupted', 'failed', 'cancelled'].includes(task.status)) {
  const resumed = await api(`/tasks/${task.id}/feedback`, 'POST', {
    instruction: initial + '\n继续检查并补完已有产物，再实际运行完整测试。',
  });
  firstRound = resumed.rounds.length;
}
const first = await waitRound(firstRound);
if (!first.rounds[firstRound - 1].review?.passed) throw new Error('首轮审查未通过');
console.log('First delivery passed; sending feedback');
await api(`/tasks/${task.id}/feedback`, 'POST', {
  instruction:
    '在现有任务列表基础上，增加任务优先级（高、中、低），支持按优先级筛选，同时保持完成状态筛选可组合使用。旧持久化数据可兼容读取，新增/修改优先级刷新后保留。补充并实际运行测试，更新 README。保留已有功能。',
});
const final = await waitRound(firstRound + 1);
if (!final.rounds[firstRound].review?.passed) throw new Error('反馈轮审查未通过');
await mkdir('artifacts', { recursive: true });
await writeFile(
  join('artifacts', 'live-acceptance.json'),
  JSON.stringify(
    {
      testedAt: new Date().toISOString(),
      taskId: task.id,
      projectPath: boot.acceptancePath,
      configVersion: final.config.version,
      profiles: final.config.profiles,
      verifiedRounds: [firstRound, firstRound + 1],
      rounds: final.rounds,
      sessions: final.logs
        .filter((l: any) => l.kind === 'message')
        .map((l: any) => ({ role: l.role, round: l.round, sessionId: l.sessionId })),
    },
    null,
    2,
  ),
);
console.log(`PASS: two real Kimi rounds, review passed. Evidence: artifacts/live-acceptance.json`);
