import { browserLaunchOptions } from './lib/browser';
import { chromium, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
const root = resolve('examples/kimi-acceptance');
const server = createServer(async (req, res) => {
  try {
    const path = resolve(
      root,
      '.' +
        (new URL(req.url ?? '/', 'http://localhost').pathname === '/'
          ? '/index.html'
          : decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname)),
    );
    if (!path.startsWith(root + sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    const content = await readFile(path);
    res.setHeader(
      'Content-Type',
      (
        { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' } as Record<
          string,
          string
        >
      )[extname(path)] ?? 'text/plain',
    );
    res.end(content);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
const port = (server.address() as any).port;
const browser = await chromium.launch(browserLaunchOptions());
const page = await browser.newPage({ viewport: { width: 1180, height: 820 } }),
  errors: string[] = [],
  cases: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto(`http://127.0.0.1:${port}`);
  const items = page.locator('#todo-list > li');
  await expect(items).toHaveCount(0);
  await page.getByRole('button', { name: '新增', exact: true }).click();
  await expect(items).toHaveCount(0);
  cases.push('空任务不创建');
  const add = async (title: string, priority: string) => {
    await page.getByLabel('新任务标题').fill(title);
    await page.getByLabel('任务优先级', { exact: true }).selectOption(priority);
    await page.getByRole('button', { name: '新增', exact: true }).click();
  };
  await add('高优先级任务', 'high');
  await add('低优先级任务', 'low');
  await add('中优先级任务', 'medium');
  await expect(items).toHaveCount(3);
  cases.push('三种优先级新增');
  const row = (title: string) => items.filter({ hasText: title });
  await row('高优先级任务').getByRole('checkbox').check();
  cases.push('完成任务');
  const status = page.getByRole('navigation', { name: '状态筛选' }),
    priority = page.getByRole('navigation', { name: '优先级筛选' });
  await status.getByRole('button', { name: '未完成', exact: true }).click();
  await expect(items).toHaveCount(2);
  await priority.getByRole('button', { name: '低', exact: true }).click();
  await expect(items).toHaveCount(1);
  await expect(items).toContainText('低优先级任务');
  await status.getByRole('button', { name: '已完成', exact: true }).click();
  await expect(items).toHaveCount(0);
  await priority.getByRole('button', { name: '高', exact: true }).click();
  await expect(items).toHaveCount(1);
  await expect(items).toContainText('高优先级任务');
  cases.push('状态与优先级组合筛选');
  await status.getByRole('button', { name: '全部', exact: true }).click();
  await priority.getByRole('button', { name: '全部', exact: true }).click();
  const edit = row('中优先级任务').getByRole('combobox');
  await expect(edit).toHaveCount(1);
  await edit.selectOption('high');
  cases.push('修改已有任务优先级');
  await page.reload();
  await expect(items).toHaveCount(3);
  await expect(row('高优先级任务').getByRole('checkbox')).toBeChecked();
  await expect(row('中优先级任务').getByRole('combobox')).toHaveValue('high');
  cases.push('刷新保留任务、完成状态和修改后的优先级');
  await row('低优先级任务').getByRole('button', { name: '删除' }).click();
  await expect(items).toHaveCount(2);
  await page.reload();
  await expect(items).toHaveCount(2);
  cases.push('删除并持久化');
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/kimi-acceptance.png', fullPage: true });
  await page.evaluate(() =>
    localStorage.setItem(
      'todo-list-tasks',
      JSON.stringify([{ id: 'old', title: '旧版任务', completed: false }]),
    ),
  );
  await page.reload();
  await expect(items).toHaveCount(1);
  await expect(row('旧版任务').getByRole('combobox')).toHaveValue('medium');
  cases.push('旧数据缺优先级兼容');
  await page.evaluate(() => localStorage.setItem('todo-list-tasks', '{broken'));
  await page.reload();
  await expect(items).toHaveCount(0);
  await add('恢复后新增', 'low');
  await expect(items).toHaveCount(1);
  cases.push('损坏存储容错并继续新增');
  expect(errors).toEqual([]);
  const result = {
    testedAt: new Date().toISOString(),
    browser: 'Installed Chrome / Playwright',
    passed: true,
    cases,
    errors,
    screenshot: 'artifacts/kimi-acceptance.png',
  };
  await writeFile('artifacts/acceptance-browser.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (e) {
  await mkdir('artifacts', { recursive: true });
  await writeFile(
    'artifacts/acceptance-browser-failure.json',
    JSON.stringify(
      {
        testedAt: new Date().toISOString(),
        passed: false,
        cases,
        errors,
        error: e instanceof Error ? e.message : String(e),
      },
      null,
      2,
    ),
  );
  throw e;
} finally {
  await browser.close();
  await new Promise<void>((r) => {
    server.close(() => r());
    server.closeAllConnections();
  });
}
