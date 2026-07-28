import { expect, type Page } from '@playwright/test';
import { clearNoticeAck, dismissNoticeIfVisible } from './notice-gate';

export async function loginEmployee(page: Page, employeeNo: string, password = employeeNo) {
  await clearNoticeAck(page);
  await page.goto('/login');
  await page.locator('#employeeNo').fill(employeeNo);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: '登录' }).click();
  await page.waitForURL(/\/app/, { timeout: 30_000 });
  await dismissNoticeIfVisible(page);
}

export async function loginStaff(page: Page, account: string, password: string) {
  await page.goto('/admin/login');
  await page.locator('#staff-account').fill(account);
  await page.locator('#admin-password').fill(password);
  await page.getByRole('button', { name: '登录' }).click();
}

export async function loginReviewer(page: Page, account: string, password: string) {
  await loginStaff(page, account, password);
  await page.waitForURL(/\/app\/review/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: /申诉审核工作台/ })).toBeVisible({
    timeout: 15_000,
  });
}

export async function loginAdmin(page: Page, account: string, password: string) {
  await loginStaff(page, account, password);
  await page.waitForURL(/\/admin\/?$/, { timeout: 30_000 });
}
