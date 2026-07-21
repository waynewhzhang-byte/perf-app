import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { passwordSchemaForPolicy, validatePasswordPolicy } from './password-policy';

describe('passwordSchemaForPolicy', () => {
  it('强密码模式校验大小写+特殊字符', () => {
    const schema = passwordSchemaForPolicy(true);
    assert.ok(schema.safeParse('Abcdef1!').success);
    assert.ok(schema.safeParse('P@ssw0rdAbc').success);
  });

  it('强密码模式拒绝纯小写', () => {
    const schema = passwordSchemaForPolicy(true);
    const r = schema.safeParse('abcdefghijk');
    assert.equal(r.success, false);
  });

  it('强密码模式拒绝纯数字', () => {
    const schema = passwordSchemaForPolicy(true);
    const r = schema.safeParse('12345678');
    assert.equal(r.success, false);
  });

  it('强密码模式拒绝少于 8 位', () => {
    const schema = passwordSchemaForPolicy(true);
    const r = schema.safeParse('Ab1!');
    assert.equal(r.success, false);
  });

  it('强密码模式拒绝超长（>128）', () => {
    const schema = passwordSchemaForPolicy(true);
    const r = schema.safeParse('A1!' + 'x'.repeat(126));
    assert.equal(r.success, false);
  });

  it('简单模式接受 8 位任意字符', () => {
    const schema = passwordSchemaForPolicy(false);
    assert.ok(schema.safeParse('12345678').success);
    assert.ok(schema.safeParse('abcdefgh').success);
  });

  it('简单模式拒绝少于 8 位', () => {
    const schema = passwordSchemaForPolicy(false);
    const r = schema.safeParse('1234567');
    assert.equal(r.success, false);
  });
});

describe('validatePasswordPolicy', () => {
  it('强密码校验通过', () => {
    const r = validatePasswordPolicy('Abcd1234!', true);
    assert.ok(r.ok);
  });

  it('缺失大写字母返回提示', () => {
    const r = validatePasswordPolicy('abcdef1!', true);
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.message);
  });

  it('缺失小写字母返回提示', () => {
    const r = validatePasswordPolicy('ABCDEF1!', true);
    assert.equal(r.ok, false);
  });

  it('缺失特殊字符返回提示', () => {
    const r = validatePasswordPolicy('Abcd1234', true);
    assert.equal(r.ok, false);
  });

  it('少于 8 位返回提示', () => {
    const r = validatePasswordPolicy('Ab1!', true);
    assert.equal(r.ok, false);
  });

  it('简单模式接受任意 8 位', () => {
    const r = validatePasswordPolicy('12345678', false);
    assert.ok(r.ok);
  });
});
