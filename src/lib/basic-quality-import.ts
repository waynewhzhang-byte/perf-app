/**
 * 《基本素质信息》.xlsx 导入：
 * - 创建/更新 User（员工档案）
 * - 写入 EmployeeBasicFact（技能/职称/绩效三维度）
 */
import { readFileSync } from 'fs';
import * as XLSX from 'xlsx';
import type { BasicDimension, PrismaClient } from '@prisma/client';
import {
  SHEET1_COLUMNS,
  SHEET2_COLUMNS,
  scoreSkillLevel,
  scoreTitleLevel,
  scorePerformanceLevel,
  DEFAULT_SKILL_TIERS,
  DEFAULT_TITLE_TIERS,
  DEFAULT_PERFORMANCE_TIERS,
} from '@/lib/basic-quality';
import { parseOrgFromExcelRow, type OrgBootstrapPlan, buildOrgBootstrapPlan } from '@/lib/org-mapping';

/**
 * 基本素质三维度档位表（来自 ScoringRule.config.tiers）。
 * 任一维度未提供则回退对应 DEFAULT_*。
 */
export interface BasicQualityTiers {
  skill?: Record<string, number>;
  title?: Record<string, number>;
  performance?: Record<string, number>;
}

export interface BasicQualityEmployeeRow {
  employeeNo: string;
  name: string;
  departmentRaw: string;
  teamRaw: string;
  positionRaw: string;
  gender: string;
  skillLevel: string;
  titleLevel: string;
  profile: Record<string, string>;
}

export interface BasicQualityAssessmentRow {
  employeeNo: string;
  name: string;
  year2023: string | null;
  year2024: string | null;
  year2025: string | null;
}

export interface BasicQualityParseResult {
  employees: BasicQualityEmployeeRow[];
  assessments: Map<string, BasicQualityAssessmentRow>;
  orgPlan: OrgBootstrapPlan;
}

export interface BasicQualityFactDraft {
  employeeNo: string;
  employeeName: string;
  dimension: BasicDimension;
  tierValue: string;
  yearBreakdown: Record<string, string | null> | null;
  score: number;
}

function cellString(value: unknown): string {
  if (value == null) return '';
  return String(value).trim();
}

function sheetMatrix(wb: XLSX.WorkBook, name: string): unknown[][] {
  const sheet = wb.Sheets[name];
  if (!sheet) throw new Error(`缺少工作表「${name}」`);
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false }) as unknown[][];
}

/** 解析《基本素质信息》两个 Sheet */
export function parseBasicQualityFile(filePath: string): BasicQualityParseResult {
  const buf = readFileSync(filePath);
  const wb = XLSX.read(buf, { type: 'buffer', cellDates: false });

  const sheet1 = sheetMatrix(wb, '技能等级 职称');
  const employees: BasicQualityEmployeeRow[] = [];

  for (let i = 1; i < sheet1.length; i++) {
    const row = sheet1[i] ?? [];
    const employeeNo = cellString(row[SHEET1_COLUMNS.employeeNo]);
    const name = cellString(row[SHEET1_COLUMNS.name]);
    if (!employeeNo || !name) continue;

    employees.push({
      employeeNo,
      name,
      departmentRaw: cellString(row[SHEET1_COLUMNS.department]),
      teamRaw: cellString(row[SHEET1_COLUMNS.team]),
      positionRaw: cellString(row[SHEET1_COLUMNS.position]),
      gender: cellString(row[SHEET1_COLUMNS.gender]),
      skillLevel: cellString(row[SHEET1_COLUMNS.skillLevel]),
      titleLevel: cellString(row[SHEET1_COLUMNS.titleLevel]),
      profile: {
        positionCode: cellString(row[SHEET1_COLUMNS.positionCode]),
        positionCategory: cellString(row[SHEET1_COLUMNS.positionCategory]),
        workLeaderFlag: cellString(row[SHEET1_COLUMNS.workLeaderFlag]),
        skillJobType: cellString(row[SHEET1_COLUMNS.skillJobType]),
        titleSeries: cellString(row[SHEET1_COLUMNS.titleSeries]),
        team: cellString(row[SHEET1_COLUMNS.team]),
        department: cellString(row[SHEET1_COLUMNS.department]),
      },
    });
  }

  const sheet2 = sheetMatrix(wb, '考核结果');
  const assessments = new Map<string, BasicQualityAssessmentRow>();

  // 真实表头在第 2 行（index 1），数据从第 3 行起
  let headerIdx = 0;
  for (let i = 0; i < Math.min(5, sheet2.length); i++) {
    if (cellString((sheet2[i] ?? [])[SHEET2_COLUMNS.employeeNo]) === '人员编码') {
      headerIdx = i;
      break;
    }
  }

  for (let i = headerIdx + 1; i < sheet2.length; i++) {
    const row = sheet2[i] ?? [];
    const employeeNo = cellString(row[SHEET2_COLUMNS.employeeNo]);
    const name = cellString(row[SHEET2_COLUMNS.name]);
    if (!employeeNo) continue;

    const norm = (v: unknown) => {
      const s = cellString(v).toUpperCase();
      return s === 'A' || s === 'B' || s === 'C' ? s : null;
    };

    assessments.set(employeeNo, {
      employeeNo,
      name: name || employees.find((e) => e.employeeNo === employeeNo)?.name || '',
      year2023: norm(row[SHEET2_COLUMNS.year2023]),
      year2024: norm(row[SHEET2_COLUMNS.year2024]),
      year2025: norm(row[SHEET2_COLUMNS.year2025]),
    });
  }

  const orgPlan = buildOrgBootstrapPlan(
    employees.map((e) => ({ departmentRaw: e.departmentRaw, teamRaw: e.teamRaw })),
  );

  return { employees, assessments, orgPlan };
}

