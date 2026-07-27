import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  appendReportScopeFilters,
  parseReportExportFilters,
  parseReportScopeFilters,
  reportSubmissionScopeWhere,
  safeParseReportScopeFilters,
} from './report-filters';

describe('report filters', () => {
  it('accepts repeated multi-value parameters and legacy singular parameters', () => {
    const params = new URLSearchParams(
      'branchIds=b1&branchIds=b2&branchId=b1'
      + '&declarationLevelIds=l1,l2'
      + '&declarationSpecialtyId=s1',
    );
    assert.deepEqual(parseReportScopeFilters(params), {
      branchIds: ['b1', 'b2'],
      declarationLevelIds: ['l1', 'l2'],
      declarationSpecialtyIds: ['s1'],
    });
  });

  it('builds one Prisma scope shared by query and export', () => {
    assert.deepEqual(
      reportSubmissionScopeWhere({
        branchIds: ['b1', 'b2'],
        declarationLevelIds: ['l1'],
        declarationSpecialtyIds: ['s1', 's2'],
      }),
      {
        AND: [
          {
            OR: [
              { branchId: { in: ['b1', 'b2'] } },
              { branchId: null, user: { branchId: { in: ['b1', 'b2'] } } },
            ],
          },
          { declarationLevelId: { in: ['l1'] } },
          { declarationSpecialtyId: { in: ['s1', 's2'] } },
        ],
      },
    );
  });

  it('round-trips the canonical repeated query contract', () => {
    const params = appendReportScopeFilters(new URLSearchParams(), {
      branchIds: ['b1', 'b2'],
      declarationLevelIds: ['l1'],
      declarationSpecialtyIds: [],
    });
    params.set('templateId', 'tpl-1');
    const parsed = parseReportExportFilters(
      new URL(`http://localhost/report?${params}`),
    );
    assert.deepEqual(parsed, {
      templateId: 'tpl-1',
      branchIds: ['b1', 'b2'],
      declarationLevelIds: ['l1'],
      declarationSpecialtyIds: [],
    });
  });

  it('rejects an excessive multi-value query instead of widening the scope', () => {
    const params = new URLSearchParams();
    for (let index = 0; index < 101; index += 1) {
      params.append('branchIds', `branch-${index}`);
    }
    assert.deepEqual(safeParseReportScopeFilters(params), {
      success: false,
      error: '报表筛选参数无效',
    });
  });
});
