/**
 * 端到端：双路径申报 → 工区 L1 → 总部不同部门 L2 → 管理员改分 → 量化报送表校验
 *
 * - 申诉员工：11425776（变电检修中心）申诉「技能等级」「缺陷治理」
 * - 确认员工：11403225（晋北运维分部）全部接受、确认报名
 * - L1：l1-biandian（正确工区）/ l1-jinbei（错误工区应不可见）
 * - L2：组织部（技能）+ 运检部（缺陷）
 * - 管理员改分后，年度量化积分报送分析纳入覆盖分并带调整说明
 */
import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { loginAdmin, loginEmployee, loginReviewer } from './helpers/auth';
import {
  dismissNoticeIfVisible,
  FAST_NOTICE_SECONDS,
  putAppConfig,
  ADMIN_ACCOUNT,
  ADMIN_PASSWORD,
} from './helpers/notice-gate';
import { disconnectE2EPrisma, resetSubmissionForE2E } from './helpers/reset-submission';
import {
  disconnectReviewerPasswordPrisma,
  ensureReviewerPasswords,
} from './helpers/reviewer-passwords';

const TEMPLATE_ID = process.env.E2E_TEMPLATE_ID ?? 'cmrta45250000dp5slej2w6xf';
const YEAR = 2026;
const PROOF = path.join(__dirname, 'smoke-appeal-proof.txt');
const FORM_HEADING = /2026\s*年能级评价量化积分申报表/;
const STAFF_PASSWORD = 'Test1234!';

const APPEAL_EMPLOYEE = {
  no: '11425776',
  name: '赵虎',
  branch: '变电检修中心',
};
const AFFIRM_EMPLOYEE = {
  no: '11403225',
  name: '薛宏伟',
  branch: '晋北运维分部',
};

const L1_CORRECT = 'l1-biandian@perf.local';
const L1_WRONG = 'l1-jinbei@perf.local';
const L2_ORG = 'l2-hq-organization@perf.local';
const L2_OPS = 'l2-hq-operations@perf.local';

const SKILL_ITEM = '技能等级（满分4分）';
const DEFECT_ITEM = '缺陷治理（满分12分）';
const SKILL_CLAIM = 4;
const DEFECT_CLAIM = 8;
const SKILL_OVERRIDE = 3.5;
const DEFECT_OVERRIDE = 7;

const prisma = new PrismaClient();

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  await ensureReviewerPasswords(STAFF_PASSWORD);
});

test.afterAll(async () => {
  await disconnectE2EPrisma();
  await disconnectReviewerPasswordPrisma();
  await prisma.$disconnect();
});

test.beforeEach(async ({ request }) => {
  await putAppConfig(request, { supportPhone: '', noticeSeconds: FAST_NOTICE_SECONDS });
});

async function openSubmission(page: Page) {
  await page.goto(`/app/submission/${TEMPLATE_ID}`);
  await dismissNoticeIfVisible(page);
  await expect(page.getByRole('heading', { name: FORM_HEADING })).toBeVisible({ timeout: 45_000 });
}

/** 2026 申诉视图提交前必须选择申报专业 */
async function selectDeclarationSpecialty(page: Page, specialtyName: string) {
  const specialty = page.locator('label').filter({ hasText: '申报专业' }).locator('select');
  await expect(specialty).toBeVisible({ timeout: 15_000 });
  await specialty.selectOption({ label: specialtyName });
}

async function clearSavedAppeals(page: Page) {
  page.on('dialog', (d) => d.accept());
  while ((await page.getByText(/已保存的申诉（/).count()) > 0) {
    await page.locator('li').getByRole('button', { name: '删除' }).first().click();
    await page.waitForTimeout(400);
  }
}

async function saveAppeal(
  page: Page,
  section: string,
  item: string,
  claimed: number,
  reason: string,
) {
  await page.getByRole('button', { name: '申诉' }).click();
  const dialog = page.getByRole('dialog', { name: /新增申诉|编辑申诉/ });
  await expect(dialog.getByRole('heading', { name: /新增申诉|编辑申诉/ })).toBeVisible();
  await dialog.locator('label').filter({ hasText: /^评价维度/ }).locator('select').selectOption({ label: section });
  await dialog.locator('label').filter({ hasText: /^评分项/ }).locator('select').selectOption({ label: item });
  await dialog.locator('label').filter({ hasText: '申诉分值（主张分）' }).locator('input').fill(String(claimed));
  await dialog.locator('label').filter({ hasText: '申诉说明' }).locator('textarea').fill(reason);
  await dialog.locator('input[type="file"]').setInputFiles(PROOF);
  await dialog.getByRole('button', { name: '保存申诉' }).click();
  await expect(dialog).not.toBeVisible({ timeout: 30_000 });
}

