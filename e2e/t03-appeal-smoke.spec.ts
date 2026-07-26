/**
 * T03 manual smoke — appeal modal save / delete / edit / reload
 */
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { clearNoticeAck, dismissNoticeIfVisible, FAST_NOTICE_SECONDS, putAppConfig } from './helpers/notice-gate';
import { disconnectE2EPrisma, resetSubmissionForE2E } from './helpers/reset-submission';

const TEMPLATE_ID = 'cmrta45250000dp5slej2w6xf';
const EMPLOYEE_NO = '11456348';
const PROOF = path.join(__dirname, 'smoke-appeal-proof.txt');
const FORM_2026_HEADING = /2026\s*年能级评价量化积分申报表/;

test.afterAll(async () => {
  await disconnectE2EPrisma();
});

test.beforeEach(async ({ request }) => {
  await putAppConfig(request, { supportPhone: '', noticeSeconds: FAST_NOTICE_SECONDS });
  await resetSubmissionForE2E({ employeeNo: EMPLOYEE_NO, templateId: TEMPLATE_ID });
});

test('T03 appeal-centric smoke: save two, delete one, edit one, reload', async ({ page }) => {
  test.setTimeout(120_000);

  await clearNoticeAck(page);
  await page.goto('/login');
  await page.getByLabel('员工工号').fill(EMPLOYEE_NO);
  await page.getByLabel('密码').fill(EMPLOYEE_NO);
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL(/\/app/);
  await dismissNoticeIfVisible(page);

  await page.goto(`/app/submission/${TEMPLATE_ID}`);
  await dismissNoticeIfVisible(page);
  await expect(page.getByRole('heading', { name: FORM_2026_HEADING })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: '申诉' })).toBeVisible();

  page.on('dialog', (d) => d.accept());
  while ((await page.getByText(/已保存的申诉（/).count()) > 0) {
    await page.locator('li').getByRole('button', { name: '删除' }).first().click();
    await page.waitForTimeout(500);
  }
  await expect(page.getByText(/已保存的申诉（/)).toHaveCount(0);

  async function saveAppeal(sectionText: string, itemText: string, claimed: string, reason: string) {
    await page.getByRole('button', { name: '申诉' }).click();
    await expect(page.getByRole('heading', { name: '新增申诉' })).toBeVisible();

    await page.locator('label:has-text("一级维度") select').selectOption({ label: sectionText });
    await page.locator('label:has-text("评分项") select').selectOption({ label: itemText });

    await page.getByLabel('申诉分值（主张分）').fill(claimed);
    await page.getByLabel('申诉说明').fill(reason);
    await page.locator('input[type="file"]').last().setInputFiles(PROOF);
    await page.getByRole('button', { name: '保存申诉' }).click();
    await expect(page.getByRole('heading', { name: '新增申诉' })).not.toBeVisible({ timeout: 30_000 });
  }

  await saveAppeal('一、基本素质（满分14分）', '参加工作时间（系统导入确认）', '2', '参加工作时间申诉测试');
  await expect(page.getByText('已保存的申诉（1）')).toBeVisible();
  await expect(page.getByText('参加工作时间申诉测试')).toBeVisible();

  await saveAppeal('二、工作业绩（满分44分）', '技术贡献（满分12分）', '5', '技术贡献申诉测试');
  await expect(page.getByText('已保存的申诉（2）')).toBeVisible();

  const techRow = page.locator('li').filter({ hasText: '技术贡献' });
  await techRow.getByRole('button', { name: '删除' }).click();
  await expect(page.getByText('已保存的申诉（1）')).toBeVisible({ timeout: 30_000 });

  await page.reload();
  await dismissNoticeIfVisible(page);
  await expect(page.getByText('已保存的申诉（1）')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('li').filter({ hasText: '技术贡献' })).toHaveCount(0);
  await expect(page.getByText('参加工作时间申诉测试')).toBeVisible();

  await page.locator('li').filter({ hasText: '参加工作时间' }).getByRole('button', { name: '编辑' }).click();
  await expect(page.getByRole('heading', { name: '编辑申诉' })).toBeVisible();
  await expect(page.getByLabel('申诉分值（主张分）')).toHaveValue('2');
  await expect(page.getByLabel('申诉说明')).toHaveValue('参加工作时间申诉测试');
  await expect(page.getByText('smoke-appeal-proof.txt').first()).toBeVisible();

  await page.getByLabel('申诉分值（主张分）').fill('3');
  await page.getByLabel('申诉说明').fill('参加工作时间申诉已编辑');
  await page.getByRole('button', { name: '保存申诉' }).click();
  await expect(page.getByText('主张分 3.0')).toBeVisible({ timeout: 30_000 });

  await page.reload();
  await dismissNoticeIfVisible(page);
  await expect(page.getByText('主张分 3.0')).toBeVisible();
  await expect(page.getByText('参加工作时间申诉已编辑')).toBeVisible();
});
