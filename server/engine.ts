import { randomUUID } from 'node:crypto';
import { isReadOnlyTool } from './permissions.js';
import { Store } from './store.js';
import { snapshot, changedFiles, projectPath, pathsOverlap } from './artifacts.js';
import {
  activeStatuses,
  parseJsonOutput,
  planSchema,
  reviewSchema,
  validatePlan,
  type AgentRunner,
  type Task,
  type Profile,
  type PendingInput,
  type Plan,
  type Log,
} from './types.js';

const now = () => new Date().toISOString();
const short = (text: string, limit = 60_000) =>
  text.length > limit ? text.slice(0, limit) + '\n[上下文已截断，请读取项目文件核实]' : text;
export function validateFields(schema: any, value: any) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请填写表单');
  const result: Record<string, unknown> = {};
  for (const [key, field] of Object.entries(schema?.properties ?? {}) as [string, any][]) {
    const v = value[key];
    if (v === undefined || v === '') {
      if (schema.required?.includes(key)) throw new Error(`缺少 ${key}`);
      else continue;
    }
    if (
      field.type === 'integer'
        ? !Number.isSafeInteger(v)
        : field.type === 'number'
          ? typeof v !== 'number' || !Number.isFinite(v)
          : field.type === 'boolean'
            ? typeof v !== 'boolean'
            : typeof v !== 'string'
    )
      throw new Error(`${key} 类型不正确`);
    if (
      typeof v === 'string' &&
      (v.length > (field.maxLength ?? 10_000) || v.length < (field.minLength ?? 0))
    )
      throw new Error(`${key} 长度不正确`);
    if (
      typeof v === 'number' &&
      (v < (field.minimum ?? -Infinity) || v > (field.maximum ?? Infinity))
    )
      throw new Error(`${key} 超出范围`);
    const values = field.enum ?? field.oneOf?.map((v: any) => v.const);
    if (values && !values.includes(v)) throw new Error(`${key} 选项不正确`);
    if (field.pattern && typeof v === 'string' && !new RegExp(field.pattern).test(v))
      throw new Error(`${key} 格式不正确`);
    result[key] = v;
  }
  return result;
}

