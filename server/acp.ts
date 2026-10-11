import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentRunner } from './types.js';

export class AcpClient {
  child: ChildProcessWithoutNullStreams;
  private pending = new Map<
    number,
    { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();
  private nextId = 1;
  private closed = false;
  private diagnostics = '';
  onUpdate: (params: any) => void = () => {};
  onRequest: (method: string, params: any) => Promise<any> = async () => {
    throw new Error('客户端不支持此请求');
  };
  constructor(
    executable: string,
    cwd: string,
    private timeoutMs = 30_000,
    agentFile?: string,
  ) {
    this.child = spawn(
      process.execPath,
      [
        join(dirname(fileURLToPath(import.meta.url)), '../scripts/acp-bridge.mjs'),
        executable,
        ...(agentFile ? ['--agent-file', agentFile] : []),
        'acp',
      ],
      { cwd, env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const lines = createInterface({ input: this.child.stdout });
    lines.on('line', (line) => {
      if (line.length > 8_000_000) {
        this.close();
        return;
      }
      try {
        void this.receive(JSON.parse(line));
      } catch {}
    });
    this.child.stderr.on('data', (b) => {
      this.diagnostics = (this.diagnostics + b.toString()).slice(-3000);
    });
    this.child.once('error', (e) => this.fail(e));
    this.child.once('exit', (code, signal) =>
      this.fail(
        new Error(
          `Kimi 进程已退出（${code ?? signal}）${this.diagnostics ? '；请检查 Kimi 登录与配置。' : ''}`,
        ),
      ),
    );
    this.child.stdin.on('error', () => {});
  }
  private async receive(message: any) {
    if (message.method && message.id !== undefined) {
      try {
        const result = await this.onRequest(message.method, message.params);
        this.send({ jsonrpc: '2.0', id: message.id, result });
      } catch (e) {
        this.send({
          jsonrpc: '2.0',
          id: message.id,
          error: { code: -32603, message: e instanceof Error ? e.message : '请求失败' },
        });
      }
    } else if (message.method) {
      this.onUpdate(message.params);
    } else {
      const slot = this.pending.get(message.id);
      if (!slot) return;
      clearTimeout(slot.timer);
      this.pending.delete(message.id);
      if (message.error) slot.reject(new Error(`Kimi: ${message.error.message}`));
      else slot.resolve(message.result);
    }
  }
  private send(message: any) {
    if (!this.closed && !this.child.stdin.destroyed)
      this.child.stdin.write(JSON.stringify(message) + '\n');
  }
  request(method: string, params: any, timeout = this.timeoutMs): Promise<any> {
    if (this.closed) return Promise.reject(new Error('Kimi 连接已关闭'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Kimi ${method} 超时`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: '2.0', id, method, params });
    });
  }
  notify(method: string, params: any) {
    this.send({ jsonrpc: '2.0', method, params });
  }
  async initialize() {
    return this.request('initialize', {
      protocolVersion: 1,
      clientCapabilities: { elicitation: { form: {} } },
      clientInfo: { name: 'agenthub', title: 'Agenthub', version: '0.1.0' },
    });
  }
  private fail(error: Error) {
    this.closed = true;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    this.pending.clear();
  }
  close() {
    if (!this.closed) {
      this.fail(new Error('Kimi 连接已关闭'));
      this.child.kill('SIGTERM');
    }
    if (this.child.exitCode === null) {
      const t = setTimeout(() => {
        if (this.child.exitCode === null) this.child.kill('SIGKILL');
      }, 1500);
      t.unref();
    }
  }
}

export class KimiRunner implements AgentRunner {
  constructor(private turnTimeout = 20 * 60_000) {}
  async run(input: Parameters<AgentRunner['run']>[0]): Promise<string> {
    input.signal.throwIfAborted();
    const agentFile = join(
      dirname(fileURLToPath(import.meta.url)),
      'agents',
      input.mode === 'plan' ? 'readonly.md' : 'worker.md',
    );
    const client = new AcpClient(input.executable, input.cwd, 30_000, agentFile);
    let sessionId = '',
      output = '';
    const cancel = () => {
      if (sessionId) client.notify('session/cancel', { sessionId });
      client.close();
    };
    input.signal.addEventListener('abort', cancel, { once: true });
    client.onUpdate = (params) => {
      if (params?.sessionId !== sessionId) return;
      const update = params.update;
      if (update?.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text')
        output += update.content.text;
      input.onUpdate(update, sessionId);
    };
    client.onRequest = input.onRequest;
    try {
      await client.initialize();
      const session = await client.request('session/new', { cwd: input.cwd, mcpServers: [] });
      sessionId = session.sessionId;
      if (!sessionId) throw new Error('Kimi 没有返回会话 ID');
      input.onSession(sessionId);
      // The response is authoritative: changing model can change available thinking choices.
      let options = session.configOptions ?? [];
      for (const [configId, value] of [
        ['model', input.profile.model],
        ['thinking', input.profile.thinking],
        ['mode', input.mode === 'plan' ? 'default' : input.mode],
      ]) {
        if (!value) continue;
        const field = options.find((v: any) => v.id === configId);
        if (!field) throw new Error(`当前 Kimi 不支持 ${configId} 配置`);
        const values = (field.options ?? []).flatMap((v: any) => v.options ?? [v]);
        if (!values.some((v: any) => v.value === value))
          throw new Error(`Kimi 不支持 ${configId}=${value}`);
        const changed = await client.request('session/set_config_option', {
          sessionId,
          configId,
          value,
        });
        options = changed.configOptions ?? options;
        if (options.find((v: any) => v.id === configId)?.currentValue !== value)
          throw new Error(`Kimi 未应用 ${configId} 配置`);
      }
      input.signal.throwIfAborted();
      const result = await client.request(
        'session/prompt',
        { sessionId, prompt: [{ type: 'text', text: input.prompt }] },
        this.turnTimeout,
      );
      input.signal.throwIfAborted();
      if (result.stopReason !== 'end_turn')
        throw new Error(`Kimi 本轮未正常完成：${result.stopReason ?? 'unknown'}`);
      if (!output.trim()) throw new Error('Kimi 完成本轮但没有最终文本');
      return output;
    } finally {
      input.signal.removeEventListener('abort', cancel);
      client.close();
    }
  }
}
