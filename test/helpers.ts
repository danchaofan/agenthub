import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.js';
import { Engine } from '../server/engine.js';
import type { AgentRunner, Config } from '../server/types.js';
export const config: Config = {
  executable: '/fake/kimi',
  permissionMode: 'auto',
  strategy: 'balanced',
  version: 1,
  savedAt: new Date().toISOString(),
  profiles: [
    {
      id: 'leader',
      role: 'leader',
      name: '领队',
      model: 'kimi-code/test',
      thinking: 'high',
      description: '规划',
    },
    {
      id: 'builder',
      role: 'worker',
      name: '实现',
      model: 'kimi-code/test',
      thinking: 'low',
      description: '编码',
    },
    {
      id: 'reviewer',
      role: 'reviewer',
      name: '审查',
      model: 'kimi-code/test',
      thinking: 'high',
      description: '审查',
    },
  ],
};
export const plan = {
  summary: '构建应用',
  steps: [
    {
      id: 's1',
      title: '实现',
      profileId: 'builder',
      instruction: '编写应用并测试',
      acceptance: ['测试通过'],
    },
  ],
};
export const review = (passed = true) =>
  JSON.stringify({
    passed,
    summary: passed ? '通过' : '缺少边界测试',
    issues: passed ? [] : ['补充空输入测试'],
    tests: ['node:test 已执行'],
  });
export class FakeRunner implements AgentRunner {
  calls: Parameters<AgentRunner['run']>[0][] = [];
  replies: (string | ((input: Parameters<AgentRunner['run']>[0]) => Promise<string>))[] = [];
  async run(input: Parameters<AgentRunner['run']>[0]) {
    this.calls.push(input);
    input.onSession('session-' + this.calls.length);
    input.signal.throwIfAborted();
    const scripted = this.replies.shift();
    const result =
      typeof scripted === 'function'
        ? await scripted(input)
        : (scripted ??
          (input.profile.role === 'leader'
            ? input.prompt.includes('仅返回 JSON')
              ? JSON.stringify(plan)
              : '交付完成；测试通过。'
            : input.profile.role === 'reviewer'
              ? review()
              : '实现并完成测试'));
    input.signal.throwIfAborted();
    input.onUpdate(
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: result } },
      'session-' + this.calls.length,
    );
    return result;
  }
}
export async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'agenthub-test-'));
  const store = new Store(':memory:');
  store.set('config', structuredClone(config));
  const runner = new FakeRunner();
  const engine = new Engine(store, runner);
  return {
    dir,
    store,
    runner,
    engine,
    cleanup: async () => {
      await engine.stop();
      store.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
export async function eventually(fn: () => boolean, timeout = 4000) {
  const end = Date.now() + timeout;
  while (!fn()) {
    if (Date.now() > end) throw new Error('等待条件超时');
    await new Promise((r) => setTimeout(r, 10));
  }
}
export async function fileWorker(input: Parameters<AgentRunner['run']>[0]) {
  await writeFile(join(input.cwd, 'result.txt'), '实际改动');
  return '已写入 result.txt 并验证';
}