/** 由员工档案 + 考核结果生成三条基本素质事实 */
export function buildBasicQualityFacts(
  employee: BasicQualityEmployeeRow,
  assessment: BasicQualityAssessmentRow | undefined,
  evalYear: number,
  tiers: BasicQualityTiers = {},
): BasicQualityFactDraft[] {
  const facts: BasicQualityFactDraft[] = [];

  const skillTier = employee.skillLevel || '其他';
  facts.push({
    employeeNo: employee.employeeNo,
    employeeName: employee.name,
    dimension: 'SKILL_LEVEL',
    tierValue: skillTier,
    yearBreakdown: null,
    score: scoreSkillLevel(skillTier, tiers.skill ?? DEFAULT_SKILL_TIERS),
  });

  const titleTier = employee.titleLevel || '';
  facts.push({
    employeeNo: employee.employeeNo,
    employeeName: employee.name,
    dimension: 'TITLE_LEVEL',
    tierValue: titleTier || '无',
    yearBreakdown: null,
    score: scoreTitleLevel(titleTier, tiers.title ?? DEFAULT_TITLE_TIERS),
  });

  const grades = assessment
    ? [assessment.year2023, assessment.year2024, assessment.year2025]
    : [null, null, null];
  const perf = scorePerformanceLevel(grades, tiers.performance ?? DEFAULT_PERFORMANCE_TIERS);
  const breakdown: Record<string, string | null> = {
    '2023': assessment?.year2023 ?? null,
    '2024': assessment?.year2024 ?? null,
    '2025': assessment?.year2025 ?? null,
  };

  facts.push({
    employeeNo: employee.employeeNo,
    employeeName: employee.name,
    dimension: 'PERFORMANCE_LEVEL',
    tierValue: perf.code,
    yearBreakdown: breakdown,
    score: perf.score,
  });

  return facts;
}

export interface OrgLookup {
  branchIdByName: Map<string, string>;
  departmentIdByKey: Map<string, string>;
  positionIdByName: Map<string, string>;
}

function deptKey(branchName: string, deptName: string) {
  return `${branchName}\0${deptName}`;
}

/** 确保组织架构存在，返回 id 查找表 */
export async function ensureOrgStructure(
  prisma: PrismaClient,
  plan: OrgBootstrapPlan,
): Promise<OrgLookup> {
  const branchIdByName = new Map<string, string>();
  const departmentIdByKey = new Map<string, string>();
  const positionIdByName = new Map<string, string>();

  for (const name of plan.branches) {
    const existing = await prisma.branch.findFirst({ where: { name } });
    const branch = existing ?? (await prisma.branch.create({ data: { name } }));
    branchIdByName.set(name, branch.id);
  }

  for (const { branchName, name } of plan.departments) {
    const branchId = branchIdByName.get(branchName);
    if (!branchId) continue;
    const existing = await prisma.department.findFirst({
      where: { branchId, name },
    });
    const dept = existing ?? (await prisma.department.create({ data: { branchId, name } }));
    departmentIdByKey.set(deptKey(branchName, name), dept.id);
  }

  return { branchIdByName, departmentIdByKey, positionIdByName };
}

