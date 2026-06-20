import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyUnmatchedNames, createRosterResolverFromUsers } from './roster-resolver';

describe('roster-resolver', () => {
  const users = [
    { employeeNo: '001', fullName: '张三' },
    { employeeNo: '002', fullName: '李四' },
    { employeeNo: '003', fullName: '张三' },
  ];

  it('重名无法 resolve', () => {
    const r = createRosterResolverFromUsers(users);
    assert.equal(r.resolve('张三'), null);
    assert.ok(r.ambiguousNameKeys.has('张三'));
    assert.equal(r.resolve('李四')?.employeeNo, '002');
  });

  it('未匹配中仅名册重名进入 inRoster', () => {
    const r = createRosterResolverFromUsers(users);
    const { inRoster, external } = classifyUnmatchedNames(
      [
        { name: '张三', source: 'tickets' },
        { name: '委外人员', source: 'tickets' },
      ],
      r,
      users,
    );
    assert.equal(inRoster.length, 1);
    assert.equal(inRoster[0].name, '张三');
    assert.equal(external.length, 1);
    assert.equal(external[0].name, '委外人员');
  });
});
