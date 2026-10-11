import { browserLaunchOptions } from './lib/browser';
import { chromium, expect } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
const taskId =
  process.env.AGENTHUB_TASK_ID ??
  JSON.parse(await readFile('artifacts/live-acceptance.json', 'utf8')).taskId;
const base = process.env.AGENTHUB_URL ?? 'http://127.0.0.1:4317';
const browser = await chromium.launch(browserLaunchOptions());
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(`${base}/?task=${encodeURIComponent(taskId)}`);
  await expect(page.getByText('本轮汇总已生成', { exact: false })).toBeVisible();
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/workbench.png', fullPage: true });
  console.log('Captured real task workbench: artifacts/workbench.png');
} finally {
  await browser.close();
}
