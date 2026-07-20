import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hashPassword, verifyEmployeePassword } from './password';

describe('verifyEmployeePassword', () => {
  it('空密码哈希时只接受工号作为初始密码', async () => {
    assert.equal(await verifyEmployeePassword('00123', '00123', ''), true);
    assert.equal(await verifyEmployeePassword('00123', 'wrong', ''), false);
  });

  it('已有密码哈希时只校验用户设置的密码', async () => {
    const hash = await hashPassword('Changed#123');
    assert.equal(await verifyEmployeePassword('00123', 'Changed#123', hash), true);
    assert.equal(await verifyEmployeePassword('00123', '00123', hash), false);
  });
});
