import { z } from 'zod';

export const profileSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,48}$/),
  name: z.string().trim().min(1).max(80),
  role: z.enum(['leader', 'worker', 'reviewer']),
  model: z.string().trim().min(1).max(200),
  thinking: z.string().max(30),
  description: z.string().max(2000),
});
export const configSchema = z
  .object({
    executable: z.string().trim().min(1).max(1000),
    permissionMode: z.enum(['auto', 'default']),
    strategy: z.enum(['balanced', 'economy', 'quality']),
    profiles: z.array(profileSchema).min(3).max(12),
  })
  .superRefine((v, ctx) => {
    if (
      v.profiles.filter((p) => p.role === 'leader').length !== 1 ||
      v.profiles.filter((p) => p.role === 'reviewer').length !== 1 ||
      !v.profiles.some((p) => p.role === 'worker')
    )
      ctx.addIssue({ code: 'custom', message: '需要一个 leader、一个 reviewer 和至少一个执行者' });
    if (new Set(v.profiles.map((p) => p.id)).size !== v.profiles.length)
      ctx.addIssue({ code: 'custom', message: '执行者 ID 不可重复' });
  });
export type Profile = z.infer<typeof profileSchema>;
export type Config = z.infer<typeof configSchema> & { version: number; savedAt: string };
export const planSchema = z.object({
  summary: z.string().min(1).max(6000),
  steps: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        title: z.string().min(1).max(200),
        profileId: z.string().max(48),
        instruction: z.string().min(1).max(10000),
        acceptance: z.array(z.string().max(1000)).min(1).max(12),
      }),
    )
    .min(1)
    .max(6),
});
export type Plan = z.infer<typeof planSchema>;
export const reviewSchema = z.object({
  passed: z.boolean(),
  summary: z.string().max(6000),
  issues: z.array(z.string().max(3000)).max(20),
  tests: z.array(z.string().max(1500)).max(20),
});
export type Review = z.infer<typeof reviewSchema>;
export type Status =
  | 'planning'
  | 'awaiting_confirmation'
  | 'executing'
  | 'reviewing'
  | 'reworking'
  | 'summarizing'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted';
export const activeStatuses: Status[] = [
  'planning',
  'executing',
  'reviewing',
  'reworking',
  'summarizing',
];
export type Execution = {
  profileId: string;
  model: string;
  thinking: string;
  mode: string;
  stage: Status;
  prompt: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
  finishedAt?: string;
  error?: string;
};
export type ToolActivity = {
  id: string;
  title: string;
  kind?: string;
  status?: string;
  input?: string;
  output?: string;
  details?: string;
  locations?: { path: string; line?: number }[];
  updatedAt: string;
};
export type Log = {
  id: string;
  round: number;
  role: string;
  name: string;
  content: string;
  at: string;
  kind: 'message' | 'tool' | 'thought' | 'error' | 'status';
  sessionId?: string;
  invocationId?: string;
  execution?: Execution;
  tool?: ToolActivity;
};
export type Artifact = {
  path: string;
  kind: 'added' | 'modified' | 'removed';
  before: string;
  after: string;
  truncated: boolean;
};
export type Round = {
  number: number;
  instruction: string;
  plan?: Plan;
  review?: Review;
  reviewHistory?: Review[];
  summary?: string;
  artifacts: Artifact[];
  reworks: number;
  startedAt: string;
  finishedAt?: string;
};
export type PendingInput = {
  id: string;
  taskId: string;
  sessionId: string;
  method: string;
  title: string;
  detail: string;
  options: { optionId: string; name: string; kind?: string }[];
  fields?: unknown;
  round: number;
};
export type Task = {
  id: string;
  title: string;
  projectPath: string;
  config: Config;
  status: Status;
  rounds: Round[];
  logs: Log[];
  pendingInputs: PendingInput[];
  error?: string;
  createdAt: string;
  updatedAt: string;
};
export type Model = {
  id: string;
  name: string;
  efforts: string[];
  default: boolean;
  source: string;
  capabilityNote?: string;
  references?: { title: string; url: string }[];
  researchedAt?: string;
};
export type Discovery = {
  installed: boolean;
  executable: string;
  version?: string;
  authenticated: boolean | null;
  models: Model[];
  currentModel?: string;
  observedAt: string;
  error?: string;
};
export type QuotaWindow = { name: string; usedPercent: number; resetsAt?: string };
export type Quota = {
  status: 'ok' | 'unknown' | 'stale' | 'error';
  windows: QuotaWindow[];
  observedAt: string;
  source: string;
  note?: string;
};
export interface AgentRunner {
  run(input: {
    executable: string;
    cwd: string;
    profile: Profile;
    mode: 'plan' | 'auto' | 'default';
    prompt: string;
    signal: AbortSignal;
    onUpdate: (update: any, sessionId: string) => void;
    onRequest: (method: string, params: any) => Promise<any>;
    onSession: (id: string) => void;
  }): Promise<string>;
}

export function parseJsonOutput<T>(text: string, schema: z.ZodType<T>): T {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/, '')
    .replace(/\s*```$/, '');
  try {
    return schema.parse(JSON.parse(trimmed));
  } catch {}
  // Accept explanatory text surrounding a single JSON object, never silently repair invalid fields.
  for (let start = trimmed.indexOf('{'); start >= 0; start = trimmed.indexOf('{', start + 1)) {
    let depth = 0,
      quoted = false,
      escaped = false;
    for (let end = start; end < trimmed.length; end++) {
      const c = trimmed[end];
      if (quoted) {
        if (escaped) escaped = false;
        else if (c === '\\') escaped = true;
        else if (c === '"') quoted = false;
      } else if (c === '"') quoted = true;
      else if (c === '{') depth++;
      else if (c === '}' && --depth === 0) {
        try {
          return schema.parse(JSON.parse(trimmed.slice(start, end + 1)));
        } catch {
          break;
        }
      }
    }
  }
  throw new Error('模型没有返回符合任务契约的 JSON，请调整需求后重新拆解。');
}
export function validatePlan(plan: Plan, config: Config): void {
  if (new Set(plan.steps.map((s) => s.id)).size !== plan.steps.length)
    throw new Error('计划步骤 ID 重复');
  for (const step of plan.steps)
    if (!config.profiles.some((p) => p.id === step.profileId && p.role === 'worker'))
      throw new Error(`计划选择了未配置的执行者：${step.profileId}`);
}
