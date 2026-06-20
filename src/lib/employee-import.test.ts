import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildEmployeeDrafts } from './employee-import';

describe('buildEmployeeDrafts', () => {
  it('映射行 → 员工草稿（保留原始列到 profile）', () => {
    const drafts = buildEmployeeDrafts(
      {
        employeeNo: '工号', fullName: '姓名', workArea: '工区',
        department: '部门', team: '班组', position: '岗位', gender: '性别',
      },
      [
        { '工号': '001', '姓名': '张三', '工区': '晋北运维分部', '部门': '一班', '班组': '一次班', '岗位': '班长', '性别': '男', '电话': '13800' },
        { '工号': '002', '姓名': '李四', '工区': '公司总部', '部门': '', '班组': '', '岗位': '', '性别': '' },
      ],
    );
    assert.equal(drafts.length, 2);
    assert.equal(drafts[0].employeeNo, '001');
    assert.equal(drafts[0].workArea, '晋北运维分部');
    assert.equal(drafts[0].profile.电话, '13800'); // 未映射的原始列进 profile
    assert.equal(drafts[1].workArea, '公司总部');
    assert.equal(drafts[1].department, '');
  });

  it('工号或姓名缺失的行被跳过', () => {
    const drafts = buildEmployeeDrafts(
      { employeeNo: '工号', fullName: '姓名', workArea: '工区', department: '部门', team: '班组', position: '岗位', gender: '性别' },
      [
        { '工号': '', '姓名': '无名', '工区': 'X', '部门': '', '班组': '', '岗位': '', '性别': '' },
        { '工号': '003', '姓名': '', '工区': 'X', '部门': '', '班组': '', '岗位': '', '性别': '' },
      ],
    );
    assert.equal(drafts.length, 0);
  });
});
