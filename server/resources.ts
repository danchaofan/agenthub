import { access, readFile, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join, isAbsolute } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { AcpClient } from './acp.js';
import type { Discovery, Model, Profile, Quota } from './types.js';

const exec = promisify(execFile);
const kimiHome = () => process.env.KIMI_CODE_HOME || join(homedir(), '.kimi-code');
const flatten = (option: any) => (option?.options ?? []).flatMap((v: any) => v.options ?? [v]);
export async function findKimi(override?: string): Promise<string | undefined> {
  const candidates = override
    ? [override]
    : [
        ...(process.env.PATH ?? '').split(delimiter).map((p) => join(p, 'kimi')),
        join(homedir(), '.kimi-code', 'bin', 'kimi'),
        '/opt/homebrew/bin/kimi',
        '/usr/local/bin/kimi',
      ];
  if (override && !isAbsolute(override))
    candidates.splice(
      0,
      1,
      ...(process.env.PATH ?? '').split(delimiter).map((p) => join(p, override)),
    );
  for (const path of candidates)
    try {
      await access(path, constants.X_OK);
      if ((await stat(path)).isFile()) return path;
    } catch {}
}
async function credential(): Promise<any> {
  return JSON.parse(await readFile(join(kimiHome(), 'credentials', 'kimi-code.json'), 'utf8'));
}
export async function discoverKimi(cwd: string, override?: string): Promise<Discovery> {
  const observedAt = new Date().toISOString(),
    executable = await findKimi(override);
  if (!executable)
    return {
      installed: false,
      executable: override ?? '',
      authenticated: null,
      models: [],
      observedAt,
      error: '未找到 Kimi。安装后刷新，或填写可执行文件路径。',
    };
  let version: string | undefined,
    authenticated: boolean | null = null;
  try {
    version = (await exec(executable, ['--version'], { timeout: 15_000 })).stdout.trim();
  } catch {}
  try {
    const c = await credential();
    authenticated = !!c.access_token;
  } catch {
    if (process.env.KIMI_API_KEY) authenticated = true;
  }
  const client = new AcpClient(executable, cwd);
  try {
    await client.initialize();
    const session = await client.request('session/new', { cwd, mcpServers: [] });
    const models: Model[] = [];
    const modelField = session.configOptions?.find((o: any) => o.id === 'model');
    for (const choice of flatten(modelField)) {
      const result = await client.request('session/set_config_option', {
        sessionId: session.sessionId,
        configId: 'model',
        value: choice.value,
      });
      models.push({
        id: choice.value,
        name: choice.name,
        default: choice.value === modelField.currentValue,
        efforts: flatten(result.configOptions?.find((o: any) => o.id === 'thinking')).map(
          (o: any) => o.value,
        ),
        source: '本机 Kimi ACP',
      });
    }
    await client.request('session/close', { sessionId: session.sessionId }).catch(() => {});
    return {
      installed: true,
      executable,
      version,
      authenticated,
      models,
      currentModel: modelField?.currentValue,
      observedAt,
    };
  } catch (e) {
    return {
      installed: true,
      executable,
      version,
      authenticated,
      models: [],
      observedAt,
      error: e instanceof Error ? e.message : '模型探测失败',
    };
  } finally {
    client.close();
  }
}
export function windowName(window: any): string {
  const duration = Number(window?.duration),
    unit = String(window?.timeUnit ?? '')
      .replace('TIME_UNIT_', '')
      .toLowerCase();
  if (!Number.isFinite(duration) || duration <= 0) return '短周期额度';
  if (unit === 'minute' && duration % 60 === 0) return `${duration / 60} 小时额度`;
  const names: Record<string, string> = {
    minute: '分钟',
    hour: '小时',
    day: '天',
    week: '周',
    month: '月',
  };
  return `${duration} ${names[unit] ?? unit}额度`;
}
export function parseQuota(payload: any, observedAt = new Date().toISOString()): Quota {
  const windows: Quota['windows'] = [];
  const map = (detail: any, name: string) => {
    if (!detail) return;
    const numeric = (v: any) => (v === null || v === undefined || v === '' ? NaN : Number(v));
    const limit = numeric(detail.limit),
      used = detail.used == null ? limit - numeric(detail.remaining) : numeric(detail.used);
    if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(used)) return;
    const date = detail.resetTime ?? detail.resetAt;
    windows.push({
      name,
      usedPercent: Math.max(0, Math.min(100, (used / limit) * 100)),
      ...(date && !isNaN(Date.parse(date)) ? { resetsAt: new Date(date).toISOString() } : {}),
    });
  };
  map(payload?.usage, '周额度');
  if (Array.isArray(payload?.usages))
    for (const usage of payload.usages)
      map(usage.detail ?? usage, usage.window ? windowName(usage.window) : '账号额度');
  else if (payload?.usages && typeof payload.usages === 'object') {
    const names: Record<string, string> = {
      limit_5h: '5 小时额度',
      limit_month_total: '月总额度',
      limit_month_code: '月编码额度',
      limit_week: '周额度',
    };
    for (const [key, detail] of Object.entries(payload.usages) as [string, any][]) {
      if (
        detail?.used_ratio === null ||
        detail?.used_ratio === undefined ||
        detail?.used_ratio === ''
      )
        continue;
      const ratio = Number(detail.used_ratio);
      if (!Number.isFinite(ratio)) continue;
      const date = detail.reset_time;
      windows.push({
        name: names[key] ?? key,
        usedPercent: Math.max(0, Math.min(100, ratio * 100)),
        ...(date && !isNaN(Date.parse(date)) ? { resetsAt: new Date(date).toISOString() } : {}),
      });
    }
  }
  for (const limit of payload?.limits ?? []) {
    const name = windowName(limit.window);
    if (!windows.some((w) => w.name === name)) map(limit.detail ?? limit, name);
  }

  return {
    status: windows.length ? 'ok' : 'unknown',
    windows,
    observedAt,
    source: 'Kimi /usages',
    ...(windows.length ? {} : { note: '接口没有返回可识别的额度窗口' }),
  };
}
export async function fetchQuota(): Promise<Quota> {
  const observedAt = new Date().toISOString();
  try {
    const c = await credential();
    if (!c.access_token) throw new Error('未找到 Kimi 登录态，请运行 kimi login');
    const expiry =
      typeof c.expires_at === 'number'
        ? c.expires_at * (c.expires_at < 1e12 ? 1000 : 1)
        : Date.parse(c.expires_at ?? '');
    if (Number.isFinite(expiry) && expiry < Date.now())
      throw new Error('Kimi 登录凭证已过期，请先在终端运行 Kimi 更新登录态');
    const base = process.env.KIMI_CODE_BASE_URL || 'https://api.kimi.com/coding/v1';
    const res = await fetch(`${base.replace(/\/$/, '')}/usages`, {
      headers: { Authorization: `Bearer ${c.access_token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Kimi 额度查询失败（HTTP ${res.status}）`);
    return parseQuota(await res.json(), observedAt);
  } catch (e) {
    return {
      status: 'unknown',
      windows: [],
      observedAt,
      source: 'Kimi /usages',
      note: e instanceof Error ? e.message : '额度不可用',
    };
  }
}

export function recommendProfiles(
  models: Model[],
  strategy: 'balanced' | 'economy' | 'quality',
): Profile[] {
  if (!models.length) throw new Error('请先同步模型列表');
  const preferred = models.find((m) => m.default) ?? models[0];
  const strong =
    models.find((m) => m.id === 'kimi-code/k3') ??
    models.find((m) => /k3/i.test(m.id)) ??
    preferred;
  const economical = models.find((m) => m.id === 'kimi-code/kimi-for-coding') ?? preferred;
  const effort = (m: Model, wanted: string) =>
    m.efforts.includes(wanted)
      ? wanted
      : m.efforts.includes('high')
        ? 'high'
        : (m.efforts[0] ?? '');
  const worker = strategy === 'economy' ? economical : preferred;
  return [
    {
      id: 'leader',
      name: '领队',
      role: 'leader',
      model: strong.id,
      thinking: effort(strong, strategy === 'quality' ? 'max' : 'high'),
      description: '分析意图、拆解任务、选择执行者并汇总。优先保证分工和验收条件清晰。',
    },
    {
      id: 'builder',
      name: '编码执行者',
      role: 'worker',
      model: worker.id,
      thinking: effort(
        worker,
        strategy === 'quality' ? 'max' : strategy === 'economy' ? 'low' : 'high',
      ),
      description: '负责实现、测试及修复。遵循已确认的任务范围，报告产物和实际验证结果。',
    },
    {
      id: 'reviewer',
      name: '审查员',
      role: 'reviewer',
      model: strong.id,
      thinking: effort(strong, strategy === 'quality' ? 'max' : 'high'),
      description: '独立检查实现与测试证据，指出具体问题。与编码执行者使用独立会话。',
    },
  ];
}
export const officialModelUrl =
  'https://moonshotai.github.io/kimi-code/en/configuration/config-files.html';
export function publicModelNote(id: string, document: string): string | undefined {
  // Match a documented alias in the model-pool example, never a nearby substring.
  const table = [
    ...document.matchAll(/^\s*\[secondary_model\.models\]\s*\n([\s\S]*?)(?:```|\n\[)/gm),
  ]
    .map((m) => m[1])
    .join('\n');
  const aliases = [...table.matchAll(/"([^"\n]+)"\s*=\s*"([^"\n]+)"/g)].map((match) => match[1]);
  if (!aliases.includes(id)) return;
  if (id === 'kimi-code/k3')
    return '官方定位偏复杂推理、算法与深度调试，适合领队和审查。属于官方场景描述，尚未在本产品中完成模型对比评测。';
  if (id === 'kimi-code/kimi-for-coding')
    return '官方定位为通用编码模型，适合多数功能实现与代码修改。节省策略优先尝试它及较低 thinking，实际消耗仍需任务验证。';
  if (id === 'kimi-code/kimi-for-coding-highspeed')
    return '官方定位偏速度敏感的小改动和解释，当前配置文档提示其价格较高，因此不默认用于节省策略。';
}
export async function researchModels(models: Model[]): Promise<Model[]> {
  let document = '',
    catalog: any;
  await Promise.allSettled([
    (async () => {
      const res = await fetch(
        'https://raw.githubusercontent.com/MoonshotAI/kimi-code/main/docs/en/configuration/config-files.md',
        { signal: AbortSignal.timeout(15_000) },
      );
      if (res.ok) document = await res.text();
    })(),
    (async () => {
      const res = await fetch('https://models.dev/api.json', {
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) catalog = await res.json();
    })(),
  ]);
  const entries = Object.entries(catalog ?? {})
    .filter(([key]) => /kimi|moonshot/i.test(key))
    .flatMap(([, p]: any) => Object.entries(p.models ?? {}).map(([id, m]: any) => ({ ...m, id })));
  return models.map((m) => {
    const note = publicModelNote(m.id, document);
    const exact = entries.find(
      (e: any) => e.id === m.id || e.id === m.id.replace(/^kimi-code\//, ''),
    );
    return {
      ...m,
      researchedAt: new Date().toISOString(),
      capabilityNote:
        note ??
        (exact
          ? `公开目录精确匹配：${exact.reasoning ? '支持推理；' : ''}${exact.limit?.context ? `上下文 ${exact.limit.context}；` : ''}实际可用性以本机 ACP 为准，未声明评测排名。`
          : document || catalog
            ? '公开资料未找到该别名的精确定位；保留本机模型，不自动套用其他模型的评测或价格。'
            : '公开资料查询暂不可用。当前推荐只依据本机可用选项，不声明未经验证的能力排名。'),
      references: [
        { title: 'Kimi 官方模型配置与定位', url: officialModelUrl },
        ...(exact ? [{ title: '公开模型目录（Models.dev）', url: 'https://models.dev/' }] : []),
      ],
    };
  });
}
