import { readFile, mkdir } from 'node:fs/promises';
import { browserLaunchOptions } from './lib/browser';
import { chromium, expect } from '@playwright/test';
const taskId =
  process.env.AGENTHUB_TASK_ID ??
  JSON.parse(await readFile('artifacts/live-acceptance.json', 'utf8')).taskId;
const base = process.env.AGENTHUB_URL ?? 'http://127.0.0.1:4317';
const browser = await chromium.launch(browserLaunchOptions());
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/?task=${encodeURIComponent(taskId)}`);
  await page.getByRole('button', { name: '查看执行详情', exact: false }).click();
  const dialog = page.getByRole('dialog', { name: 'Coding agent 执行详情' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '2.', exact: false }).click();
  await dialog.getByLabel('搜索执行日志').fill('node --test');
  const command = dialog.locator('.execution-tool').filter({ hasText: 'node --test' }).last();
  await expect(command).toBeVisible();
  await command.locator('summary').click();
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/execution-details.png' });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('Real Kimi history execution details verified; artifacts/execution-details.png');
} finally {
  await browser.close();
}
