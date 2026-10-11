// Dedicated browser-test entrypoint; never enabled through production environment flags.
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { Engine } from '../server/engine.js';
import { Store } from '../server/store.js';
import { createApp } from '../server/http.js';
import type { AgentRunner } from '../server/types.js';
const dir = await mkdtemp(join(tmpdir(), 'agenthub-browser-'));
const store = new Store(join(dir, 'db.sqlite'));
let sessions = 0;
const runner: AgentRunner = {
  async run(input) {
    input.onSession('browser-session-' + ++sessions);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 100);
      input.signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new Error('cancelled'));
        },
        { once: true },
      );
    });
    input.signal.throwIfAborted();
    let output;
    if (input.profile.role === 'leader' && input.prompt.includes('仅返回 JSON'))
      output = JSON.stringify({
        summary: '先实现，再独立审查，最后汇总。',
        steps: [
          {
            id: 's1',
            title: '实现任务列表',
            profileId: 'builder',
            instruction: '创建网页并运行测试',
            acceptance: ['新增/完成/删除与持久化通过测试'],
          },
        ],
      });
    else if (input.profile.role === 'worker') {
      if (input.prompt.includes('权限测试') && !input.prompt.includes('本轮只允许一次'))
        await input.onRequest('session/request_permission', {
          sessionId: 'browser-session-' + sessions,
          toolCall: { title: '运行 node --test', rawInput: { command: 'node --test' } },
          options: [
            { optionId: 'allow_once', name: '允许一次', kind: 'allow_once' },
            { optionId: 'reject_once', name: '拒绝', kind: 'reject_once' },
          ],
        });
      input.signal.throwIfAborted();
      input.onUpdate(
        {
          sessionUpdate: 'agent_thought_chunk',
          content: { type: 'text', text: '先检查测试结果，再完成交付。' },
        },
        'browser',
      );
      input.onUpdate(
        {
          sessionUpdate: 'tool_call',
          toolCallId: 'test',
          title: 'Running: node --test',
          kind: 'execute',
          status: 'in_progress',
          rawInput: { command: 'node --test' },
          locations: [{ path: 'result.txt', line: 1 }],
        },
        'browser',
      );
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, input.prompt.includes('详情测试') ? 1800 : 100);
        input.signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(new Error('cancelled'));
          },
          { once: true },
        );
      });
      input.signal.throwIfAborted();
      input.onUpdate(
        {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'test',
          content: [
            { type: 'content', content: { type: 'text', text: 'tests 3\npass 3\nfail 0' } },
          ],
          rawOutput: { exitCode: 0 },
        },
        'browser',
      );
      input.onUpdate(
        { sessionUpdate: 'tool_call_update', toolCallId: 'test', status: 'completed' },
        'browser',
      );
      input.onUpdate(
        {
          sessionUpdate: 'tool_call',
          toolCallId: 'write',
          title: 'Writing result.txt',
          kind: 'edit',
          status: 'completed',
          content: [{ type: 'diff', path: 'result.txt', oldText: '', newText: '任务完成' }],
        },
        'browser',
      );
      await writeFile(
        join(input.cwd, 'result.txt'),
        '任务完成\n' + (input.prompt.includes('优先级') ? '新增优先级' : '初次实现'),
      );
      output = '实现完成。实际运行 node --test，测试通过。';
    } else if (input.profile.role === 'reviewer')
      output = JSON.stringify({
        passed: true,
        summary: '功能及测试证据通过审查',
        issues: [],
        tests: ['node --test'],
      });
    else output = '本轮完成：已实现功能、通过测试与独立审查。你可以继续反馈。';
    input.onUpdate(
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: output } },
      'browser',
    );
    return output;
  },
};
const engine = new Engine(store, runner);
const discovery = async () => ({
  installed: true,
  authenticated: true,
  executable: '/fake/kimi',
  version: 'kimi test fixture',
  observedAt: new Date().toISOString(),
  models: [
    {
      id: 'kimi-code/test',
      name: 'Kimi Test',
      efforts: ['low', 'high', 'max'],
      default: true,
      source: '浏览器测试 fixture',
    },
  ],
});
const app = await createApp(engine, {
  root: resolve('.'),
  discovery,
  research: async (models) =>
    models.map((m) => ({ ...m, capabilityNote: '浏览器测试公开资料 fixture' })),
  quota: async () => ({
    status: 'ok',
    windows: [{ name: '周额度', usedPercent: 35 }],
    observedAt: new Date().toISOString(),
    source: '测试额度',
  }),
});
await new Promise<void>((r) => app.server.listen(4318, '127.0.0.1', r));
console.log('Browser test server ready');
process.on('SIGTERM', async () => {
  await app.close();
  store.close();
  await rm(dir, { recursive: true, force: true });
  process.exit(0);
});
