import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setup, plan, review, eventually, fileWorker } from './helpers.js';
import { validateFields } from '../server/engine.js';

test('确认门禁、順序执行、独立 review、配置快照和反馈续做', async () => {
  const s = await setup();
  try {
    const twoSteps = {
      ...plan,
      steps: [...plan.steps, { ...plan.steps[0], id: 's2', title: '第二步' }],
    };
    s.runner.replies = [
      JSON.stringify(twoSteps),
      fileWorker,
      async (input) => {
        assert.equal(await readFile(join(input.cwd, 'result.txt'), 'utf8'), '实际改动');
        return '第二步看到前序文件';
      },
      review(),
      '首轮汇总',
    ];
    const task = await s.engine.create(s.dir, '真实需求');
    await s.engine.settled(task.id);
    assert.equal(s.store.task(task.id)?.status, 'awaiting_confirmation');
    assert.equal(s.runner.calls.length, 1);
    assert.equal(s.runner.calls[0].mode, 'plan');
    const updated = { ...s.store.config()!, version: 2 };
    updated.profiles[1].model = 'new-model';
    s.store.set('config', updated);
    await assert.rejects(s.engine.confirm(task.id, 2), /已变化/);
    await s.engine.confirm(task.id, 1);
    await assert.rejects(s.engine.confirm(task.id, 1));
    await s.engine.settled(task.id);
    const done = s.store.task(task.id)!;
    assert.equal(done.status, 'completed');
    assert.equal(done.config.version, 1);
    assert.equal(done.rounds[0].reworks, 0);
    assert.deepEqual(
      s.runner.calls.map((c) => c.profile.role),
      ['leader', 'worker', 'worker', 'reviewer', 'leader'],
    );
    assert.equal(s.runner.calls[1].profile.model, 'kimi-code/test');
    assert.equal(s.runner.calls[1].mode, 'auto');
    assert.equal(s.runner.calls[3].mode, 'plan');
    assert.deepEqual(
      done.rounds[0].artifacts.map((a) => [a.path, a.kind]),
      [['result.txt', 'added']],
    );
    await s.engine.feedback(task.id, '加入优先级');
    await s.engine.settled(task.id);
    assert.equal(s.store.task(task.id)?.rounds.length, 2);
    assert.equal(s.store.task(task.id)?.config.version, 1);
    assert.equal(s.store.task(task.id)?.rounds[0].summary, '首轮汇总');
    await s.engine.confirm(task.id, 2);
    await s.engine.settled(task.id);
    assert.equal(s.store.task(task.id)?.status, 'completed');
  } finally {
    await s.cleanup();
  }
});
test('失败 review 最多一次返工，第二次未通过也明确记录，不无限重试', async () => {
  const s = await setup();
  try {
    s.runner.replies = [
      JSON.stringify(plan),
      fileWorker,
      review(false),
      '已尝试修复',
      review(false),
      '仍未通过 review，请用户继续反馈',
    ];
    const task = await s.engine.create(s.dir, '需求');
    await s.engine.settled(task.id);
    await s.engine.confirm(task.id, 1);
    await s.engine.settled(task.id);
    const done = s.store.task(task.id)!;
    assert.equal(done.rounds[0].reworks, 1);
    assert.equal(done.rounds[0].review?.passed, false);
    assert.equal(done.rounds[0].reviewHistory?.length, 2);
    assert.equal(s.runner.calls.length, 6);
    assert.match(s.runner.calls[5].prompt, /不能宣称任务成功/);
    await s.engine.feedback(task.id, '继续修复');
    await s.engine.settled(task.id);
    assert.equal(s.store.task(task.id)?.rounds[1].reworks, 0);
  } finally {
    await s.cleanup();
  }
});
test('非法分工和不合约 JSON 不会启动执行', async () => {
  for (const output of [
    'not json',
    JSON.stringify({ ...plan, steps: [{ ...plan.steps[0], profileId: 'leader' }] }),
    JSON.stringify({ ...plan, steps: [plan.steps[0], plan.steps[0]] }),
  ]) {
    const s = await setup();
    try {
      s.runner.replies = [output];
      const t = await s.engine.create(s.dir, '需求');
      await s.engine.settled(t.id);
      assert.equal(s.store.task(t.id)?.status, 'failed');
      assert.equal(s.runner.calls.length, 1);
      await assert.rejects(s.engine.confirm(t.id, 1));
    } finally {
      await s.cleanup();
    }
  }
});
test('原生权限提示选择有效选项，处理后不被后续流更新恢复', async () => {
  const s = await setup();
  try {
    s.runner.replies = [
      JSON.stringify(plan),
      async (input) => {
        const response = await input.onRequest('session/request_permission', {
          sessionId: 'session-2',
          toolCall: { title: '运行测试' },
          options: [
            { optionId: 'once', name: '允许一次', kind: 'allow_once' },
            { optionId: 'no', name: '拒绝', kind: 'reject_once' },
          ],
        });
        assert.equal(response.outcome.optionId, 'once');
        return fileWorker(input);
      },
      review(),
      '汇总',
    ];
    const t = await s.engine.create(s.dir, '需求');
    await s.engine.settled(t.id);
    await s.engine.confirm(t.id, 1);
    await eventually(() => !!s.store.task(t.id)?.pendingInputs.length);
    const input = s.store.task(t.id)!.pendingInputs[0];
    assert.throws(() => s.engine.answer(t.id, input.id, 'all'), /无效/);
    s.engine.answer(t.id, input.id, 'once');
    assert.equal(s.store.task(t.id)?.pendingInputs.length, 0);
    await s.engine.settled(t.id);
    assert.equal(s.store.task(t.id)?.pendingInputs.length, 0);
    assert.throws(() => s.engine.answer(t.id, input.id, 'once'), /失效/);
  } finally {
    await s.cleanup();
  }
});
test('原生问题表单校验与回复', async () => {
  const s = await setup();
  try {
    s.runner.replies = [
      async (input) => {
        const response = await input.onRequest('elicitation/create', {
          sessionId: 'session-1',
          mode: 'form',
          message: '选择方案',
          requestedSchema: {
            type: 'object',
            properties: {
              choice: { type: 'string', enum: ['a', 'b'] },
              count: { type: 'integer', minimum: 1 },
            },
            required: ['choice'],
          },
        });
        assert.deepEqual(response, { action: 'accept', content: { choice: 'a', count: 2 } });
        return JSON.stringify(plan);
      },
    ];
    const t = await s.engine.create(s.dir, '需求');
    await eventually(() => !!s.store.task(t.id)?.pendingInputs.length);
    const p = s.store.task(t.id)!.pendingInputs[0];
    assert.throws(() => s.engine.answer(t.id, p.id, 'accept', { choice: 'other' }));
    s.engine.answer(t.id, p.id, 'accept', { choice: 'a', count: 2 });
    await s.engine.settled(t.id);
    assert.equal(s.store.task(t.id)?.status, 'awaiting_confirmation');
  } finally {
    await s.cleanup();
  }
});
test('取消等待权限的任务，不做 review，保留已有文件变更', async () => {
  const s = await setup();
  try {
    s.runner.replies = [
      JSON.stringify(plan),
      async (input) => {
        await writeFile(join(input.cwd, 'partial.txt'), '已改动');
        await input.onRequest('session/request_permission', {
          options: [{ optionId: 'once', name: '允许' }],
        });
        input.signal.throwIfAborted();
        return '不会执行';
      },
    ];
    const t = await s.engine.create(s.dir, '需求');
    await s.engine.settled(t.id);
    await s.engine.confirm(t.id, 1);
    await eventually(() => !!s.store.task(t.id)?.pendingInputs.length);
    await s.engine.cancel(t.id);
    const done = s.store.task(t.id)!;
    assert.equal(done.status, 'cancelled');
    assert.equal(done.pendingInputs.length, 0);
    assert.equal(s.runner.calls.length, 2);
    assert.equal(done.rounds[0].artifacts[0].path, 'partial.txt');
    assert.equal(await readFile(join(s.dir, 'partial.txt'), 'utf8'), '已改动');
    await s.engine.feedback(t.id, '继续已有改动');
    await s.engine.settled(t.id);
    assert.equal(s.store.task(t.id)?.status, 'awaiting_confirmation');
  } finally {
    await s.cleanup();
  }
});
test('同一项目串行锁阻止两个任务同时写入，取消后释放', async () => {
  const s = await setup();
  try {
    const a = await s.engine.create(s.dir, 'a');
    await s.engine.settled(a.id);
    const b = await s.engine.create(s.dir, 'b');
    await s.engine.settled(b.id);
    s.runner.replies = [
      (input) =>
        new Promise((_, reject) =>
          input.signal.addEventListener('abort', () => reject(new Error('cancelled')), {
            once: true,
          }),
        ),
    ];
    await s.engine.confirm(a.id, 1);
    await assert.rejects(s.engine.confirm(b.id, 1), /已有任务/);
    await eventually(() => s.runner.calls.length === 3);
    await s.engine.cancel(a.id);
    await s.engine.confirm(b.id, 1);
    await s.engine.settled(b.id);
    assert.equal(s.store.task(b.id)?.status, 'completed');
  } finally {
    await s.cleanup();
  }
});
test('执行失败保留错误和产物，反馈允许重新规划', async () => {
  const s = await setup();
  try {
    s.runner.replies = [
      JSON.stringify(plan),
      async (input) => {
        await writeFile(join(input.cwd, 'partial.txt'), 'partial');
        throw new Error('网络失败');
      },
    ];
    const t = await s.engine.create(s.dir, '需求');
    await s.engine.settled(t.id);
    await s.engine.confirm(t.id, 1);
    await s.engine.settled(t.id);
    assert.equal(s.store.task(t.id)?.status, 'failed');
    assert.match(s.store.task(t.id)!.error!, /网络失败/);
    assert.equal(s.store.task(t.id)?.rounds[0].artifacts.length, 1);
    await s.engine.feedback(t.id, '重试');
    await s.engine.settled(t.id);
    assert.equal(s.store.task(t.id)?.error, undefined);
  } finally {
    await s.cleanup();
  }
});
test('表单支持布尔/数值/范围/必填，拒绝错误类型', () => {
  const schema = {
    properties: {
      name: { type: 'string', minLength: 2, pattern: '^ok' },
      amount: { type: 'number', maximum: 4 },
      enabled: { type: 'boolean' },
    },
    required: ['name'],
  };
  assert.deepEqual(
    validateFields(schema, { name: 'okay', amount: 3, enabled: false, ignored: 'drop' }),
    { name: 'okay', amount: 3, enabled: false },
  );
  for (const fields of [
    {},
    { name: 'x' },
    { name: 'nope' },
    { name: 'okay', enabled: 'true' },
    { name: 'okay', amount: 5 },
    { name: 'okay', amount: NaN },
  ])
    assert.throws(() => validateFields(schema, fields));
});
test('领队与 reviewer 的写操作被拒绝，只读检查仅允许一次', async () => {
  const s = await setup();
  try {
    s.runner.replies = [
      async (input) => {
        const options = [
          { optionId: 'once', name: '一次', kind: 'allow_once' },
          { optionId: 'all', name: '整会话', kind: 'allow_always' },
          { optionId: 'no', name: '拒绝', kind: 'reject_once' },
        ];
        const denied = await input.onRequest('session/request_permission', {
          sessionId: 'session-1',
          options,
          toolCall: { title: 'WriteFile', rawInput: { path: 'file' } },
        });
        assert.equal(denied.outcome.optionId, 'no');
        const read = await input.onRequest('session/request_permission', {
          sessionId: 'session-1',
          options,
          toolCall: {
            title: 'Bash',
            content: [{ content: { text: 'Requesting approval to Running: ls -la' } }],
          },
        });
        assert.equal(read.outcome.optionId, 'once');
        return JSON.stringify(plan);
      },
    ];
    const t = await s.engine.create(s.dir, '需求');
    await s.engine.settled(t.id);
    assert.equal(s.store.task(t.id)?.pendingInputs.length, 0);
    assert.match(s.store.task(t.id)!.logs.find((l) => l.kind === 'tool')!.content, /只读保护/);
  } finally {
    await s.cleanup();
  }
});
test('工具流更新聚合为同一条活动，保留最终输出', async () => {
  const s = await setup();
  try {
    s.runner.replies = [
      async (input) => {
        input.onUpdate(
          { sessionUpdate: 'tool_call', toolCallId: 'read', title: 'Read' },
          'session-1',
        );
        for (let i = 0; i < 50; i++)
          input.onUpdate(
            {
              sessionUpdate: 'tool_call_update',
              toolCallId: 'read',
              status: i === 49 ? 'completed' : 'in_progress',
              content: [{ content: { text: String(i) } }],
            },
            'session-1',
          );
        return JSON.stringify(plan);
      },
    ];
    const task = await s.engine.create(s.dir, '需求');
    await s.engine.settled(task.id);
    const tools = s.store.task(task.id)!.logs.filter((l) => l.kind === 'tool');
    assert.equal(tools.length, 1);
    assert.match(tools[0].content, /completed\n49$/);
  } finally {
    await s.cleanup();
  }
});

