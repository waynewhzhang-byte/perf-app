import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ticketSpecialtyFromWorkArea } from './ticket-specialty';

describe('ticketSpecialtyFromWorkArea', () => {
  it('将同一专业的工区归并到预定义专业', () => {
    assert.equal(ticketSpecialtyFromWorkArea('变电检修中心'), '专业1');
    assert.equal(ticketSpecialtyFromWorkArea('设备状态测试中心'), '专业1');
    assert.equal(ticketSpecialtyFromWorkArea('晋中运维分部'), '专业2');
    assert.equal(ticketSpecialtyFromWorkArea('特高压大同站'), '专业3');
    assert.equal(ticketSpecialtyFromWorkArea('二次检修中心'), '专业4');
    assert.equal(ticketSpecialtyFromWorkArea('特高压雁门关换流站'), '专业5');
    assert.equal(ticketSpecialtyFromWorkArea('智能运检管控中心'), '专业6');
  });

  it('不将未配置工区与其他工区混算', () => {
    assert.equal(ticketSpecialtyFromWorkArea('未知工区'), '未配置工区：未知工区');
    assert.equal(ticketSpecialtyFromWorkArea(null), '未配置工区');
  });
});