async function ensurePosition(prisma: PrismaClient, name: string, cache: Map<string, string>) {
  if (!name) return null;
  const hit = cache.get(name);
  if (hit) return hit;
  const existing = await prisma.position.findFirst({ where: { name } });
  const pos = existing ?? (await prisma.position.create({ data: { name } }));
  cache.set(name, pos.id);
  return pos.id;
}

export interface BasicQualityImportResult {
  usersCreated: number;
  usersUpdated: number;
  basicFactsWritten: number;
  org: OrgBootstrapPlan;
  employeeCount: number;
  assessmentCount: number;
}

/** 从 DB 读三条基本素质维度的 tiers（DB 无配置回退默认种子） */
export async function loadBasicQualityTiers(
  prisma: PrismaClient,
): Promise<BasicQualityTiers> {
  const read = async (code: string, fallback: Record<string, number>) => {
    const row = await prisma.scoringRule.findUnique({ where: { dimensionCode: code } });
    const cfg = (row?.config ?? {}) as { tiers?: Record<string, number> };
    return cfg.tiers ?? fallback;
  };
  const [skill, title, performance] = await Promise.all([
    read('basic.skill-level', DEFAULT_SKILL_TIERS),
    read('basic.title-level', DEFAULT_TITLE_TIERS),
    read('basic.performance-level', DEFAULT_PERFORMANCE_TIERS),
  ]);
  return { skill, title, performance };
}

/** 导入员工 + 基本素质事实（事务外按批写入） */
export async function importBasicQualityData(
  prisma: PrismaClient,
  filePath: string,
  evalYear: number,
): Promise<BasicQualityImportResult> {
  const parsed = parseBasicQualityFile(filePath);
  const orgLookup = await ensureOrgStructure(prisma, parsed.orgPlan);
  const tiers = await loadBasicQualityTiers(prisma);

  let usersCreated = 0;
  let usersUpdated = 0;
  let basicFactsWritten = 0;

  for (const emp of parsed.employees) {
    const org = parseOrgFromExcelRow(emp.departmentRaw, emp.teamRaw);
    const branchId = org ? orgLookup.branchIdByName.get(org.branchName) ?? null : null;
    let departmentId: string | null = null;
    if (org?.departmentName) {
      departmentId = orgLookup.departmentIdByKey.get(deptKey(org.branchName, org.departmentName)) ?? null;
    }
    const positionId = await ensurePosition(prisma, emp.positionRaw, orgLookup.positionIdByName);

    const existing = await prisma.user.findFirst({
      where: { employeeNo: emp.employeeNo },
      select: { id: true },
    });

    const userData = {
      fullName: emp.name,
      employeeNo: emp.employeeNo,
      gender: emp.gender || null,
      branchId,
      departmentId,
      positionId,
      profile: emp.profile as object,
    };

    let userId: string;
    if (existing) {
      await prisma.user.update({ where: { id: existing.id }, data: userData });
      userId = existing.id;
      usersUpdated++;
    } else {
      const created = await prisma.user.create({
        data: {
          contact: emp.employeeNo,
          passwordHash: '',
          ...userData,
        },
      });
      userId = created.id;
      usersCreated++;
    }

    const assessment = parsed.assessments.get(emp.employeeNo);
    const facts = buildBasicQualityFacts(emp, assessment, evalYear, tiers);

    for (const fact of facts) {
      await prisma.employeeBasicFact.upsert({
        where: {
          year_employeeNo_dimension: {
            year: evalYear,
            employeeNo: fact.employeeNo,
            dimension: fact.dimension,
          },
        },
        create: {
          year: evalYear,
          employeeNo: fact.employeeNo,
          employeeName: fact.employeeName,
          userId,
          dimension: fact.dimension,
          tierValue: fact.tierValue,
          yearBreakdown: fact.yearBreakdown ?? undefined,
          score: fact.score,
          sourceFile: filePath,
        },
        update: {
          employeeName: fact.employeeName,
          userId,
          tierValue: fact.tierValue,
          yearBreakdown: fact.yearBreakdown ?? undefined,
          score: fact.score,
          sourceFile: filePath,
        },
      });
      basicFactsWritten++;
    }
  }

  return {
    usersCreated,
    usersUpdated,
    basicFactsWritten,
    org: parsed.orgPlan,
    employeeCount: parsed.employees.length,
    assessmentCount: parsed.assessments.size,
  };
}