export class Engine {
  private jobs = new Map<string, { controller: AbortController; done: Promise<void> }>();
  private waiting = new Map<
    string,
    { taskId: string; task: Task; resolve: (value: any) => void }
  >();
  private locks = new Map<string, string>();
  private listeners = new Set<() => void>();
  constructor(
    public store: Store,
    private runner: AgentRunner,
  ) {}
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  changed() {
    for (const listener of this.listeners) listener();
  }
  private save(task: Task) {
    this.store.saveTask(task);
    this.changed();
  }
  private task(id: string) {
    const task = this.store.task(id);
    if (!task) throw new Error('任务不存在');
    return task;
  }
  private launch(task: Task, operation: (signal: AbortSignal) => Promise<void>) {
    if (this.jobs.has(task.id)) throw new Error('任务仍在结束上一轮，请稍后');
    const controller = new AbortController();
    const done = Promise.resolve()
      .then(() => operation(controller.signal))
      .catch((e) => {
        if (!controller.signal.aborted) {
          task.status = 'failed';
          task.error = e instanceof Error ? e.message : '执行失败';
          this.save(task);
        }
      })
      .finally(() => {
        for (const [id, waiting] of this.waiting)
          if (waiting.taskId === task.id) {
            waiting.resolve({ outcome: { outcome: 'cancelled' } });
            this.waiting.delete(id);
          }
        task.pendingInputs = [];
        this.store.saveTask(task);
        this.jobs.delete(task.id);
        if (this.locks.get(task.projectPath) === task.id) this.locks.delete(task.projectPath);
        this.changed();
      });
    this.jobs.set(task.id, { controller, done });
  }
  async create(path: string, instruction: string): Promise<Task> {
    const config = this.store.config();
    if (!config) throw new Error('请先完成全局战队配置');
    const canonical = await projectPath(path);
    const task: Task = {
      id: randomUUID(),
      title: instruction.slice(0, 60),
      projectPath: canonical,
      config: structuredClone(config),
      status: 'planning',
      rounds: [{ number: 1, instruction, reworks: 0, artifacts: [], startedAt: now() }],
      logs: [],
      pendingInputs: [],
      createdAt: now(),
      updatedAt: now(),
    };
    this.save(task);
    this.launch(task, (signal) => this.plan(task, signal));
    return task;
  }
  private async invoke(
    task: Task,
    profile: Profile,
    mode: 'plan' | 'auto' | 'default',
    prompt: string,
    signal: AbortSignal,
  ): Promise<string> {
    signal.throwIfAborted();
    const log: Log = {
      id: randomUUID(),
      round: task.rounds.length,
      role: profile.role,
      name: profile.name,
      content: '',
      at: now(),
      kind: 'message',
      sessionId: '',
      execution: {
        profileId: profile.id,
        model: profile.model,
        thinking: profile.thinking,
        mode,
        stage: task.status,
        prompt: short(prompt),
        status: 'running',
      },
    };
    task.logs.push(log);
    this.save(task);
    const toolLogs = new Map<string, Log>();
    let thought: Log | undefined;
    const detail = (value: unknown) =>
      short(typeof value === 'string' ? value : (JSON.stringify(value, null, 2) ?? ''), 64_000);
    let streamTimer: NodeJS.Timeout | undefined;
    const flush = () => {
      if (streamTimer) clearTimeout(streamTimer);
      streamTimer = undefined;
      this.save(task);
    };
    const schedule = () => {
      if (!streamTimer) streamTimer = setTimeout(flush, 250);
    };
    let output: string;
    try {
      output = await this.runner.run({
        executable: task.config.executable,
        cwd: task.projectPath,
        profile,
        mode,
        prompt,
        signal,
        onSession: (id) => {
          log.sessionId = id;
          this.save(task);
        },
        onUpdate: (update) => {
          if (signal.aborted) return;
          if (update?.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text')
            log.content = short(log.content + update.content.text, 200_000);
          if (update?.sessionUpdate === 'agent_thought_chunk' && update.content?.type === 'text') {
            if (!thought) {
              thought = {
                id: randomUUID(),
                round: log.round,
                role: profile.role,
                name: profile.name,
                kind: 'thought',
                content: '',
                at: now(),
                sessionId: log.sessionId,
                invocationId: log.id,
              };
              task.logs.push(thought);
            }
            thought.content = short(thought.content + update.content.text, 64_000);
          }
          if (
            update?.sessionUpdate === 'tool_call' ||
            update?.sessionUpdate === 'tool_call_update'
          ) {
            const key = String(update.toolCallId ?? 'unknown');
            let tool = toolLogs.get(key);
            if (!tool) {
              tool = {
                id: randomUUID(),
                round: log.round,
                role: profile.role,
                name: profile.name,
                kind: 'tool',
                content: '',
                at: now(),
                sessionId: log.sessionId,
                invocationId: log.id,
                tool: { id: key, title: '工具调用', updatedAt: now() },
              };
              toolLogs.set(key, tool);
              task.logs.push(tool);
            }
            const activity = tool.tool!;
            if (update.title !== undefined) activity.title = String(update.title);
            if (update.kind !== undefined) activity.kind = String(update.kind);
            if (update.status !== undefined) activity.status = String(update.status);
            if (update.rawInput !== undefined) activity.input = detail(update.rawInput);
            if (update.rawOutput !== undefined) activity.output = detail(update.rawOutput);
            if (update.locations !== undefined)
              activity.locations = update.locations.slice(0, 100).map((l: any) => ({
                path: String(l.path),
                ...(typeof l.line === 'number' ? { line: l.line } : {}),
              }));
            if (update.content !== undefined)
              activity.details = short(
                update.content
                  .map((c: any) =>
                    c.type === 'diff'
                      ? `${c.path}\n--- 修改前\n${c.oldText ?? ''}\n+++ 修改后\n${c.newText ?? ''}`
                      : (c.content?.text ?? c.content?.resource?.text ?? detail(c)),
                  )
                  .join('\n\n'),
                64_000,
              );
            activity.updatedAt = now();
            tool.content = short(
              `${activity.title}${activity.status ? ' · ' + activity.status : ''}${activity.details ? '\n' + activity.details : ''}`,
              8000,
            );
          }
          schedule();
        },
        onRequest: async (method, params) => {
          signal.throwIfAborted();
          if (method !== 'session/request_permission' && method !== 'elicitation/create')
            throw new Error(`暂不支持的 Kimi 请求：${method}`);
          if (method === 'elicitation/create' && params.mode !== 'form')
            throw new Error('暂不支持 URL 引导，请在 Kimi 终端完成登录');
          if (params.sessionId && params.sessionId !== log.sessionId) throw new Error('会话不匹配');
          if (
            mode === 'plan' &&
            method === 'session/request_permission' &&
            !isReadOnlyTool(params.toolCall)
          ) {
            const reject = params.options?.find((o: any) => o.kind === 'reject_once');
            task.logs.push({
              id: randomUUID(),
              round: task.rounds.length,
              role: profile.role,
              name: profile.name,
              kind: 'tool',
              content: '只读保护：拒绝未识别为只读的操作 ' + String(params.toolCall?.title ?? ''),
              at: now(),
              sessionId: log.sessionId,
              invocationId: log.id,
            });
            this.save(task);
            return reject
              ? { outcome: { outcome: 'selected', optionId: reject.optionId } }
              : { outcome: { outcome: 'cancelled' } };
          }
          if (
            mode === 'plan' &&
            method === 'session/request_permission' &&
            isReadOnlyTool(params.toolCall)
          ) {
            const once = params.options?.find((o: any) => o.kind === 'allow_once');
            if (once) return { outcome: { outcome: 'selected', optionId: once.optionId } };
          }
          const pending: PendingInput = {
            id: randomUUID(),
            taskId: task.id,
            sessionId: log.sessionId ?? '',
            method,
            title: params.toolCall?.title ?? params.message ?? 'Kimi 需要你的确认',
            detail: short(
              JSON.stringify(params.toolCall ?? params.requestedSchema ?? {}, null, 2),
              12_000,
            ),
            options:
              method === 'session/request_permission'
                ? (params.options ?? []).filter(
                    (o: any) => mode !== 'plan' || o.kind !== 'allow_always',
                  )
                : [
                    { optionId: 'accept', name: '提交' },
                    { optionId: 'decline', name: '拒绝' },
                  ],
            fields: params.requestedSchema,
            round: task.rounds.length,
          };
          task.pendingInputs.push(pending);
          this.save(task);
          return new Promise((resolve) => {
            this.waiting.set(pending.id, { taskId: task.id, task, resolve });
          });
        },
      });
      log.execution!.status = 'completed';
    } catch (error) {
      log.execution!.status = signal.aborted ? 'cancelled' : 'failed';
      log.execution!.error = error instanceof Error ? error.message : '执行失败';
      throw error;
    } finally {
      log.execution!.finishedAt = now();
      flush();
    }
    signal.throwIfAborted();
    log.content = short(output, 200_000);
    this.save(task);
    return output;
  }
  private context(task: Task): string {
    return short(
      task.rounds
        .slice(0, -1)
        .map(
          (r) =>
            `第 ${r.number} 轮需求：${r.instruction}\n总结：${r.summary ?? r.review?.summary ?? '未完成'}\n产物：${r.artifacts.map((a) => a.path).join(', ')}`,
        )
        .join('\n\n'),
      20_000,
    );
  }
  private async plan(task: Task, signal: AbortSignal) {
    const round = task.rounds.at(-1)!;
    const leader = task.config.profiles.find((p) => p.role === 'leader')!;
    const output = await this.invoke(
      task,
      leader,
      'plan',
      `你是 Agenthub 领队。只做只读分析，不修改文件、不执行命令。检查项目，结合用户需求和历史，拆成 1 至 6 个顺序执行的步骤。只分配给下方 role=worker 的成员。每步写清范围和可验证验收条件。用户确认后才会执行。请用中文，仅返回 JSON（无 Markdown）：{"summary":"...","steps":[{"id":"s1","title":"...","profileId":"builder","instruction":"...","acceptance":["..."]}]}\n全局战队：${JSON.stringify(task.config.profiles)}\n历史：${this.context(task)}\n本轮需求：${round.instruction}`,
      signal,
    );
    const plan = parseJsonOutput(output, planSchema);
    validatePlan(plan, task.config);
    round.plan = plan;
    task.status = 'awaiting_confirmation';
    this.save(task);
  }
  async confirm(id: string, roundNumber: number, edited?: Plan) {
    const task = this.task(id);
    if (
      task.status !== 'awaiting_confirmation' ||
      task.rounds.length !== roundNumber ||
      this.jobs.has(id)
    )
      throw new Error('计划已变化或正在执行，请刷新后确认');
    if ([...this.locks.keys()].some((path) => pathsOverlap(path, task.projectPath)))
      throw new Error('该项目已有任务正在执行，请等待结束');
    const round = task.rounds.at(-1)!;
    if (edited) {
      round.plan = planSchema.parse(edited);
      validatePlan(round.plan, task.config);
    }
    if (!round.plan) throw new Error('缺少分工计划');
    this.locks.set(task.projectPath, id);
    task.status = 'executing';
    this.save(task);
    this.launch(task, (signal) => this.execute(task, signal));
    return task;
  }
  private async execute(task: Task, signal: AbortSignal) {
    const round = task.rounds.at(-1)!;
    let baseline: Record<string, string> | undefined;
    const evidence: string[] = [];
    try {
      baseline = await snapshot(task.projectPath);
      signal.throwIfAborted();
      for (const step of round.plan!.steps) {
        task.status = 'executing';
        this.save(task);
        const profile = task.config.profiles.find((p) => p.id === step.profileId)!;
        evidence.push(
          await this.invoke(
            task,
            profile,
            task.config.permissionMode,
            `你是 Agenthub 编码执行者。只完成用户已确认范围，实际实现并运行合适测试。不要 git commit/push 或发布。说明改动、真实执行的测试、结果与未解决事项，不得虚构验证。涉及网页交互时，优先实际浏览器验证；假 DOM 和纯模块单测不能冒充真实浏览器验收，未执行时明确说明。\n用户需求：${round.instruction}\n完整分工：${JSON.stringify(round.plan)}\n当前步骤：${JSON.stringify(step)}\n历史：${this.context(task)}\n前序证据：${short(evidence.join('\n'), 16_000)}`,
            signal,
          ),
        );
        round.artifacts = changedFiles(baseline, await snapshot(task.projectPath));
        signal.throwIfAborted();
        this.save(task);
      }
      const reviewer = task.config.profiles.find((p) => p.role === 'reviewer')!;
      const review = async () => {
        task.status = 'reviewing';
        this.save(task);
        const output = await this.invoke(
          task,
          reviewer,
          'plan',
          `你是独立审查员，只读代码和测试证据，不修改文件、不执行命令。检查需求、变更、测试是否可靠，指出具体缺陷，不把未经执行的测试当成已通过。逐条对照用户原始需求与实际界面，不把模块具有某个函数误判为用户已经能在页面完成该操作。区分真实浏览器测试与假 DOM/纯模块单测。若代码缺失用户要求的交互，或关键验证证据不足，passed=false。只返回 JSON：{"passed":true,"summary":"...","issues":[],"tests":["实际证据..."]}\n需求：${round.instruction}\n验收计划：${JSON.stringify(round.plan)}\n实现证据：${short(evidence.join('\n'), 32_000)}\n变更：${short(JSON.stringify(round.artifacts), 60_000)}`,
          signal,
        );
        round.review = parseJsonOutput(output, reviewSchema);
        round.reviewHistory ??= [];
        round.reviewHistory.push(structuredClone(round.review));
        this.save(task);
      };
      await review();
      if (!round.review!.passed) {
        round.reworks = 1;
        task.status = 'reworking';
        this.save(task);
        const builder = task.config.profiles.find((p) => p.id === round.plan!.steps[0].profileId)!;
        evidence.push(
          await this.invoke(
            task,
            builder,
            task.config.permissionMode,
            `本轮只允许一次自动返工。修复审查指出的问题并实际验证；遵守已确认范围，不 commit/push/发布。\n需求：${round.instruction}\n分工：${JSON.stringify(round.plan)}\n审查：${JSON.stringify(round.review)}\n前序实现：${short(evidence.join('\n'), 24_000)}`,
            signal,
          ),
        );
        round.artifacts = changedFiles(baseline, await snapshot(task.projectPath));
        signal.throwIfAborted();
        await review();
      }
      task.status = 'summarizing';
      this.save(task);
      const leader = task.config.profiles.find((p) => p.role === 'leader')!;
      round.summary = await this.invoke(
        task,
        leader,
        'plan',
        `用中文向用户汇总本轮结果，只读。明确完成情况、实际测试和证据、变更文件、审查是否通过、剩余问题。若 review.passed=false 必须明确尚未通过，不能宣称任务成功。自动返工最多一次已结束，用户可以继续反馈调整。\n用户需求：${round.instruction}\n实施证据：${short(evidence.join('\n'), 32_000)}\n审查结果：${JSON.stringify(round.review)}\n自动返工次数：${round.reworks}\n产物文件：${round.artifacts.map((a) => a.path).join(', ')}`,
        signal,
      );
      task.status = 'completed';
      round.finishedAt = now();
      this.save(task);
    } finally {
      if (baseline)
        try {
          round.artifacts = changedFiles(baseline, await snapshot(task.projectPath));
        } catch {}
      this.save(task);
    }
  }
  async feedback(id: string, instruction: string) {
    const task = this.task(id);
    if (this.jobs.has(id) || activeStatuses.includes(task.status))
      throw new Error('请等待当前轮结束，或先取消');
    task.rounds.push({
      number: task.rounds.length + 1,
      instruction,
      artifacts: [],
      reworks: 0,
      startedAt: now(),
    });
    task.status = 'planning';
    delete task.error;
    task.pendingInputs = [];
    this.save(task);
    this.launch(task, (signal) => this.plan(task, signal));
    return task;
  }
  answer(id: string, inputId: string, optionId: string, fields?: unknown) {
    const job = this.jobs.get(id),
      waiting = this.waiting.get(inputId),
      task = this.task(id);
    const input = task.pendingInputs.find((p) => p.id === inputId);
    if (!job || job.controller.signal.aborted || !waiting || waiting.taskId !== id || !input)
      throw new Error('该确认已失效');
    if (!input.options.some((o) => o.optionId === optionId)) throw new Error('无效选项');
    const response =
      input.method === 'session/request_permission'
        ? { outcome: { outcome: 'selected', optionId } }
        : optionId === 'accept'
          ? { action: 'accept', content: validateFields(input.fields, fields) }
          : { action: 'decline' };
    this.waiting.delete(inputId);
    task.pendingInputs = task.pendingInputs.filter((p) => p.id !== inputId);
    waiting.task.pendingInputs = waiting.task.pendingInputs.filter((p) => p.id !== inputId);
    waiting.task.logs.push({
      id: randomUUID(),
      round: input.round,
      role: 'user',
      name: '我',
      kind: 'status',
      content: `原生请求已回答：${input.title} → ${input.options.find((o) => o.optionId === optionId)!.name}`,
      at: now(),
      sessionId: input.sessionId,
    });
    this.save(waiting.task);
    waiting.resolve(response);
    return response;
  }
  async cancel(id: string) {
    const task = this.task(id);
    const job = this.jobs.get(id);
    if (!job && !['awaiting_confirmation'].includes(task.status))
      throw new Error('任务当前没有可取消的执行');
    if (job) {
      job.controller.abort(new Error('用户取消'));
      for (const [key, waiting] of this.waiting)
        if (waiting.taskId === id) {
          waiting.resolve({ outcome: { outcome: 'cancelled' } });
          this.waiting.delete(key);
        }
      await job.done;
    }
    const latest = this.task(id);
    latest.status = 'cancelled';
    latest.pendingInputs = [];
    latest.error = '用户取消；已产生的文件改动会保留。';
    this.save(latest);
    return latest;
  }
  async stop() {
    await Promise.all([...this.jobs.keys()].map((id) => this.cancel(id)));
  }
  async settled(id: string) {
    await this.jobs.get(id)?.done;
  }
}