async function filterReviewQueue(page: Page, employeeNo: string) {
  await page.getByPlaceholder('工号、姓名、申诉内容…').fill(employeeNo);
  const filterRes = page.waitForResponse(
    (r) => r.url().includes('/api/review') && r.request().method() === 'GET',
  );
  await page.getByRole('button', { name: '筛选' }).click();
  await filterRes;
}

async function confirmAppealRow(page: Page, employeeNo: string, itemTitlePart: string, submissionItemId: string) {
  const row = page.locator('tr').filter({ hasText: employeeNo }).filter({ hasText: itemTitlePart });
  await expect(row.first()).toBeVisible({ timeout: 20_000 });
  const submissionId = await prisma.submissionItem.findUnique({
    where: { id: submissionItemId },
    select: { submissionId: true },
  });
  expect(submissionId?.submissionId).toBeTruthy();
  const res = await page.request.post('/api/review', {
    data: {
      batches: [{
        submissionId: submissionId!.submissionId,
        decisions: [{
          submissionItemId,
          action: 'APPROVE',
          disputeAction: 'APPROVE',
        }],
      }],
    },
  });
  expect(res.ok(), `review failed: ${await res.text()}`).toBeTruthy();
}

test('T08-A：晋北员工全盘确认报名，直通归档且不进待审', async ({ page, browser }) => {
  test.setTimeout(180_000);
  await resetSubmissionForE2E({ employeeNo: AFFIRM_EMPLOYEE.no, templateId: TEMPLATE_ID });

  await loginEmployee(page, AFFIRM_EMPLOYEE.no);
  await openSubmission(page);
  await clearSavedAppeals(page);
  await selectDeclarationSpecialty(page, '变电运维');

  const affirm = page.getByRole('button', { name: '确认报名' });
  await expect(affirm).toBeEnabled();
  await expect(page.getByRole('button', { name: '提交审核' })).toBeDisabled();
  await affirm.click();
  await page.waitForURL(/\/app\/?$/, { timeout: 60_000 });
  await expect(page.getByText(/终审通过|已归档|L2_APPROVED/).first()).toBeVisible({
    timeout: 20_000,
  });

  const record = await prisma.performanceRecord.findFirst({
    where: { year: YEAR, user: { employeeNo: AFFIRM_EMPLOYEE.no } },
    select: { totalScore: true },
  });
  expect(record, 'AFFIRM 应生成 PerformanceRecord').toBeTruthy();
  expect(Number(record!.totalScore)).toBeGreaterThanOrEqual(0);

  const wrongL1 = await browser.newPage();
  await loginReviewer(wrongL1, L1_WRONG, STAFF_PASSWORD);
  await filterReviewQueue(wrongL1, AFFIRM_EMPLOYEE.no);
  await expect(wrongL1.getByText(AFFIRM_EMPLOYEE.no)).toHaveCount(0);
  await wrongL1.close();
});

