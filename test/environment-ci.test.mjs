import assert from 'node:assert/strict';
import test from 'node:test';
import { verify } from '../tools/verify-ci.mjs';

test('CI wrapper runs fixed full gate and rejects failures or changed source inputs', () => {
  const good = { exitCode: 0, head: 'a', tree: 'b', lockSha256: 'c' };
  let calls = [];
  assert.equal(
    verify({
      inspect: () => good,
      run: () => {
        calls.push('check');
        return 7;
      },
      emit: () => {},
    }),
    7,
  );
  assert.deepEqual(calls, ['check']);
  calls = [];
  assert.equal(
    verify({
      inspect: () => ({ ...good, exitCode: 2 }),
      run: () => {
        calls.push('check');
        return 0;
      },
      emit: () => {},
    }),
    2,
  );
  assert.deepEqual(calls, []);
  let n = 0;
  assert.equal(
    verify({ inspect: () => (n++ ? { ...good, tree: 'changed' } : good), run: () => 0, emit: () => {} }),
    1,
  );
  assert.equal(verify({ inspect: () => good, run: () => 0, emit: () => {} }), 0);
});
