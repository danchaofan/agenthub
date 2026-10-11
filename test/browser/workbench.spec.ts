import { test, expect } from '@playwright/test';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test.describe.serial('工作台真实交互', () => {
  test.beforeEach(async ({ page }) => {
    if (process.env.AGENTHUB_CAPTURE_DEMO !== '1') return;
    // Public documentation screenshots use fixture data and a neutral display path.
    await page.route('**/api/tasks/*', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch();
      const task = await response.json();
      await route.fulfill({ response, json: { ...task, projectPath: '/workspace/agenthub-demo' } });
    });
  });
  test('首次发现、生成战队、编辑 thinking、保存全局配置', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('/');
    await expect(page.getByText('Kimi Test', { exact: true })).toHaveCount(0);
    await expect(page.getByText('1 个真实可用模型', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: '生成推荐配置' }).click();
    await expect(page.getByLabel('builder thinking')).toBeVisible();
    await page.getByLabel('builder thinking').selectOption('low');
    await page.getByRole('button', { name: '保存全局配置' }).click();
    await expect(
      page.getByRole('heading', { name: '让你的战队， 一起完成下一件事。' }),
    ).toBeVisible();
    await expect(page.getByText('全局战队 v1', { exact: false })).toBeVisible();
    expect(errors).toEqual([]);
  });
  test('任务发布、编辑确认、文件预览、反馈第二轮、刷新保存历史', async ({ page }) => {
    const dir = await mkdtemp(join(tmpdir(), 'agenthub-ui-'));
    try {
      await page.goto('/');
      await page.getByLabel('项目目录').fill(dir);
      await page.getByLabel('任务需求').fill('创建可持久化任务列表');
      await page.getByRole('button', { name: '提交任务' }).click();
      await expect(page.getByRole('button', { name: '确认分工并执行' })).toBeVisible();
      await expect(page.getByText('执行后在这里查看变更。')).toBeVisible();
      await page.getByRole('button', { name: '编辑分工' }).click();
      await page.getByLabel('步骤 1 标题').fill('实现并测试');
      await page.getByRole('button', { name: '完成编辑' }).click();
      await page.getByRole('button', { name: '确认分工并执行' }).click();
      await expect(page.getByText('本轮汇总已生成', { exact: false })).toBeVisible();
      await page.getByRole('button', { name: '+ result.txt' }).click();
      await expect(page.getByRole('dialog', { name: '文件变更预览' })).toBeVisible();
      await expect(page.getByText('修改后', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: '关闭 ×' }).click();
      await page.getByLabel('结果反馈').fill('增加任务优先级和筛选');
      await page.getByRole('button', { name: '提交反馈' }).click();
      await page.getByRole('button', { name: '确认分工并执行' }).click();
      await expect(page.getByText('本轮汇总已生成', { exact: false })).toBeVisible();
      await expect(page.getByRole('button', { name: '第 1 轮 ✓' })).toBeVisible();
      await expect(page.getByRole('button', { name: '第 2 轮 ✓' })).toBeVisible();
      await page.getByRole('button', { name: '第 1 轮 ✓' }).click();
      await expect(
        page.locator('.plan-step strong').filter({ hasText: '实现并测试' }),
      ).toBeVisible();
      await page.reload();
      await page.locator('.task-item').filter({ hasText: '创建可持久化任务列表' }).click();
      await expect(page.getByRole('button', { name: '第 2 轮 ✓' })).toBeVisible();
      await page.screenshot({ path: 'test-results/workbench.png', fullPage: true });
      if (process.env.AGENTHUB_CAPTURE_DEMO === '1') {
        await mkdir('docs/images', { recursive: true });
        await page.screenshot({ path: 'docs/images/workbench.png' });
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  test('执行详情实时更新、会话筛选、参数结果与差异、导出和刷新回看', async ({ page }) => {
    const dir = await mkdtemp(join(tmpdir(), 'agenthub-detail-ui-'));
    try {
      const errors: string[] = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto('/');
      await page.getByLabel('项目目录').fill(dir);
      await page.getByLabel('任务需求').fill('详情测试');
      await page.getByRole('button', { name: '提交任务' }).click();
      await page.getByRole('button', { name: '确认分工并执行' }).click();
      await page.getByRole('button', { name: '查看执行详情', exact: false }).click();
      const dialog = page.getByRole('dialog', { name: 'Coding agent 执行详情' });
      await expect(dialog).toBeVisible();
      await expect(dialog.locator('.execution-state.in_progress')).toBeVisible();
      await dialog
        .locator('.execution-tool')
        .filter({ hasText: 'Running: node --test' })
        .locator('summary')
        .click();
      await expect(dialog.getByText('"command": "node --test"', { exact: false })).toBeVisible();
      await expect(dialog.getByText('tests 3\npass 3\nfail 0', { exact: true })).toBeVisible();
      await expect(
        dialog
          .locator('.execution-tool')
          .filter({ hasText: 'Running: node --test' })
          .locator('.execution-state'),
      ).toHaveText('已完成');
      await dialog.getByLabel('搜索执行日志').fill('result.txt');
      await expect(dialog.locator('.execution-tool')).toHaveCount(2);
      await dialog.getByLabel('搜索执行日志').fill('Writing');
      await expect(dialog.locator('.execution-tool')).toHaveCount(1);
      await dialog.locator('.execution-tool summary').click();
      await expect(dialog.getByText('+++ 修改后', { exact: false })).toBeVisible();
      await dialog.getByLabel('搜索执行日志').fill('');
      await dialog.getByLabel('工具状态筛选').selectOption('failed');
      await expect(dialog.getByText('没有符合筛选条件的活动。')).toBeVisible();
      await dialog.getByLabel('工具状态筛选').selectOption('all');
      await dialog.getByRole('button', { name: '2.', exact: false }).click();
      await expect(dialog.getByText('thinking low', { exact: false })).toBeVisible();
      await dialog.getByText('发送给 agent 的完整指令', { exact: true }).click();
      await expect(dialog.getByText('用户需求：详情测试', { exact: false })).toBeVisible();
      await dialog.getByText('Agent 返回的思考内容', { exact: true }).click();
      await expect(dialog.getByText('先检查测试结果，再完成交付。', { exact: true })).toBeVisible();
      const download = page.waitForEvent('download');
      await dialog.getByRole('button', { name: '导出日志' }).click();
      const file = await download;
      expect(file.suggestedFilename()).toMatch(/^agenthub-.*-round-1.json$/);
      const { readFile } = await import('node:fs/promises');
      const saved = JSON.parse(await readFile((await file.path())!, 'utf8'));
      expect(saved.session.execution.model).toBe('kimi-code/test');
      expect(saved.logs.filter((l: any) => l.kind === 'tool')).toHaveLength(2);
      if (process.env.AGENTHUB_CAPTURE_DEMO === '1') {
        await dialog.getByText('发送给 agent 的完整指令', { exact: true }).click();
        await dialog.getByText('Agent 返回的思考内容', { exact: true }).click();
        await dialog.getByLabel('搜索执行日志').fill('node --test');
        const command = dialog
          .locator('.execution-tool')
          .filter({ hasText: 'Running: node --test' });
        if ((await command.getAttribute('open')) === null) await command.locator('summary').click();
        await mkdir('docs/images', { recursive: true });
        await page.screenshot({ path: 'docs/images/execution-details.png' });
        await dialog.getByLabel('搜索执行日志').fill('');
      }
      await page.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
      await expect(page.getByText('本轮汇总已生成', { exact: false })).toBeVisible();
      await page.reload();
      await page.getByRole('button', { name: '查看执行详情', exact: false }).click();
      await expect(dialog.locator('.execution-tool')).toHaveCount(2);
      expect(errors).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  test('旧记录没有结构化字段仍可分会话检索与回看，分页避免加载所有日志', async ({ page }) => {
    await page.route('**/api/tasks/*', async (route) => {
      if (route.request().method() !== 'GET') return route.continue();
      const response = await route.fetch();
      const task = await response.json();
      task.logs = task.logs
        .filter((l: any) => l.kind !== 'thought')
        .map((l: any) => {
          const { execution, tool, invocationId, ...old } = l;
          return old;
        });
      const source = task.logs.find((l: any) => l.kind === 'tool');
      if (source)
        for (let i = 0; i < 60; i++)
          task.logs.push({
            ...source,
            id: 'old-' + i,
            content: 'Running: legacy-command · in_progress · completed\nlegacy-output-' + i,
          });
      await route.fulfill({ response, json: task });
    });
    await page.goto('/');
    await page.locator('.task-item').filter({ hasText: '详情测试' }).click();
    await page.getByRole('button', { name: '查看执行详情', exact: false }).click();
    const dialog = page.getByRole('dialog', { name: 'Coding agent 执行详情' });
    await expect(dialog.locator('.execution-tool')).toHaveCount(50);
    await dialog.getByRole('button', { name: '再显示 50 条', exact: false }).click();
    await expect(dialog.locator('.execution-tool')).toHaveCount(62);
    await dialog.getByRole('button', { name: '2.', exact: false }).click();
    await expect(
      dialog.getByText('旧记录保留了当时采集的工具日志', { exact: false }),
    ).toBeVisible();
    await dialog.getByLabel('搜索执行日志').fill('legacy-output-59');
    await expect(dialog.locator('.execution-tool')).toHaveCount(1);
    await expect(dialog.locator('.execution-state')).toHaveText('已完成');
    await dialog.locator('.execution-tool summary').click();
    await expect(dialog.getByText('legacy-output-59', { exact: false })).toBeVisible();
    await dialog.getByRole('button', { name: '关闭详情 ×' }).click();
    await expect(dialog).not.toBeVisible();
  });
  test('原生权限选项转发、用户回答、取消后不执行审查', async ({ page }) => {
    const dir = await mkdtemp(join(tmpdir(), 'agenthub-permission-ui-'));
    try {
      await page.goto('/');
      await page.getByLabel('项目目录').fill(dir);
      await page.getByLabel('任务需求').fill('权限测试');
      await page.getByRole('button', { name: '提交任务' }).click();
      await page.getByRole('button', { name: '确认分工并执行' }).click();
      await expect(page.getByRole('button', { name: '允许一次' })).toBeVisible();
      await page.getByRole('button', { name: '允许一次' }).click();
      await expect(page.getByText('本轮汇总已生成', { exact: false })).toBeVisible();
      await page.getByLabel('结果反馈').fill('权限测试继续');
      await page.getByRole('button', { name: '提交反馈' }).click();
      await page.getByRole('button', { name: '确认分工并执行' }).click();
      await expect(page.getByRole('button', { name: '允许一次' })).toBeVisible();
      await page.getByRole('button', { name: '取消本轮' }).click();
      await expect(page.getByText('用户取消；已产生的文件改动会保留。')).toBeVisible();
      await expect(page.getByRole('button', { name: '允许一次' })).toHaveCount(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  test('额度刷新与全局修改不会改写已有任务快照', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: '模型与额度' }).click();
    await page.getByRole('button', { name: '刷新额度' }).click();
    await expect(page.getByText('剩余 65%', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: '全局战队', exact: true }).click();
    await page.getByLabel('builder thinking').selectOption('max');
    await page.getByRole('button', { name: '保存全局配置' }).click();
    await expect(page.getByText('全局战队 v2', { exact: false })).toBeVisible();
    await page.locator('.task-item').filter({ hasText: '创建可持久化任务列表' }).click();
    await expect(page.getByText('使用任务配置 v1')).toBeVisible();
    await expect(
      page.locator('.inspector').getByText('test · low', { exact: false }),
    ).toBeVisible();
  });
  test('无效项目目录与空输入不启动 agent', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('button', { name: '提交任务' })).toBeDisabled();
    await page.getByLabel('项目目录').fill('/missing/project');
    await page.getByLabel('任务需求').fill('不能执行的任务');
    await page.getByRole('button', { name: '提交任务' }).click();
    await expect(page.getByRole('alert')).toContainText('ENOENT');
  });
});