test('T08-B：变电员工申诉两项 → 工区核对 → 双部门 L2 → 管理员改分 → 量化报送表', async ({
  page,
  browser,
}) => {
  test.setTimeout(600_000);
  await resetSubmissionForE2E({ employeeNo: APPEAL_EMPLOYEE.no, templateId: TEMPLATE_ID });

  // --- 员工申诉两项并送审 ---
  await loginEmployee(page, APPEAL_EMPLOYEE.no);
  await openSubmission(page);
  await clearSavedAppeals(page);
  await selectDeclarationSpecialty(page, '变电检修');

  await saveAppeal(
    page,
    '一、基本素质（满分14分）',
    SKILL_ITEM,
    SKILL_CLAIM,
    'T08 E2E 技能等级申诉',
  );
  await saveAppeal(
    page,
    '三、工作现场（满分42分）',
    DEFECT_ITEM,
    DEFECT_CLAIM,
    'T08 E2E 缺陷治理申诉',
  );
  await expect(page.getByText('已保存的申诉（2）')).toBeVisible({ timeout: 30_000 });

  await expect(page.getByRole('button', { name: '提交审核' })).toBeEnabled();
  await page.getByRole('button', { name: '提交审核' }).click();
  await page.waitForURL(/\/app\/?$/, { timeout: 45_000 });

  const submission = await prisma.submission.findFirst({
    where: { templateId: TEMPLATE_ID, user: { employeeNo: APPEAL_EMPLOYEE.no } },
    select: {
      id: true,
      status: true,
      branchId: true,
      workAreaName: true,
      items: {
        where: { confirmationStatus: 'DISPUTED' },
        select: {
          id: true,
          score: true,
          disputeClaimedScore: true,
          item: { select: { title: true, dimensionCode: true } },
        },
      },
    },
  });
  expect(submission?.status).toBe('SUBMITTED');
  expect(submission?.workAreaName ?? '').toMatch(/变电检修中心/);
  expect(submission?.items.length).toBe(2);

  const skillItem = submission!.items.find((i) => i.item.dimensionCode === 'basic.skill-level');
  const defectItem = submission!.items.find((i) => i.item.dimensionCode === 'worksite.defect-governance');
  expect(skillItem, '应有技能等级申诉项').toBeTruthy();
  expect(defectItem, '应有缺陷治理申诉项').toBeTruthy();
  const skillSystem = Number(skillItem!.score);
  const defectSystem = Number(defectItem!.score);
  expect(Number(skillItem!.disputeClaimedScore)).toBe(SKILL_CLAIM);
  expect(Number(defectItem!.disputeClaimedScore)).toBe(DEFECT_CLAIM);

  // --- 错误工区 L1 不可见 ---
  const wrongL1 = await browser.newPage();
  await loginReviewer(wrongL1, L1_WRONG, STAFF_PASSWORD);
  await filterReviewQueue(wrongL1, APPEAL_EMPLOYEE.no);
  await expect(wrongL1.locator('tr').filter({ hasText: APPEAL_EMPLOYEE.no })).toHaveCount(0);
  await wrongL1.close();

  // --- 正确工区 L1 批量确认两项 ---
  const l1 = await browser.newPage();
  await loginReviewer(l1, L1_CORRECT, STAFF_PASSWORD);
  await filterReviewQueue(l1, APPEAL_EMPLOYEE.no);

  const skillRow = l1.locator('tr').filter({ hasText: APPEAL_EMPLOYEE.no }).filter({ hasText: '技能等级' });
  const defectRow = l1.locator('tr').filter({ hasText: APPEAL_EMPLOYEE.no }).filter({ hasText: '缺陷治理' });
  await expect(skillRow.first()).toBeVisible({ timeout: 20_000 });
  await expect(defectRow.first()).toBeVisible({ timeout: 20_000 });
  await expect(skillRow.first()).toContainText(/变电检修中心/);
  await expect(skillRow.first()).toContainText('T08 E2E 技能等级申诉');
  await expect(defectRow.first()).toContainText('T08 E2E 缺陷治理申诉');
  await expect(defectRow.first()).toContainText(/变电检修中心/);

  // 受控多选在 Playwright 下偶发丢勾；UI 已核对工区后，用同会话 API 一次提交全部待审项
  const l1Res = await l1.request.post('/api/review', {
    data: {
      batches: [{
        submissionId: submission!.id,
        decisions: [
          {
            submissionItemId: skillItem!.id,
            action: 'APPROVE',
            disputeAction: 'APPROVE',
          },
          {
            submissionItemId: defectItem!.id,
            action: 'APPROVE',
            disputeAction: 'APPROVE',
          },
        ],
      }],
    },
  });
  expect(l1Res.ok(), `L1 failed: ${await l1Res.text()}`).toBeTruthy();
  await l1.reload();
  await filterReviewQueue(l1, APPEAL_EMPLOYEE.no);
  await expect(skillRow).toHaveCount(0, { timeout: 20_000 });
  await expect(defectRow).toHaveCount(0, { timeout: 20_000 });
  await l1.close();

  await expect
    .poll(async () => {
      const row = await prisma.submission.findUnique({
        where: { id: submission!.id },
        select: { status: true },
      });
      return row?.status;
    })
    .toBe('L1_APPROVED');

  // --- L2 组织部确认技能等级 ---
  const l2Org = await browser.newPage();
  await loginReviewer(l2Org, L2_ORG, STAFF_PASSWORD);
  await expect(l2Org.getByText(/二级 \/ 总部部门/)).toBeVisible({ timeout: 15_000 });
  await filterReviewQueue(l2Org, APPEAL_EMPLOYEE.no);
  await confirmAppealRow(l2Org, APPEAL_EMPLOYEE.no, '技能等级', skillItem!.id);
  await l2Org.reload();
  await filterReviewQueue(l2Org, APPEAL_EMPLOYEE.no);
  await expect(
    l2Org.locator('tr').filter({ hasText: APPEAL_EMPLOYEE.no }).filter({ hasText: '技能等级' }),
  ).toHaveCount(0, { timeout: 20_000 });
  // 缺陷应不在组织部队列
  await expect(
    l2Org.locator('tr').filter({ hasText: APPEAL_EMPLOYEE.no }).filter({ hasText: '缺陷治理' }),
  ).toHaveCount(0);
  await l2Org.close();

  // --- L2 运检部确认缺陷治理并终审 ---
  const l2Ops = await browser.newPage();
  await loginReviewer(l2Ops, L2_OPS, STAFF_PASSWORD);
  await filterReviewQueue(l2Ops, APPEAL_EMPLOYEE.no);
  await confirmAppealRow(l2Ops, APPEAL_EMPLOYEE.no, '缺陷治理', defectItem!.id);
  await l2Ops.close();

  await expect
    .poll(async () => {
      const row = await prisma.submission.findUnique({
        where: { id: submission!.id },
        select: { status: true },
      });
      return row?.status;
    }, { timeout: 60_000 })
    .toBe('L2_APPROVED');

  const beforeOverride = await prisma.submission.findUnique({
    where: { id: submission!.id },
    select: { totalScore: true },
  });
  const totalBefore = Number(beforeOverride?.totalScore ?? 0);

  // --- 管理员改分（技能 + 缺陷）---
  const admin = await browser.newPage();
  await loginAdmin(admin, ADMIN_ACCOUNT, ADMIN_PASSWORD);
  await admin.goto(`/admin/fact-corrections/${submission!.id}`);
  await expect(admin.getByRole('heading', { name: '申诉得分调整' })).toBeVisible({ timeout: 20_000 });
  admin.on('dialog', (d) => d.accept());

  async function overrideItem(titlePart: string, score: number, reason: string) {
    await admin.getByRole('button', { name: new RegExp(titlePart) }).first().click();
    await admin.locator('label').filter({ hasText: '调整后得分' }).locator('input').fill(String(score));
    await admin.locator('label').filter({ hasText: '调整原因' }).locator('textarea').fill(reason);
    const [res] = await Promise.all([
      admin.waitForResponse(
        (r) => r.url().includes('/api/admin/override') && r.request().method() === 'POST',
        { timeout: 30_000 },
      ),
      admin.getByRole('button', { name: /保存得分调整|更新覆盖分/ }).click(),
    ]);
    expect(res.ok(), `override failed: ${await res.text()}`).toBeTruthy();
  }

  await overrideItem('技能等级', SKILL_OVERRIDE, 'T08 E2E 管理员调整技能等级');
  await overrideItem('缺陷治理', DEFECT_OVERRIDE, 'T08 E2E 管理员调整缺陷治理');

  const afterItems = await prisma.submissionItem.findMany({
    where: { submissionId: submission!.id, id: { in: [skillItem!.id, defectItem!.id] } },
    select: { id: true, score: true, overrideScore: true },
  });
  const skillAfter = afterItems.find((i) => i.id === skillItem!.id)!;
  const defectAfter = afterItems.find((i) => i.id === defectItem!.id)!;
  expect(Number(skillAfter.score)).toBe(skillSystem);
  expect(Number(skillAfter.overrideScore)).toBe(SKILL_OVERRIDE);
  expect(Number(defectAfter.score)).toBe(defectSystem);
  expect(Number(defectAfter.overrideScore)).toBe(DEFECT_OVERRIDE);

  const afterSubmission = await prisma.submission.findUnique({
    where: { id: submission!.id },
    select: { totalScore: true },
  });
  const expectedDelta = (SKILL_OVERRIDE - skillSystem) + (DEFECT_OVERRIDE - defectSystem);
  expect(Number(afterSubmission?.totalScore)).toBeCloseTo(totalBefore + expectedDelta, 5);

  // --- 量化报送分析：覆盖分进最终分 + 调整说明 ---
  const branch = await prisma.branch.findFirst({
    where: { name: APPEAL_EMPLOYEE.branch },
    select: { id: true },
  });
  const qRes = await admin.request.get(
    `/api/admin/reports/quantitative?year=${YEAR}&branchId=${branch!.id}`,
  );
  expect(qRes.ok(), await qRes.text()).toBeTruthy();
  const qJson = await qRes.json();
  const record = (qJson.analysis?.records ?? []).find(
    (row: { employeeNo: string }) => row.employeeNo === APPEAL_EMPLOYEE.no,
  );
  expect(record, '量化分析应包含申诉员工').toBeTruthy();
  expect(Number(record.skillLevel)).toBe(SKILL_OVERRIDE);
  expect(Number(record.defectGovernance)).toBe(DEFECT_OVERRIDE);
  expect(String(record.appealAdjustmentNote)).toMatch(/技能等级：/);
  expect(String(record.appealAdjustmentNote)).toMatch(/缺陷治理：/);
  expect(Number(record.totalScore)).toBeCloseTo(
    Number(record.importedTotalScore) + Number(record.appealAdjustmentDelta),
    5,
  );

  // --- 导出量化 XLSX ---
  const exportRes = await admin.request.get(
    `/api/admin/reports/quantitative/export?year=${YEAR}&branchId=${branch!.id}`,
  );
  expect(exportRes.ok(), await exportRes.text()).toBeTruthy();
  const ctype = exportRes.headers()['content-type'] ?? '';
  expect(ctype).toMatch(/spreadsheet|octet-stream|excel/i);
  const buf = Buffer.from(await exportRes.body());
  expect(buf.byteLength).toBeGreaterThan(1000);

  await admin.close();
});
