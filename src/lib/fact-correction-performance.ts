import type { PerformanceFact } from '@prisma/client';
import type { PerformanceFactSeed } from '@/lib/performance-fact-repository';
import { buildCompetitionSeeds } from '@/lib/competition-import';
import { buildInnovationSeeds } from '@/lib/innovation-import';
import { buildTechContribSeeds, TECH_CONTRIB_KINDS } from '@/lib/tech-contrib-import';
import { buildViolationSeeds } from '@/lib/violation-import';

type Metadata = Record<string, unknown>;

export interface DerivedFactCorrectionInput {
  dimensionCode: string;
  year: number;
  employeeNo: string;
  employeeName: string;
  sourceFile: string;
  existing?: PerformanceFact | null;
  subtype?: string;
  award?: string;
  level?: string;
  project?: string;
  category?: string;
  violationLevel?: string;
  violationRole?: string;
  description?: string;
  eventDate?: string;
}

function metadataOf(fact: PerformanceFact | null | undefined): Metadata {
  return (fact?.metadata && typeof fact.metadata === 'object' && !Array.isArray(fact.metadata))
    ? fact.metadata as Metadata
    : {};
}

function required(value: string | undefined, label: string): string {
  if (!value?.trim()) throw new Error(`请填写${label}`);
  return value.trim();
}

/** 将管理员修正输入按与导入完全相同的规则重建一条细粒度事实。 */
export function buildDerivedFactCorrection(input: DerivedFactCorrectionInput): PerformanceFactSeed {
  const metadata = metadataOf(input.existing);
  const project = input.project?.trim() || String(metadata.project ?? metadata.projectName ?? '');

  if (input.dimensionCode === 'performance.technical-contribution') {
    const subtype = input.subtype || input.existing?.dimensionCode?.split('.').at(-1);
    const kind = subtype ? TECH_CONTRIB_KINDS[subtype] : undefined;
    if (!kind) throw new Error('请选择技术贡献事实类型');
    return buildTechContribSeeds(kind, [{
      employeeNo: input.employeeNo,
      employeeName: input.employeeName,
      projectName: required(project, '项目名称'),
      role: input.category?.trim() || String(metadata.role ?? ''),
    }], { employeeNo: 'employeeNo', employeeName: 'employeeName', projectName: 'projectName', role: 'role' }, input.year)[0]!;
  }

  if (input.dimensionCode === 'performance.competition') {
    const award = required(input.award || String(metadata.award ?? ''), '奖项名称');
    const level = required(input.level || String(metadata.level ?? ''), '获奖级别');
    const category = input.category?.trim()
      || String(metadata.category ?? '')
      || (input.existing?.dimensionCode === 'performance.competition.exam' ? '调考' : '');
    return buildCompetitionSeeds([{ employeeNo: input.employeeNo, employeeName: input.employeeName, award, level, category }], {
      employeeNo: 'employeeNo', employeeName: 'employeeName', award: 'award', level: 'level', category: 'category',
    }, input.year)[0]!;
  }

  if (input.dimensionCode === 'performance.innovation') {
    const award = required(input.award || String(metadata.award ?? ''), '奖项名称');
    const level = required(input.level || String(metadata.level ?? ''), '获奖级别');
    return buildInnovationSeeds([{ employeeNo: input.employeeNo, employeeName: input.employeeName, award, level, project }], {
      employeeNo: 'employeeNo', employeeName: 'employeeName', award: 'award', level: 'level', project: 'project',
    }, input.year)[0]!;
  }

  if (input.dimensionCode === 'special.violation-severe' || input.dimensionCode === 'special.violation-general') {
    const level = input.violationLevel?.trim()
      || (input.dimensionCode === 'special.violation-severe' ? '严重' : '一般');
    const role = required(input.violationRole || String(metadata.roleRaw ?? ''), '责任类型');
    const description = required(input.description || String(metadata.description ?? ''), '违章事实说明');
    return buildViolationSeeds([{ employeeNo: input.employeeNo, employeeName: input.employeeName, level, role, description, eventDate: input.eventDate ?? '' }], {
      employeeNo: 'employeeNo', employeeName: 'employeeName', level: 'level', role: 'role', description: 'description', eventDate: 'eventDate',
    }, input.year)[0]!;
  }

  throw new Error('该评分项不使用细粒度事实修正');
}

export function isDerivedFactCorrectionDimension(dimensionCode: string): boolean {
  return [
    'performance.technical-contribution',
    'performance.competition',
    'performance.innovation',
    'special.violation-severe',
    'special.violation-general',
  ].includes(dimensionCode);
}
