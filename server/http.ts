import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve, extname, sep } from 'node:path';
import { z } from 'zod';
import { Engine } from './engine.js';
import { configSchema, planSchema } from './types.js';
import { discoverKimi, fetchQuota, recommendProfiles, researchModels } from './resources.js';

export async function createApp(
  engine: Engine,
  options: {
    root: string;
    acceptancePath?: string;
    dev?: boolean;
    shutdownToken?: string;
    onShutdown?: () => void;
    discovery?: typeof discoverKimi;
    quota?: typeof fetchQuota;
    research?: typeof researchModels;
  },
) {
  const vite = options.dev
    ? await (
        await import('vite')
      ).createServer({
        root: join(options.root, 'web'),
        server: { middlewareMode: true },
        appType: 'spa',
      })
    : undefined;
  const staticRoot = resolve(options.root, 'dist/web');
  const peers = new Set<ServerResponse>();
  let timer: NodeJS.Timeout | undefined;
  const unsubscribe = engine.subscribe(() => {
    if (!timer)
      timer = setTimeout(() => {
        timer = undefined;
        for (const peer of peers) peer.write('event: change\ndata: {}\n\n');
      }, 150);
  });
  async function body(req: IncomingMessage) {
    if (!req.headers['content-type']?.startsWith('application/json'))
      throw new Error('需要 application/json');
    let text = '';
    for await (const chunk of req) {
      text += chunk.toString();
      if (Buffer.byteLength(text) > 2_000_000) throw new Error('请求过大');
    }
    return JSON.parse(text || '{}');
  }
  const server = createServer(async (req, res) => {
    const address = server.address(),
      port = typeof address === 'object' && address ? address.port : 4317;
    const allowed = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
    const host = req.headers.host ?? '';
    const json = (value: unknown, status = 200) => {
      res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(JSON.stringify(value));
    };
    try {
      if (!allowed.has(host)) return json({ error: '仅接受本机地址访问' }, 403);
      if (req.headers.origin && !allowed.has(new URL(req.headers.origin).host))
        return json({ error: '请求来源不允许' }, 403);
      const url = new URL(req.url ?? '/', `http://${host}`),
        path = url.pathname,
        method = req.method;
      if (path === '/healthz' && method === 'GET')
        return json({ name: 'agenthub', version: '0.1.0', pid: process.pid });
      if (path === '/api/events' && method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
        res.write('event: ready\ndata: {}\n\n');
        peers.add(res);
        const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15_000);
        req.on('close', () => {
          clearInterval(heartbeat);
          peers.delete(res);
        });
        return;
      }
      if (path === '/api/bootstrap' && method === 'GET')
        return json({
          config: engine.store.config() ?? null,
          discovery: engine.store.discovery() ?? null,
          models: engine.store.models() ?? [],
          quota: engine.store.quota() ?? null,
          tasks: engine.store.summaries(),
          acceptancePath: options.acceptancePath ?? join(options.root, 'examples/kimi-acceptance'),
        });
      if (path === '/api/discover' && method === 'POST') {
        const input = z
          .object({ executable: z.string().max(1000).optional() })
          .parse(await body(req));
        const result = await (options.discovery ?? discoverKimi)(
          options.acceptancePath ?? join(options.root, 'examples/kimi-acceptance'),
          input.executable,
        );
        engine.store.set('discovery', result);
        if (result.models.length) engine.store.set('models', result.models);
        engine.changed();
        return json(result);
      }
      if (path === '/api/quota' && method === 'POST') {
        await body(req);
        let quota = await (options.quota ?? fetchQuota)();
        const previous = engine.store.quota();
        if (quota.status !== 'ok' && previous?.windows.length)
          quota = { ...previous, status: 'stale', note: quota.note, source: quota.source };
        engine.store.set('quota', quota);
        engine.changed();
        return json(quota);
      }
      if (path === '/api/research' && method === 'POST') {
        await body(req);
        const models = await (options.research ?? researchModels)(engine.store.models() ?? []);
        engine.store.set('models', models);
        engine.changed();
        return json(models);
      }
      if (path === '/api/recommend' && method === 'POST') {
        const { strategy } = z
          .object({ strategy: z.enum(['balanced', 'economy', 'quality']) })
          .parse(await body(req));
        const quota = engine.store.quota();
        const freshQuota =
          quota?.status === 'ok' && Date.now() - Date.parse(quota.observedAt) < 5 * 60_000;
        const lowQuota = freshQuota && quota.windows.some((w) => w.usedPercent >= 80);
        const exhausted = freshQuota && quota.windows.some((w) => w.usedPercent >= 100);
        const effectiveStrategy = strategy === 'balanced' && lowQuota ? 'economy' : strategy;
        return json({
          profiles: recommendProfiles(engine.store.models() ?? [], effectiveStrategy),
          effectiveStrategy,
          reason:
            (exhausted
              ? '某个额度窗口已耗尽，请在额度重置后执行新任务。'
              : lowQuota
                ? '当前至少一个额度窗口剩余不超过 20%，建议精简任务范围并使用较低 thinking。'
                : freshQuota
                  ? '已参考最新账号共享额度。'
                  : '额度未知或已过期，未把未知值当作 0。') +
            '依据本机可用模型与默认配置分配角色；成员共享 Kimi 账号额度，未把额度拆成独立余额。推荐是可编辑的起点，尚未经过任务评测排名，速度较快不等于额度更省。',
        });
      }
      if (path === '/api/config' && method === 'PUT') {
        const value = configSchema.parse(await body(req));
        const discovery = engine.store.discovery();
        if (!discovery?.installed || discovery.executable !== value.executable)
          throw new Error('请先探测所选 Kimi 可执行文件');
        for (const p of value.profiles) {
          const m = discovery.models.find((m) => m.id === p.model);
          if (!m || (p.thinking && !m.efforts.includes(p.thinking)))
            throw new Error(`${p.name} 的模型或 thinking 不可用，请刷新模型列表`);
        }
        const config = {
          ...value,
          version: (engine.store.config()?.version ?? 0) + 1,
          savedAt: new Date().toISOString(),
        };
        engine.store.set('config', config);
        engine.changed();
        return json(config);
      }
      if (path === '/api/tasks' && method === 'POST') {
        const value = z
          .object({
            projectPath: z.string().max(1000),
            instruction: z.string().trim().min(1).max(20_000),
          })
          .parse(await body(req));
        return json(await engine.create(value.projectPath, value.instruction), 201);
      }
      const match = path.match(/^\/api\/tasks\/([\w-]+)(?:\/(confirm|feedback|cancel|input))?$/);
      if (match) {
        const [, id, action] = match;
        if (method === 'GET' && !action) {
          const task = engine.store.task(id);
          return task ? json(task) : json({ error: '任务不存在' }, 404);
        }
        if (method === 'POST') {
          const data = await body(req);
          if (action === 'confirm') {
            const value = z
              .object({ round: z.number().int().positive(), plan: planSchema.optional() })
              .parse(data);
            return json(await engine.confirm(id, value.round, value.plan));
          }
          if (action === 'feedback') {
            const value = z
              .object({ instruction: z.string().trim().min(1).max(20_000) })
              .parse(data);
            return json(await engine.feedback(id, value.instruction));
          }
          if (action === 'cancel') return json(await engine.cancel(id));
          if (action === 'input') {
            const value = z
              .object({ inputId: z.string(), optionId: z.string(), fields: z.unknown().optional() })
              .parse(data);
            return json(engine.answer(id, value.inputId, value.optionId, value.fields));
          }
        }
      }
      if (path === '/api/shutdown' && method === 'POST') {
        if (!options.shutdownToken || req.headers['x-agenthub-token'] !== options.shutdownToken)
          return json({ error: '未授权' }, 403);
        await body(req);
        json({ ok: true });
        setImmediate(() => options.onShutdown?.());
        return;
      }
      if (path.startsWith('/api/')) return json({ error: '接口不存在' }, 404);
      if (method !== 'GET' && method !== 'HEAD') return json({ error: '方法不允许' }, 405);
      if (vite) return vite.middlewares(req, res, () => json({ error: '页面不存在' }, 404));
      const decoded = decodeURIComponent(path),
        candidate = resolve(staticRoot, '.' + decoded);
      if (candidate !== staticRoot && !candidate.startsWith(staticRoot + sep))
        return json({ error: '路径不允许' }, 403);
      let file = candidate;
      try {
        if (!(await stat(file)).isFile()) file = join(staticRoot, 'index.html');
      } catch {
        file = join(staticRoot, 'index.html');
      }
      const data = await readFile(file);
      const types: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
      };
      res.writeHead(200, {
        'Content-Type': types[extname(file)] ?? 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(data);
    } catch (e) {
      if (!res.headersSent) json({ error: e instanceof Error ? e.message : '请求失败' }, 400);
      else res.end();
    }
  });
  return {
    server,
    close: async () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
      for (const peer of peers) peer.end();
      await engine.stop();
      await vite?.close();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    },
  };
}
