import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';

const adminAccount = 'admin@powergrid.com.cn';
const adminPassword = 'Test1234!';
const employeeBranch = '特高压长治站';
const evidenceFile = path.join(__dirname, 'fixtures', 'performance-proof.txt');

test.describe('绩效申报完整业务闭环', () => {
  test('管理员建审核员 → 员工带附件申报 → L1 → 分项 L2 → 归档', async ({ browser }) => {
    test.setTimeout(120_000);
    const suffix = `${Date.now()}`;
    const accounts = {
      employeeNo: `9${suffix.slice(-7)}`,
      l1EmployeeBranch: `e2e-l1-employee-${suffix}@example.com`,
      l1OtherBranch: `e2e-l1-other-${suffix}@example.com`,
      l2Safety: `e2e-l2-safety-${suffix}@example.com`,
      l2Operations: `e2e-l2-operations-${suffix}@example.com`,
      l2Organization: `e2e-l2-organization-${suffix}@example.com`,
    };
    const passwords = {
      l1EmployeeBranch: `L1Employee${suffix}!`,
      l1OtherBranch: `L1Other${suffix}!`,
      l2Safety: `L2Safety${suffix}!`,
      l2Operations: `L2Operations${suffix}!`,
      l2Organization: `L2Organization${suffix}!`,
    };

    const admin = await browser.newPage();
    await loginAdmin(admin);

    await admin.goto('/admin/review-routing');
    await expect(admin.getByText('全部完成', { exact: true })).toBeVisible();
    await expect(admin.getByText('安全贡献', { exact: true })).toBeVisible();
    await expect(admin.getByText('缺陷治理', { exact: true })).toBeVisible();

    await admin.goto('/admin/review-audit');
    await expect(admin.getByText('当前审核进度', { exact: true })).toBeVisible();
    await expect(admin.getByText('一级 / 二级审核卡点', { exact: true })).toBeVisible();
    await admin.goto('/admin/reports');
    await expect(admin.getByText('全员审核进度', { exact: true })).toBeVisible();
    await expect(admin.getByRole('button', { name: '导出汇总表 (CSV)' })).toBeDisabled();
    const reportPayload = await (await admin.context().request.get('/api/admin/reports')).json();
    const firstReport = reportPayload.reports?.[0];
    expect(firstReport?.templateId).toBeTruthy();
    const blockedExport = await admin.context().request.get(
      `/api/admin/reports/export?format=csv&complete=1&templateId=${encodeURIComponent(firstReport.templateId)}`,
    );
    expect(blockedExport.status()).toBe(409);

    await createReviewer(admin, {
      name: 'E2E 工区一级审核员',
      account: accounts.l1EmployeeBranch,
      password: passwords.l1EmployeeBranch,
      role: 'REVIEWER_L1',
      branch: employeeBranch,
    });
    await createReviewer(admin, {
      name: 'E2E 其他工区一级审核员',
      account: accounts.l1OtherBranch,
      password: passwords.l1OtherBranch,
      role: 'REVIEWER_L1',
      branch: '特高压大同站',
    });
    await createReviewer(admin, {
      name: 'E2E 安监部二级审核员',
      account: accounts.l2Safety,
      password: passwords.l2Safety,
      role: 'REVIEWER_L2',
      department: '公司安监部',
    });
    await createReviewer(admin, {
      name: 'E2E 运检部二级审核员',
      account: accounts.l2Operations,
      password: passwords.l2Operations,
      role: 'REVIEWER_L2',
      department: '公司运检部',
    });
    await createReviewer(admin, {
      name: 'E2E 组织部二级审核员',
      account: accounts.l2Organization,
      password: passwords.l2Organization,
      role: 'REVIEWER_L2',
      department: '公司组织部',
    });
    await createEmployee(admin, accounts.employeeNo, employeeBranch);

    const employee = await browser.newPage();
    employee.on('response', async (response) => {
      if (response.url().includes('/api/submissions') && !response.ok()) {
        console.log(`submission response ${response.status()}: ${await response.text()}`);
      }
    });
    await loginEmployee(employee, accounts.employeeNo);
    await employee.getByRole('link', { name: '去填报' }).click();
    await employee.waitForURL(/\/app\/submission\//);
    await employee.waitForLoadState('networkidle');

    await fillDeclaration(employee);
    await Promise.all([
      employee.waitForNavigation({ waitUntil: 'networkidle' }),
      employee.getByRole('button', { name: '保存草稿' }).click(),
    ]);
    await expect(employee).toHaveURL(/\/app\/submission\//);

    const fileInputs = employee.locator('input[type="file"]');
    const fileCount = await fileInputs.count();
    expect(fileCount).toBeGreaterThanOrEqual(8);
    for (let index = 0; index < fileCount; index += 1) {
      const uploadResponse = employee.waitForResponse(
        (response) => response.url().includes('/api/attachments') && response.status() === 200,
      );
      await fileInputs.nth(index).setInputFiles(evidenceFile);
      await uploadResponse;
    }
    await employee.getByRole('button', { name: '提交审核' }).click();
    await employee.waitForURL(/\/app$/);
    await expect(employee.getByText(/待审核|已提交/)).toBeVisible();

    const otherBranchReviewer = await browser.newPage();
    await loginStaff(otherBranchReviewer, accounts.l1OtherBranch, passwords.l1OtherBranch);
    await otherBranchReviewer.goto('/app/review');
    await otherBranchReviewer.waitForLoadState('networkidle');
    await expectReviewSubmissionAbsent(otherBranchReviewer, accounts.employeeNo);

    const l1 = await browser.newPage();
    await loginStaff(l1, accounts.l1EmployeeBranch, passwords.l1EmployeeBranch);
    await l1.goto('/app/review');
    await l1.waitForLoadState('networkidle');
    await selectReviewSubmission(l1, accounts.employeeNo);
    await expect(l1.getByText('一级 / 工区', { exact: false })).toBeVisible();
    await expect(l1.getByText('E2E').first()).toBeVisible();
    await expect(l1.getByText('performance-proof.txt', { exact: true }).first()).toBeVisible();
    await l1.getByRole('button', { name: '提交审核结论' }).click();
    await l1.waitForLoadState('networkidle');
    await expectReviewSubmissionAbsent(l1, accounts.employeeNo);

    const l2Safety = await browser.newPage();
    await loginStaff(l2Safety, accounts.l2Safety, passwords.l2Safety);
    await l2Safety.goto('/app/review');
    await l2Safety.waitForLoadState('networkidle');
    await selectReviewSubmission(l2Safety, accounts.employeeNo);
    await expect(l2Safety.getByText('二级 / 总公司', { exact: false })).toBeVisible();
    await expect(l2Safety.getByText(/^安全贡献/).first()).toBeVisible();
    await expect(l2Safety.getByText(/^缺陷治理/).first()).not.toBeVisible();
    await l2Safety.getByRole('button', { name: '提交审核结论' }).click();
    await l2Safety.waitForLoadState('networkidle');
    await expectReviewSubmissionAbsent(l2Safety, accounts.employeeNo);

    const l2Operations = await browser.newPage();
    await loginStaff(l2Operations, accounts.l2Operations, passwords.l2Operations);
    await l2Operations.goto('/app/review');
    await l2Operations.waitForLoadState('networkidle');
    await selectReviewSubmission(l2Operations, accounts.employeeNo);
    await expect(l2Operations.getByText(/^缺陷治理/).first()).toBeVisible();
    await expect(l2Operations.getByText(/^安全贡献/).first()).not.toBeVisible();
    await l2Operations.getByRole('button', { name: '提交审核结论' }).click();
    await l2Operations.waitForLoadState('networkidle');
    await expectReviewSubmissionAbsent(l2Operations, accounts.employeeNo);

    const l2Organization = await browser.newPage();
    await loginStaff(l2Organization, accounts.l2Organization, passwords.l2Organization);
    await l2Organization.goto('/app/review');
    await l2Organization.waitForLoadState('networkidle');
    await selectReviewSubmission(l2Organization, accounts.employeeNo);
    await expect(l2Organization.getByText('二级 / 总公司', { exact: false })).toBeVisible();
    await expect(l2Organization.getByText(/^发明创新/).first()).toBeVisible();
    await expect(l2Organization.getByText(/^安全贡献/).first()).not.toBeVisible();
    await expect(l2Organization.getByText(/^缺陷治理/).first()).not.toBeVisible();
    await l2Organization.getByRole('button', { name: '提交审核结论' }).click();
    await l2Organization.waitForLoadState('networkidle');
    await expectReviewSubmissionAbsent(l2Organization, accounts.employeeNo);

    await employee.goto('/app');
    await employee.waitForLoadState('networkidle');
    await expect(employee.getByText(/终审通过|已归档|L2_APPROVED/)).toBeVisible();
  });
});

async function loginAdmin(page: Page) {
  await loginStaff(page, adminAccount, adminPassword);
  await expect(page).toHaveURL(/\/admin$/);
}

async function loginStaff(page: Page, account: string, password: string) {
  installDialogHandler(page);
  await page.goto('/admin/login');
  await page.getByLabel('登录账号').fill(account);
  await page.getByLabel('密码').fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.waitForURL(/\/(?:admin|app\/review)$/);
}

async function loginEmployee(page: Page, employeeNo: string) {
  installDialogHandler(page);
  await page.goto('/login');
  await page.getByLabel('员工工号').fill(employeeNo);
  await page.getByLabel('密码').fill(employeeNo);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await page.waitForURL(/\/app$/);
}

async function createReviewer(
  page: Page,
  input: {
    name: string;
    account: string;
    password: string;
    role: 'REVIEWER_L1' | 'REVIEWER_L2';
    branch?: string;
    department?: string;
  },
) {
  await page.goto('/admin/users');
  await page.getByRole('button', { name: '添加审核员' }).click();
  await page.getByLabel('姓名').fill(input.name);
  await page.getByLabel('登录账号').fill(input.account);
  await page.getByLabel('初始密码').fill(input.password);
  await page.getByLabel('审核级别').selectOption(input.role);
  if (input.role === 'REVIEWER_L1') {
    await page.getByLabel('审核工区').selectOption({ label: input.branch! });
  } else {
    await page.getByLabel('二级审核部门').selectOption({ label: input.department! });
  }
  await page.getByRole('button', { name: '创建审核员账号' }).click();
  await expect(page.getByText(input.account, { exact: true })).toBeVisible();
}

async function createEmployee(page: Page, employeeNo: string, branch: string) {
  await page.goto('/admin/users');
  await page.getByRole('button', { name: '添加员工' }).click();
  await page.getByLabel('登录账号').fill(employeeNo);
  await page.getByLabel('初始密码').fill(employeeNo);
  await page.getByLabel('姓名').fill(`E2E 员工 ${employeeNo}`);
  await page.getByLabel('工号').fill(employeeNo);
  await page.getByLabel('工区').selectOption({ label: branch });
  const department = page.getByLabel('部门');
  if (await department.count()) {
    const options = await department.locator('option').count();
    if (options > 1) await department.selectOption({ index: 1 });
  }
  await page.getByRole('button', { name: '创建员工账号' }).click();
  await expect(page.getByText(employeeNo, { exact: true })).toBeVisible();
}

async function selectReviewSubmission(page: Page, employeeNo: string) {
  const row = page.getByRole('button').filter({ hasText: employeeNo }).first();
  await expect(row).toBeVisible();
  await row.click();
}

async function expectReviewSubmissionAbsent(page: Page, employeeNo: string) {
  await expect(page.getByRole('button').filter({ hasText: employeeNo }).first()).not.toBeVisible();
}

async function fillDeclaration(page: Page) {
  const hireDate = page.locator('input[type="date"]');
  if (await hireDate.count()) await hireDate.fill('2020-01-01');
  const scores = page.getByRole('spinbutton', { name: /申报分数|申报扣分/ });
  const facts = page.getByRole('textbox', { name: /事实说明/ });
  expect(await scores.count()).toBe(await facts.count());
  const scoreCount = await scores.count();
  for (let index = 0; index < scoreCount; index += 1) {
    const score = index >= scoreCount - 2 ? '0' : '1';
    await scores.nth(index).fill(score);
    await facts.nth(index).fill(`E2E 事实说明 ${index + 1}：可核验绩效证明。`);
  }

  const confirms = page.getByRole('button', { name: '确认', exact: true });
  if (await confirms.count()) await confirms.first().click();
}

function installDialogHandler(page: Page) {
  page.on('dialog', async (dialog) => {
    console.log(`browser dialog: ${dialog.message()}`);
    await dialog.accept();
  });
}
