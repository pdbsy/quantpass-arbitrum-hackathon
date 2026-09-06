import test from 'node:test';
import assert from 'node:assert/strict';
import { commandMessage } from '../apps/web/src/command-message.ts';

test('stop acknowledgement never claims completion while positions or orders remain', () => {
  const message = commandMessage({
    type: 'stop',
    label: '停止',
    status: 'stopping',
    revision: 11,
    replayed: false,
  });
  assert.match(message, /停止请求已受理/);
  assert.match(message, /等待挂单处理或持仓结算/);
  assert.doesNotMatch(message, /停止成功/);
  assert.equal(
    commandMessage({ type: 'stop', label: '停止', status: 'stopped', revision: 12, replayed: false }),
    '停止成功；账本版本 12。',
  );
});
test('replayed command reports readback instead of a new operation', () => {
  assert.match(
    commandMessage({ type: 'deposit', label: '模拟存入', status: 'stopped', revision: 13, replayed: true }),
    /没有重复记账/,
  );
});
