import type { Config, Discovery, Model, Quota } from '../../../server/types';
export type Bootstrap = {
  config: Config | null;
  discovery: Discovery | null;
  models: Model[];
  quota: Quota | null;
  tasks: {
    id: string;
    title: string;
    projectPath: string;
    status: string;
    rounds: number;
    updatedAt: string;
  }[];
  acceptancePath: string;
};
export async function api(path: string, method = 'GET', data?: unknown) {
  const response = await fetch('/api' + path, {
    method,
    headers: data === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? '请求失败');
  return result;
}
