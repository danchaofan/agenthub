import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { resolve } from 'node:path';
import { createApp } from '../server/http.js';
import { setup, config } from './helpers.js';
test('本地 API 完整流程、输入校验、CSRF、配置更新及过期额度', async () => {
  const s = await setup();
  const app = await createApp(s.engine, {
    root: resolve('.'),
    discovery: async () => ({
      executable: config.executable,
      installed: true,
      authenticated: true,
      models: [
        {
          id: config.profiles[0].model,
          name: 'Test',
          efforts: ['low', 'high'],
          default: true,
          source: 'test',
        },
      ],
      observedAt: new Date().toISOString(),
    }),
    quota: async () => ({
      status: 'unknown',
      windows: [],
      observedAt: new Date().toISOString(),
      source: 'test',
      note: '接口不可用',
    }),
  });
  await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
  const port = (app.server.address() as any).port,
    base = `http://127.0.0.1:${port}`;
  const request = (path: string, method = 'GET', data?: any, extra = {}) =>
    fetch(base + path, {
      method,
      headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...extra },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
  try {
    assert.equal((await request('/healthz')).status, 200);
    assert.equal((await request('/api/bootstrap')).status, 200);
    assert.equal(
      (
        await request(
          '/api/tasks',
          'POST',
          { projectPath: s.dir, instruction: 'evil' },
          { Origin: 'https://evil.example' },
        )
      ).status,
      403,
    );
    assert.equal(
      await new Promise<number | undefined>((resolve, reject) => {
        const req = httpRequest(
          base + '/api/bootstrap',
          { headers: { Host: 'evil.example' } },
          (res) => {
            res.resume();
            resolve(res.statusCode);
          },
        );
        req.on('error', reject);
        req.end();
      }),
      403,
    );
    assert.equal(
      (await request('/api/tasks', 'POST', { projectPath: s.dir, instruction: '' })).status,
      400,
    );
    assert.equal((await fetch(base + '/api/tasks', { method: 'POST', body: '{}' })).status, 400);
    const discovered = await (await request('/api/discover', 'POST', {})).json();
    assert.equal(discovered.models.length, 1);
    const invalid = structuredClone(config);
    invalid.profiles[0].thinking = 'impossible';
    assert.equal((await request('/api/config', 'PUT', invalid)).status, 400);
    assert.equal((await request('/api/config', 'PUT', config)).status, 200);
    const recommended = await (
      await request('/api/recommend', 'POST', { strategy: 'balanced' })
    ).json();
    assert.equal(recommended.profiles.length, 3);
    s.store.set('quota', {
      status: 'ok',
      windows: [{ name: '5 小时', usedPercent: 90 }],
      observedAt: new Date().toISOString(),
      source: 'test',
    });
    const economical = await (
      await request('/api/recommend', 'POST', { strategy: 'balanced' })
    ).json();
    assert.equal(economical.effectiveStrategy, 'economy');
    assert.equal(economical.profiles[1].thinking, 'low');
    assert.match(economical.reason, /20%/);
    s.store.set('quota', {
      status: 'ok',
      windows: [{ name: '周', usedPercent: 80 }],
      observedAt: '2030-01-01T00:00:00Z',
      source: 'test',
    });
    const quota = await (await request('/api/quota', 'POST', {})).json();
    assert.equal(quota.status, 'stale');
    assert.equal(quota.windows[0].usedPercent, 80);
    const created = await request('/api/tasks', 'POST', {
      projectPath: s.dir,
      instruction: '实现',
    });
    assert.equal(created.status, 201);
    const t = await created.json();
    await s.engine.settled(t.id);
    const persisted = await (await request('/api/tasks/' + t.id)).json();
    assert.equal(persisted.status, 'awaiting_confirmation');
    assert.equal((await request(`/api/tasks/${t.id}/confirm`, 'POST', { round: 1 })).status, 200);
    await s.engine.settled(t.id);
    assert.equal((await (await request('/api/tasks/' + t.id)).json()).status, 'completed');
    assert.equal((await request(`/api/tasks/${t.id}/confirm`, 'POST', { round: 1 })).status, 400);
    assert.equal(
      (await request(`/api/tasks/${t.id}/feedback`, 'POST', { instruction: '调整' })).status,
      200,
    );
    await s.engine.settled(t.id);
    assert.equal((await request('/api/shutdown', 'POST', {})).status, 403);
    assert.equal((await request('/api/missing')).status, 404);
  } finally {
    await app.close();
    await s.cleanup();
  }
});

test('安装验收目录由运行数据目录提供，探测与工作台使用同一路径', async () => {
  const s = await setup();
  const acceptancePath = resolve(s.dir, 'acceptance-project');
  const app = await createApp(s.engine, {
    root: resolve('.'),
    acceptancePath,
    discovery: async (cwd) => {
      assert.equal(cwd, acceptancePath);
      return {
        executable: '/fake/kimi',
        installed: true,
        authenticated: true,
        models: [],
        observedAt: new Date().toISOString(),
      };
    },
  });
  try {
    await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(app.server.address() as any).port}`;
    assert.equal(
      (await (await fetch(base + '/api/bootstrap')).json()).acceptancePath,
      acceptancePath,
    );
    const discovered = await fetch(base + '/api/discover', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(discovered.status, 200);
    assert.equal((await discovered.json()).executable, '/fake/kimi');
  } finally {
    await app.close();
    await s.cleanup();
  }
});
