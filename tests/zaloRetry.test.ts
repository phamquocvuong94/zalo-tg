import test from 'node:test';
import assert from 'node:assert/strict';
import { zaloApiWithRetry } from '../src/utils/zaloRetry.js';

test('zaloApiWithRetry keeps synchronous methods synchronous', () => {
  const api = zaloApiWithRetry({ getOwnId: () => '123456', ownProp: 7 });
  assert.equal(api.getOwnId(), '123456');
  assert.equal(String(api.getOwnId?.() ?? ''), '123456');
  assert.equal(api.ownProp, 7);
});

test('zaloApiWithRetry still retries async methods on transient errors', async () => {
  let calls = 0;
  const api = zaloApiWithRetry({
    async sendMessage() {
      calls++;
      if (calls === 1) throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
      return { ok: true };
    },
  });
  assert.deepEqual(await api.sendMessage(), { ok: true });
  assert.equal(calls, 2);
});

test('zaloApiWithRetry turns synchronous throws into rejections', async () => {
  const api = zaloApiWithRetry({ bad() { throw new Error('boom'); } });
  await assert.rejects(() => api.bad(), /boom/);
});
