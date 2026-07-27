import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { formatPerformanceFactRecord } from './fact-record-view';

describe('formatPerformanceFactRecord', () => {
  it('将两票记录转换为员工可读事实，不暴露数据库枚举名', () => {
    const view = formatPerformanceFactRecord({
      id: 'fact-1',
      dimensionCode: 'worksite.ticket-execution',
      dimensionTitle: '两票执行',
      score: 0.01,
      role: 'FIRST_HANDLER',
      eventType: 'REMEDIATION',
      defectRef: 'operation:CZ-001:row2:E001',
      defectLevel: '',
      eventDate: null,
      sourceFile: '10.2025操作票（1013条）.xlsx',
      recordKey: 'operation:CZ-001:row2:E001',
      recordType: 'OPERATION_TICKET',
      recordTitle: '操作票 CZ-001 · 母线倒闸操作',
      participationRole: '操作人、值班负责人',
      sourceSheet: '操作票',
      sourceRowNo: 2,
      metadata: {
        sourceData: {
          票号: 'CZ-001',
          操作任务: '母线倒闸操作',
          票状态: '已执行',
          操作人: '张三',
          人员编号: 'E001',
          监护人: '李四',
          人员编号_1: 'E002',
        },
      },
    });

    assert.equal(view.title, '操作票 CZ-001 · 母线倒闸操作');
    assert.equal(view.roleLabel, '操作人、值班负责人');
    assert.equal(view.score, 0.01);
    assert.deepEqual(view.details, [
      { label: '票号', value: 'CZ-001' },
      { label: '操作任务', value: '母线倒闸操作' },
      { label: '票状态', value: '已执行' },
    ]);
    assert.equal(JSON.stringify(view).includes('李四'), false);
    assert.equal(JSON.stringify(view).includes('E002'), false);
    assert.deepEqual(view.source, {
      file: '10.2025操作票（1013条）.xlsx',
      sheet: '操作票',
      rowNo: 2,
    });
    assert.equal(JSON.stringify(view).includes('FIRST_HANDLER'), false);
    assert.equal(JSON.stringify(view).includes('REMEDIATION'), false);
  });

  it('兼容旧事实并将角色枚举翻译为中文', () => {
    const view = formatPerformanceFactRecord({
      id: 'fact-2',
      dimensionCode: 'worksite.defect-governance',
      dimensionTitle: '缺陷治理',
      score: 3,
      role: 'FIRST_DISCOVERER',
      eventType: 'DISCOVERY',
      defectRef: 'QX-2025-001',
      defectLevel: '严重',
      eventDate: '2025-03-01',
      sourceFile: '问题清单.xlsx',
      metadata: {
        station: '甲站',
        description: '主变渗油',
      },
    });

    assert.equal(view.title, '缺陷 QX-2025-001');
    assert.equal(view.roleLabel, '第一发现人');
    assert.deepEqual(view.details, [
      { label: '缺陷等级', value: '严重' },
      { label: '变电站', value: '甲站' },
      { label: '问题描述', value: '主变渗油' },
    ]);
  });

  it('旧技术贡献事实优先显示业务项目和参与角色，不显示占位枚举', () => {
    const view = formatPerformanceFactRecord({
      id: 'fact-3',
      dimensionCode: 'performance.technical-contribution.regulation',
      dimensionTitle: '技术贡献（运规编写/会审）',
      score: 2,
      role: 'FIRST_HANDLER',
      eventType: 'REMEDIATION',
      defectRef: 'tech:performance.technical-contribution.regulation:500kV运行规程:E001',
      sourceFile: '运规.xlsx',
      metadata: {
        projectName: '500kV运行规程',
        role: '会审人员',
      },
    });

    assert.equal(view.title, '500kV运行规程');
    assert.equal(view.roleLabel, '会审人员');
    assert.equal(JSON.stringify(view).includes('FIRST_HANDLER'), false);
    assert.equal(view.title.includes('tech:'), false);
  });

  it('专利事实显示真实专利属性和发明人顺序，不把申请人误称为专利名', () => {
    const view = formatPerformanceFactRecord({
      id: 'fact-4',
      dimensionCode: 'performance.innovation.paper-patent',
      dimensionTitle: '发明专利',
      score: 3,
      role: 'FIRST_HANDLER',
      eventType: 'REMEDIATION',
      defectRef: 'patent:row1:order2:某申请人',
      sourceFile: '专利.xlsx',
      metadata: {
        patentApplicant: '某申请人',
        patentType: '授权发明',
        grantDate: '2025-11-21',
        order: 2,
      },
    });

    assert.equal(view.title, '专利记录 · 授权发明 · 授权日 2025-11-21');
    assert.equal(view.roleLabel, '第 2 发明人');
    assert.deepEqual(view.details, [
      { label: '专利申请人', value: '某申请人' },
      { label: '专利类型', value: '授权发明' },
      { label: '授权日', value: '2025-11-21' },
      { label: '发明人顺序', value: '2' },
    ]);
    assert.equal(JSON.stringify(view).includes('FIRST_HANDLER'), false);
  });
});
