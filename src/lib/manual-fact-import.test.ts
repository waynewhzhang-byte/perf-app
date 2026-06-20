import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rowsToFactInputs } from './manual-fact-import';

describe('rowsToFactInputs', () => {
  it('两票：映射 rawScore/declarationLevel', () => {
    const inputs = rowsToFactInputs(
      'worksite.ticket-execution',
      { employeeNo: '工号', employeeName: '姓名', rawScore: '原始分', declarationLevel: '能级', eventDate: '日期' },
      [{ '工号': '001', '姓名': '张', '原始分': '88', '能级': '一级', '日期': '2025-01-01' }],
    );
    assert.equal(inputs.length, 1);
    assert.equal(inputs[0].employeeNo, '001');
    assert.equal(inputs[0].rawScore, 88);
    assert.equal(inputs[0].declarationLevel, '一级');
    assert.equal(inputs[0].eventDate, '2025-01-01');
  });

  it('缺陷：映射 role/eventType/defectLevel/defectRef', () => {
    const inputs = rowsToFactInputs(
      'worksite.defect-governance',
      { employeeNo: '工号', employeeName: '姓名', role: '角色', eventType: '事件类型', defectLevel: '缺陷等级', defectRef: '缺陷编号', eventDate: '日期' },
      [{ '工号': '001', '姓名': '张', '角色': '第一发现人', '事件类型': '发现', '缺陷等级': '严重', '缺陷编号': 'D-1', '日期': '' }],
    );
    assert.equal(inputs[0].role, 'FIRST_DISCOVERER');
    assert.equal(inputs[0].eventType, 'DISCOVERY');
    assert.equal(inputs[0].defectLevel, '严重');
    assert.equal(inputs[0].defectRef, 'D-1');
  });

  it('安全：映射 role/faultCount/incidentId', () => {
    const inputs = rowsToFactInputs(
      'performance.safety-contribution',
      { employeeNo: '工号', employeeName: '姓名', role: '角色', faultCount: '故障次数', incidentId: '事件编号', eventDate: '日期' },
      [{ '工号': '001', '姓名': '张', '角色': '共同发现人', '故障次数': '3', '事件编号': 'INC-1', '日期': '' }],
    );
    assert.equal(inputs[0].role, 'CO_DISCOVERER');
    assert.equal(inputs[0].faultCount, 3);
    assert.equal(inputs[0].incidentId, 'INC-1');
  });

  it('工号缺失跳过', () => {
    const inputs = rowsToFactInputs(
      'worksite.ticket-execution',
      { employeeNo: '工号', employeeName: '姓名', rawScore: '分', declarationLevel: '能级', eventDate: '日期' },
      [{ '工号': '', '姓名': '', '分': '', '能级': '', '日期': '' }],
    );
    assert.equal(inputs.length, 0);
  });
});
