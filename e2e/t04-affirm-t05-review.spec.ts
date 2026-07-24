/**
 * T04 AFFIRM + T05 审核台 E2E
 *
 * 覆盖 2026 申诉-centric 主路径（取代已删除的 performance-review.e2e.spec.ts）。
 * 顺序：先 AFFIRM 直通归档；再重置 → 申诉送审 → L1 表格筛选/批量确认。
 * 账号默认：员工 11456348；L1 l1-biandian@perf.local / Test1234!
 */
import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import {
  clearNoticeAck,
  dismissNoticeIfVisible,
  FAST_NOTICE_SECONDS,
  putAppConfig,
} from './helpers/notice-gate';
import { disconnectE2EPrisma, resetSubmissionForE2E } from './helpers/reset-submission';

const TEMPLATE_ID = process.env.E2E_TEMPLATE_ID ?? 'cmrta45250000dp5slej2w6xf';
const EMPLOYEE_NO = process.env.E2E_EMPLOYEE_NO ?? '11456348';
const EMPLOYEE_PASSWORD = process.env.E2E_EMPLOYEE_PASSWORD ?? EMPLOYEE_NO;
const L1_ACCOUNT = process.env.E2E_L1_ACCOUNT ?? 'l1-biandian@perf.local';
const L1_PASSWORD = process.env.E2E_L1_PASSWORD ?? 'Test1234!';
const PROOF = path.join(__dirname, 'smoke-appeal-proof.txt');
const FORM_2026_HEADING = /2026\s*年能级评价量化积分申报表/;

test.afterAll(async () => {
  await disconnectE2EPrisma();
});

test.beforeEach(async ({ request }) => {
  await putAppConfig(request, { supportPhone: '', noticeSeconds: FAST_NOTICE_SECONDS });
  await resetSubmissionForE2E({ employeeNo: EMPLOYEE_NO, templateId: TEMPLATE_ID });
});

async function loginEmployee(page: Page) {
  await clearNoticeAck(page);
  await page.goto('/login');
  await page.locator('#employeeNo').fill(EMPLOYEE_NO);
  await page.locator('#password').fill(EMPLOYEE_PASSWORD);
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL(/\/app/, { timeout: 30_000 });
  await dismissNoticeIfVisible(page);
}

async function openSubmission(page: Page) {
  await page.goto(`/app/submission/${TEMPLATE_ID}`);
  await dismissNoticeIfVisible(page);
  await expect(page.getByRole('heading', { name: FORM_2026_HEADING })).toBeVisible({
    timeout: 30_000,
  });
}

async function loginL1Reviewer(page: Page) {
  await page.goto('/admin/login');
  await page.locator('#staff-account').fill(L1_ACCOUNT);
  await page.locator('#admin-password').fill(L1_PASSWORD);
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL(/\/app\/review/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: /申诉审核工作台/ })).toBeVisible({
    timeout: 15_000,
  });
}

test.describe.configure({ mode: 'serial' });

test('T04 AFFIRM：无申诉确认报名后直通归档且不进待审', async ({ page, browser }) => {
  test.setTimeout(120_000);

  page.on('dialog', (d) => d.accept());

  await loginEmployee(page);
  await openSubmission(page);

  // 清掉历史申诉（若有）
  while ((await page.getByText(/已保存的申诉（/).count()) > 0) {
    await page.locator('li').getByRole('button', { name: '删除' }).first().click();
    await page.waitForTimeout(400);
  }

  const affirm = page.getByRole('button', { name: '确认报名' });
  const appealSubmit = page.getByRole('button', { name: '提交审核' });
  await expect(affirm).toBeEnabled();
  await expect(appealSubmit).toBeDisabled();

  await affirm.click();
  await page.waitForURL(/\/app\/?$/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: '我的申报', level: 1 })).toBeVisible();
  await expect(page.getByText(/终审通过|已归档|L2_APPROVED/).first()).toBeVisible({
    timeout: 15_000,
  });

  // L1 待审不应出现该员工申诉行
  const l1 = await browser.newPage();
  await loginL1Reviewer(l1);
  await l1.getByPlaceholder('工号、姓名、申诉内容…').fill(EMPLOYEE_NO);
  await l1.getByRole('button', { name: '筛选' }).click();
  await expect(l1.getByText(EMPLOYEE_NO)).toHaveCount(0);
  await l1.close();
});

