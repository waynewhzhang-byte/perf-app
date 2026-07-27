import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatDerivationPreview, truncateDerivationPreview } from './derivation-display';
import { buildDerivation, type DerivationInputFact } from './fact-derivation';

describe('formatDerivationPreview', () => {
  it('两票：拼接操作票与工作负责人片段', () => {
    const facts: DerivationInputFact[] = [{
      id: 't1',
      score: 18.5,
      metadata: {
        breakdown: {
          operationItems: 58,
          operationPoints: 0.58,
          workLeaderPoints: 10,
          workTicketCount: 5,
        },
      },
    }];
    const derivation = buildDerivation('worksite.ticket-execution', facts, {
      finalScore: 20,
      ticketCohortMax: 18.5,
    })!;
    const preview = formatDerivationPreview(derivation);
    assert.match(preview, /操作票58项/);
    assert.match(preview, /工作负责人10分/);
    assert.ok(preview.includes('+'));
  });

  it('缺陷：按等级+角色统计次数', () => {
    const facts: DerivationInputFact[] = [
      { id: 'd1', defectRef: 'D1', defectLevel: '重大缺陷', role: 'FIRST_DISCOVERER', score: 3 },
      { id: 'd2', defectRef: 'D2', defectLevel: '重大缺陷', role: 'FIRST_DISCOVERER', score: 3 },
      { id: 'd3', defectRef: 'D3', defectLevel: '较大缺陷', role: 'CO_DISCOVERER', score: 0.5 },
    ];
    const derivation = buildDerivation('worksite.defect-governance', facts, { finalScore: 6.5 })!;
    const preview = formatDerivationPreview(derivation);
    assert.match(preview, /重大缺陷第一发现人2次/);
    assert.match(preview, /较大缺陷共同发现人1次/);
  });

  it('无事实时返回兜底文案', () => {
    const derivation = buildDerivation('basic.skill-level', [], { finalScore: 0 })!;
    assert.match(formatDerivationPreview(derivation), /暂无导入事实/);
  });
});

describe('truncateDerivationPreview', () => {
  it('超长时截断并加省略号', () => {
    const text = 'a'.repeat(80);
    assert.equal(truncateDerivationPreview(text, 10), `${'a'.repeat(9)}…`);
  });
});