test('执行详情保存会话指令、模型、思考事件和结构化工具；状态更新不丢失输出', async () => {
  const s = await setup();
  try {
    s.runner.replies = [
      async (input) => {
        input.onUpdate(
          { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '检查' } },
          'session-1',
        );
        input.onUpdate(
          { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '项目' } },
          'session-1',
        );
        input.onUpdate(
          {
            sessionUpdate: 'tool_call',
            toolCallId: 'read',
            title: 'Read file',
            kind: 'read',
            status: 'in_progress',
            rawInput: { path: 'app.js' },
            locations: [{ path: 'app.js', line: 12 }],
          },
          'session-1',
        );
        input.onUpdate(
          {
            sessionUpdate: 'tool_call_update',
            toolCallId: 'read',
            content: [{ type: 'content', content: { type: 'text', text: 'file content' } }],
            rawOutput: { text: 'file content' },
          },
          'session-1',
        );
        input.onUpdate(
          { sessionUpdate: 'tool_call_update', toolCallId: 'read', status: 'completed' },
          'session-1',
        );
        input.onUpdate(
          {
            sessionUpdate: 'tool_call',
            toolCallId: 'diff',
            title: 'Edit',
            kind: 'edit',
            content: [{ type: 'diff', path: 'app.js', oldText: 'before', newText: 'after' }],
          },
          'session-1',
        );
        return JSON.stringify(plan);
      },
    ];
    const t = await s.engine.create(s.dir, '执行详情');
    await s.engine.settled(t.id);
    const done = s.store.task(t.id)!;
    const message = done.logs.find((l) => l.kind === 'message')!;
    assert.equal(message.execution?.status, 'completed');
    assert.equal(message.execution?.model, 'kimi-code/test');
    assert.equal(message.execution?.thinking, 'high');
    assert.equal(message.execution?.stage, 'planning');
    assert.match(message.execution!.prompt, /本轮需求：执行详情/);
    assert.ok(Date.parse(message.execution!.finishedAt!) >= Date.parse(message.at));
    const thought = done.logs.filter((l) => l.kind === 'thought');
    assert.equal(thought.length, 1);
    assert.equal(thought[0].content, '检查项目');
    assert.equal(thought[0].invocationId, message.id);
    const tool = done.logs.find((l) => l.tool?.id === 'read')!;
    assert.equal(tool.invocationId, message.id);
    assert.equal(tool.sessionId, message.sessionId);
    assert.equal(tool.tool?.status, 'completed');
    assert.deepEqual(JSON.parse(tool.tool!.input!), { path: 'app.js' });
    assert.equal(tool.tool?.details, 'file content');
    assert.deepEqual(JSON.parse(tool.tool!.output!), { text: 'file content' });
    assert.deepEqual(tool.tool?.locations, [{ path: 'app.js', line: 12 }]);
    assert.match(tool.content, /completed\nfile content$/);
    assert.match(
      done.logs.find((l) => l.tool?.id === 'diff')!.tool!.details!,
      /app.js\n--- 修改前\nbefore\n\+\+\+ 修改后\nafter/,
    );
  } finally {
    await s.cleanup();
  }
});