test('T05：申诉送审后 L1 表格可见、可筛选、可批量确认', async ({ page, browser }) => {
  test.setTimeout(180_000);

  page.on('dialog', (d) => d.accept());

  await loginEmployee(page);
  await openSubmission(page);

  while ((await page.getByText(/已保存的申诉（/).count()) > 0) {
    await page.locator('li').getByRole('button', { name: '删除' }).first().click();
    await page.waitForTimeout(400);
  }

  await page.getByRole('button', { name: '申诉' }).click();
  await expect(page.getByRole('heading', { name: '新增申诉' })).toBeVisible();
  await page.locator('label:has-text("一级维度") select').selectOption({
    label: '一、基本素质（满分14分）',
  });
  await page.locator('label:has-text("二级评分项") select').selectOption({
    label: '参加工作时间（系统导入确认）',
  });
  await page.getByLabel('申诉分值（主张分）').fill('2');
  await page.getByLabel('申诉说明').fill('T05 E2E 申诉内容');
  await page.locator('input[type="file"]').last().setInputFiles(PROOF);
  await page.getByRole('button', { name: '保存申诉' }).click();
  await expect(page.getByText('已保存的申诉（1）')).toBeVisible({ timeout: 30_000 });

  await expect(page.getByRole('button', { name: '确认报名' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '提交审核' })).toBeEnabled();
  await page.getByRole('button', { name: '提交审核' }).click();
  await page.waitForURL(/\/app\/?$/, { timeout: 30_000 });

  const l1 = await browser.newPage();
  await loginL1Reviewer(l1);

  await expect(l1.getByRole('button', { name: '待审核' })).toBeVisible();
  await l1.getByPlaceholder('工号、姓名、申诉内容…').fill(EMPLOYEE_NO);
  const filterRes = l1.waitForResponse(
    (r) => r.url().includes('/api/review') && r.request().method() === 'GET',
  );
  await l1.getByRole('button', { name: '筛选' }).click();
  await filterRes;

  const row = l1.locator('tr').filter({ hasText: EMPLOYEE_NO }).filter({ hasText: '参加工作时间' });
  await expect(row.first()).toBeVisible({ timeout: 20_000 });
  await expect(row.first()).toContainText('T05 E2E 申诉内容');

  await l1.getByRole('checkbox', { name: /选择 参加工作时间/ }).click();
  await expect(l1.getByRole('button', { name: '批量确认' })).toBeEnabled({ timeout: 5_000 });

  l1.on('dialog', (d) => d.accept());
  const [reviewRes] = await Promise.all([
    l1.waitForResponse(
      (r) => r.url().includes('/api/review') && r.request().method() === 'POST',
      { timeout: 30_000 },
    ),
    l1.getByRole('button', { name: '批量确认' }).click(),
  ]);
  expect(reviewRes.ok(), `review batch failed: ${await reviewRes.text()}`).toBeTruthy();

  await expect(row).toHaveCount(0, { timeout: 20_000 });

  await l1.getByRole('button', { name: '已审核' }).click();
  await l1.getByPlaceholder('工号、姓名、申诉内容…').fill(EMPLOYEE_NO);
  await l1.getByRole('button', { name: '筛选' }).click();
  const doneRow = l1.locator('tr').filter({ hasText: EMPLOYEE_NO }).filter({ hasText: '参加工作时间' });
  await expect(doneRow.first()).toBeVisible({ timeout: 20_000 });
  await expect(doneRow.first()).toContainText('确认');
  await l1.close();
});
