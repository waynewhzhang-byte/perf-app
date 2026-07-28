import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { DEFAULT_DECLARATION_NOTICE_TEXT } from '../../src/lib/app-config';

export const ADMIN_ACCOUNT = process.env.E2E_ADMIN_ACCOUNT ?? 'admin@powergrid.com.cn';
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Test1234!';

/** API 将 0 视为默认 30s；E2E 用 1s 加速，仍覆盖倒计时逻辑。 */
export const FAST_NOTICE_SECONDS = 1;

export async function loginAdminApi(request: APIRequestContext) {
  const res = await request.post('/api/auth/login?admin=1', {
    data: { account: ADMIN_ACCOUNT, password: ADMIN_PASSWORD },
  });
  expect(res.ok(), `admin login failed: ${await res.text()}`).toBeTruthy();
}

export async function putAppConfig(
  request: APIRequestContext,
  data: {
    supportPhone: string;
    noticeText?: string;
    noticeSeconds: number;
    homeNoticeTitle?: string;
    homeNoticeBody?: string;
  },
) {
  await loginAdminApi(request);
  const res = await request.put('/api/admin/app-config', {
    data: {
      supportPhone: data.supportPhone,
      noticeText: data.noticeText ?? DEFAULT_DECLARATION_NOTICE_TEXT,
      noticeSeconds: data.noticeSeconds,
      homeNoticeTitle: data.homeNoticeTitle ?? '',
      homeNoticeBody: data.homeNoticeBody ?? '',
    },
  });
  expect(res.ok(), `PUT app-config failed: ${await res.text()}`).toBeTruthy();
}

export async function clearNoticeAck(page: Page) {
  await page.addInitScript(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('perf_declaration_notice_ack:')) {
        localStorage.removeItem(key);
      }
    }
  });
}

export async function waitForNoticeGateReady(page: Page) {
  await page
    .waitForResponse(
      (response) => response.url().includes('/api/public/app-config') && response.ok(),
      { timeout: 20_000 },
    )
    .catch(() => undefined);
}

export async function dismissNoticeIfVisible(page: Page, noticeSeconds = FAST_NOTICE_SECONDS) {
  await waitForNoticeGateReady(page);
  const dialog = page.getByRole('dialog', { name: /申报前必读/ });
  if (!(await dialog.isVisible())) return;
  const confirm = page.getByRole('button', { name: /我已认真阅读，确认继续填报/ });
  await expect(confirm).toBeEnabled({ timeout: (noticeSeconds + 5) * 1000 });
  await confirm.click();
  await expect(dialog).not.toBeVisible({ timeout: 10_000 });
}