test('工具 ID 在独立会话间隔离，超长输出有明确截断标识', async () => {
  const s = await setup();
  try {
    const emit = (input: Parameters<typeof s.runner.run>[0]) =>
      input.onUpdate(
        {
          sessionUpdate: 'tool_call',
          toolCallId: 'same',
          title: 'Read',
          rawOutput: 'x'.repeat(70_000),
        },
        'session',
      );
    s.runner.replies = [
      async (input) => {
        emit(input);
        return JSON.stringify(plan);
      },
      async (input) => {
        emit(input);
        return '已实现';
      },
      review(),
      '汇总',
    ];
    const t = await s.engine.create(s.dir, '需求');
    await s.engine.settled(t.id);
    await s.engine.confirm(t.id, 1);
    await s.engine.settled(t.id);
    const logs = s.store.task(t.id)!.logs.filter((l) => l.kind === 'tool');
    assert.equal(logs.length, 2);
    assert.notEqual(logs[0].invocationId, logs[1].invocationId);
    assert.match(logs[0].tool!.output!, /已截断/);
    assert.ok(logs[0].tool!.output!.length < 65_000);
  } finally {
    await s.cleanup();
  }
});

test('执行详情记录失败和取消，重启将运行中会话标记为中断', async () => {
  const s = await setup();
  try {
    s.runner.replies = [
      async () => {
        throw new Error('fixture failure');
      },
    ];
    const failed = await s.engine.create(s.dir, '失败');
    await s.engine.settled(failed.id);
    const log = s.store.task(failed.id)!.logs[0];
    assert.equal(log.execution?.status, 'failed');
    assert.equal(log.execution?.error, 'fixture failure');
    assert.ok(log.execution?.finishedAt);
    s.runner.replies = [
      (input) =>
        new Promise((_, reject) =>
          input.signal.addEventListener('abort', () => reject(new Error('cancelled')), {
            once: true,
          }),
        ),
    ];
    const cancelled = await s.engine.create(s.dir, '取消');
    await eventually(() => s.store.task(cancelled.id)!.logs.length > 0);
    await s.engine.cancel(cancelled.id);
    assert.equal(s.store.task(cancelled.id)!.logs[0].execution?.status, 'cancelled');
    const interrupted = structuredClone(s.store.task(failed.id)!);
    interrupted.status = 'executing';
    interrupted.logs[0].execution!.status = 'running';
    delete interrupted.logs[0].execution!.finishedAt;
    s.store.saveTask(interrupted);
    s.store.recoverInterrupted();
    const recovered = s.store.task(failed.id)!;
    assert.equal(recovered.logs[0].execution?.status, 'interrupted');
    assert.ok(recovered.logs[0].execution?.finishedAt);
  } finally {
    await s.cleanup();
  }
});
