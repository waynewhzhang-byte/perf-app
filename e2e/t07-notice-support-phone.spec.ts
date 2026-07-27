/**
 * T07 E2E — 强制阅读弹窗 + 技术支持电话
 *
 * 前置：localhost:3000 可访问（pnpm dev 或 playwright webServer）
 * 账号默认兼容 seed（Test1234!）与本地 11456348 测试员工。
 */
import { test, expect, type Page } from '@playwright/test';
import {
  clearNoticeAck,
  dismissNoticeIfVisible,
  FAST_NOTICE_SECONDS,
  putAppConfig,
  waitForNoticeGateReady,
} from './helpers/notice-gate';

const ADMIN_ACCOUNT = process.env.E2E_ADMIN_ACCOUNT ?? 'admin@powergrid.com.cn';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Test1234!';
const EMPLOYEE_NO = process.env.E2E_EMPLOYEE_NO ?? '11456348';
const EMPLOYEE_PASSWORD = process.env.E2E_EMPLOYEE_PASSWORD ?? EMPLOYEE_NO;

const TEST_PHONE_A = process.env.E2E_SUPPORT_PHONE_A ?? '0351-E2E-7001';
const TEST_PHONE_B = process.env.E2E_SUPPORT_PHONE_B ?? '0351-E2E-7002';

async function loginEmployee(page: Page) {
  await page.goto('/login');
  await page.locator('#employeeNo').fill(EMPLOYEE_NO);
  await page.locator('#password').fill(EMPLOYEE_PASSWORD);
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL(/\/app/, { timeout: 30_000 });
}

function myDeclarationsHeading(page: Page) {
  return page.getByRole('heading', { name: '我的申报', level: 1 });
}

async function openFirstSubmission(page: Page) {
  await dismissNoticeIfVisible(page);
  await expect(page.getByRole('dialog', { name: /申报前必读/ })).not.toBeVisible();
  const link = page.locator('a[href*="/app/submission/"]').first();
  await expect(link, '无可申报的已发布模板').toBeVisible({ timeout: 30_000 });
  await link.click();
  await page.waitForURL(/\/app\/submission\//, { timeout: 30_000 });
}

test.describe('T07 — 强制阅读弹窗', () => {
  test.beforeEach(async ({ request }) => {
    await putAppConfig(request, { supportPhone: TEST_PHONE_A, noticeSeconds: FAST_NOTICE_SECONDS });
  });

  test('首次进入 /app 显示弹窗，确认后进入申报首页', async ({ page }) => {
    test.setTimeout(60_000);
    await clearNoticeAck(page);
    await loginEmployee(page);

    const dialog = page.getByRole('dialog', { name: /申报前必读/ });
    await waitForNoticeGateReady(page);
    await expect(dialog).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByText(/认真如实填报/)).toBeVisible();
    await expect(page.getByRole('link', { name: /查看 2026 评分规则说明/ })).toBeVisible();

    const confirm = page.getByRole('button', { name: /我已认真阅读，确认继续填报/ });
    await expect(confirm).toBeEnabled({ timeout: (FAST_NOTICE_SECONDS + 5) * 1000 });
    await confirm.click();

    await expect(dialog).not.toBeVisible();
    await expect(myDeclarationsHeading(page)).toBeVisible();
  });

  test('已确认后同会话不再显示弹窗', async ({ page }) => {
    test.setTimeout(60_000);
    await clearNoticeAck(page);
    await loginEmployee(page);
    await dismissNoticeIfVisible(page);
    await expect(page.getByRole('dialog', { name: /申报前必读/ })).not.toBeVisible();

    await page.reload();
    await expect(page.getByRole('dialog', { name: /申报前必读/ })).not.toBeVisible({ timeout: 10_000 });
    await expect(myDeclarationsHeading(page)).toBeVisible();
  });

  test('noticeSeconds>0 时倒计时结束前按钮不可用', async ({ page, request }) => {
    test.setTimeout(60_000);
    await putAppConfig(request, { supportPhone: TEST_PHONE_A, noticeSeconds: 2 });
    await clearNoticeAck(page);
    await loginEmployee(page);

    const confirm = page.getByRole('button', { name: /我已认真阅读，确认继续填报/ });
    await expect(confirm).toBeDisabled();
    await expect(confirm).toBeEnabled({ timeout: 5_000 });
    await confirm.click();
    await expect(page.getByRole('dialog', { name: /申报前必读/ })).not.toBeVisible();
  });
});

test.describe('T07 — 技术支持电话', () => {
  test.beforeEach(async ({ request }) => {
    await putAppConfig(request, { supportPhone: TEST_PHONE_A, noticeSeconds: FAST_NOTICE_SECONDS });
  });

  test('申报页底部显示可点击的技术支持电话', async ({ page }) => {
    test.setTimeout(90_000);
    await clearNoticeAck(page);
    await loginEmployee(page);
    await openFirstSubmission(page);

    const footer = page.getByText('技术人员 电话：');
    await expect(footer).toBeVisible({ timeout: 15_000 });
    const tel = page.getByRole('link', { name: TEST_PHONE_A });
    await expect(tel).toBeVisible();
    await expect(tel).toHaveAttribute('href', `tel:${TEST_PHONE_A}`);
  });

  test('管理端修改电话后申报页展示新号码', async ({ page, request }) => {
    test.setTimeout(120_000);
    await putAppConfig(request, { supportPhone: TEST_PHONE_A, noticeSeconds: FAST_NOTICE_SECONDS });

    await page.goto('/admin/login');
    await page.locator('#staff-account').fill(ADMIN_ACCOUNT);
    await page.locator('#admin-password').fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: '登录' }).click();
    await page.waitForURL(/\/admin/, { timeout: 30_000 });

    await page.goto('/admin/app-config');
    await expect(page.getByRole('heading', { name: /申报合规与技术支持/ })).toBeVisible();
    const phoneInput = page.getByPlaceholder('如：0351-1234567');
    await expect(phoneInput).toHaveValue(TEST_PHONE_A, { timeout: 15_000 });
    await phoneInput.fill(TEST_PHONE_B);
    await expect(phoneInput).toHaveValue(TEST_PHONE_B);
    const saveRes = page.waitForResponse(
      (r) => r.url().includes('/api/admin/app-config') && r.request().method() === 'PUT',
    );
    await page.getByRole('button', { name: '保存配置' }).click();
    expect((await saveRes).ok()).toBeTruthy();
    await expect(page.getByText(/配置已保存/)).toBeVisible({ timeout: 15_000 });

    // 校验公开配置已切换，避免员工页读到旧缓存
    const pub = await request.get('/api/public/app-config');
    const pubBody = await pub.json();
    expect(pubBody.config?.supportPhone).toBe(TEST_PHONE_B);

    await clearNoticeAck(page);
    await loginEmployee(page);
    await openFirstSubmission(page);

    await expect(page.getByRole('link', { name: TEST_PHONE_B })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('link', { name: TEST_PHONE_A })).toHaveCount(0);
  });

  test('电话留空时不显示底部技术支持行', async ({ page, request }) => {
    test.setTimeout(90_000);
    await putAppConfig(request, { supportPhone: '', noticeSeconds: FAST_NOTICE_SECONDS });
    await clearNoticeAck(page);
    await loginEmployee(page);
    await openFirstSubmission(page);

    await expect(page.getByText('技术人员 电话：')).toHaveCount(0);
  });
});
