import { describe, it } from 'node:test';
import assert from 'node:assert';
import { parseProblemListSheet, problemListToFactInputs } from '@/lib/problem-list-import';

describe('parseProblemListSheet', () => {
  it('parses a row with discoverer and fixer', () => {
    const sheet = {
      rows: [{
        '序号': 1,
        '问题分类': '表计问题',
        '问题描述': '3号主变压器B相绕温表故障',
        '编号': 'TX-25-17',
        '变电站': '500kV桐乡变电站',
        '上报来源': '人工上传',
        '所属类别': '缺陷',
        '问题标签': null,
        '等级': '严重',
        '设备分类': '主变压器',
        '设备名称': '3号主变压器',
        '设备型号': 'BWR-04J(TH)',
        '设备厂家': '大连世有电力科技有限公司',
        '出厂时间': '2014-11-01',
        '投运时间': '2015-09-29',
        '第一发现人': '苏攀',
        '员工编号': '11460637',
        '其他共同发现人': null,
        '其他共同发现人_员工编号': null,
        '问题类别': 'B',
        '责任单位': '变电检修中心',
        '计划消除时间': null,
        '消除时间': null,
        '需要停电': null,
        '问题状态': '待消除',
        '发现时间': '2025-08-13',
        '验收时间': null,
        '消缺方法': null,
        '第一消缺人员': null,
        '第一消缺人员_员工编号': null,
        '其他共同消缺人员': null,
        '其他共同消缺人员_员工编号': null,
      }],
    };

    const result = parseProblemListSheet(sheet);
    assert.equal(result.length, 1);
    assert.equal(result[0].severity, '严重');
    assert.equal(result[0].firstDiscoverer, '苏攀');
    assert.equal(result[0].discovererNo, '11460637');
    assert.equal(result[0].status, '待消除');
  });
});
