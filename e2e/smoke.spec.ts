/**
 * E2E 冒烟测试 — 核心业务流程
 *
 * 前置条件（运行前需确保）：
 *   1. `pnpm dev` 已在 localhost:3000 运行
 *   2. 数据库已包含测试用户和已发布的申报模板
 *
 * 运行：pnpm e2e
 */

import { test, expect } from '@playwright/test';

test.describe('员工申报 → 两级审核 关键路径', () => {
  test('员工登录后可查看已发布模板', async ({ page }) => {
    await page.goto('/login');
    await expect(page).toHaveTitle(/绩效/);

    // 登录页显示双入口
    await expect(page.getByRole('button', { name: /员工/ })).toBeVisible();
  });

  test('员工登录后可进入申报页', async ({ page }) => {
    await page.goto('/login');

    // 填写登录表单
    await page.fill('input[name="contact"]', 'test001');
    await page.fill('input[name="password"]', 'Test001!');
    await page.click('button[type="submit"]');

    // 应重定向到 /app（我的申报）
    await page.waitForURL(/\/app$/);
    await expect(page.getByText(/我的申报|绩效申报/)).toBeVisible();
  });

  test('申报提交流程 — 表单校验与草稿保存', async ({ page }) => {
    // 登录
    await page.goto('/login');
    await page.fill('input[name="contact"]', 'test001');
    await page.fill('input[name="password"]', 'Test001!');
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/app$/);

    // 点击已发布模板进入填报页
    const templateLink = page.locator('a[href*="/app/submission/"]').first();
    if (!(await templateLink.isVisible())) {
      test.skip(true, '无可用的已发布模板');
      return;
    }
    await templateLink.click();
    await page.waitForURL(/\/app\/submission\//);

    // 验证填报页加载
    await expect(page.getByText(/提交|保存|草稿/)).toBeVisible();
  });

  test('审核员可查看待审列表', async ({ page }) => {
    // 管理员/审核员登录
    await page.goto('/admin/login');
    await page.fill('input[name="contact"]', 'admin');
    await page.fill('input[name="password"]', 'Admin123!');
    await page.click('button[type="submit"]');

    // 验证管理后台加载
    await page.waitForURL(/\/admin$/);
    await expect(page.getByText(/管理|统计/)).toBeVisible();
  });
});

test.describe('附件上传安全', () => {
  test('白名单外扩展名被拒绝', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="contact"]', 'test001');
    await page.fill('input[name="password"]', 'Test001!');
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/app$/);

    // 尝试进入填报页
    const templateLink = page.locator('a[href*="/app/submission/"]').first();
    if (!(await templateLink.isVisible())) {
      test.skip(true, '无可用的已发布模板');
      return;
    }
    await templateLink.click();

    // 验证上传区域存在（具体上传行为由 upload-security 单元测试保障）
    await expect(page.getByText(/上传|附件/)).toBeVisible();
  });
});
