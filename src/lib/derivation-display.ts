import type { Derivation, DerivationFactField, DerivationStep } from '@/lib/fact-derivation';

const ROLE_LABEL: Record<string, string> = {
  FIRST_DISCOVERER: '第一发现人',
  CO_DISCOVERER: '共同发现人',
  FIRST_HANDLER: '第一处理人',
  CO_HANDLER: '共同处理人',
};

function ticketPreviewParts(steps: DerivationStep[]): string[] {
  const parts: string[] = [];
  for (const step of steps) {
    if (step.kind === 'note' || step.kind === 'final' || step.kind === 'cap') continue;
    const op = step.label.match(/^操作票 (\d+) 项/);
    if (op) {
      parts.push(`操作票${op[1]}项`);
      continue;
    }
    const leader = step.label.match(/^工作票负责人得分 ([\d.]+)/);
    if (leader) {
      parts.push(`工作负责人${leader[1]}分`);
      continue;
    }
    const permitter = step.label.match(/^工作票许可人得分 ([\d.]+)/);
    if (permitter) {
      parts.push(`工作许可人${permitter[1]}分`);
      continue;
    }
    const member = step.label.match(/^工作票班成员得分 ([\d.]+)/);
    if (member) {
      parts.push(`班成员${member[1]}分`);
      continue;
    }
  }
  return parts;
}

function defectPreviewParts(facts: DerivationFactField[]): string[] {
  const counts = new Map<string, number>();
  for (const fact of facts) {
    const level = fact.defectLevel ?? '';
    const role = fact.role ? (ROLE_LABEL[fact.role] ?? fact.role) : '';
    const key = `${level}${role}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([label, count]) => `${label}${count}次`);
}

function manualPreviewParts(facts: DerivationFactField[]): string[] {
  return facts.map((fact) => {
    const title = (fact.thirdLevelTitle ?? fact.label ?? '明细').replace(/\s+/g, '');
    return `${title}${fact.score}分`;
  });
}

function genericStepPreview(steps: DerivationStep[]): string {
  const labels = steps
    .filter((step) => step.kind !== 'note' && step.kind !== 'subtotal' && step.kind !== 'cap' && step.kind !== 'final')
    .map((step) => step.label.replace(/\s+/g, ''));
  return labels.slice(0, 4).join('+');
}

/** 将 fact-derivation 步骤压缩为一行预览（两票/缺陷等拼接形态）。 */
export function formatDerivationPreview(derivation: Pick<Derivation, 'ruleType' | 'steps' | 'rawFactFields'>): string {
  const { ruleType, steps, rawFactFields } = derivation;
  const emptyNote = steps.find((step) => step.kind === 'note' && /暂无导入/.test(step.label));
  if (emptyNote) return emptyNote.label;

  if (ruleType === 'NORMALIZE') {
    const parts = ticketPreviewParts(steps);
    if (parts.length > 0) return parts.join('+');
  }

  if (ruleType === 'MATRIX_SUM' || ruleType === 'SHARE') {
    const parts = defectPreviewParts(rawFactFields);
    if (parts.length > 0) return parts.join('+');
  }

  if (ruleType === 'BASIC_TIER') {
    const fact = rawFactFields[0];
    if (fact?.tierValue) return `档位${fact.tierValue}→${fact.score}分`;
  }

  if (ruleType === 'MANUAL_TIERS' || ruleType === 'MANUAL_COUNTED') {
    const parts = manualPreviewParts(rawFactFields);
    if (parts.length > 0) return parts.join('+');
  }

  if (ruleType === 'DEDUCTION') {
    const parts = rawFactFields.map((fact) => {
      const ref = fact.defectRef ?? fact.label ?? '违章';
      const role = fact.role ?? '';
      return `${ref}${role}${fact.score}分`;
    });
    if (parts.length > 0) return parts.join('+');
  }

  const generic = genericStepPreview(steps);
  if (generic) return generic;
  return steps.find((step) => step.kind !== 'note')?.label ?? '暂无计算过程';
}

/** 截断计算过程预览，超出部分以省略号表示。 */
export function truncateDerivationPreview(text: string, maxLength = 56): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1)}…`;
}
