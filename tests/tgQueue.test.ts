import test from 'node:test';
import assert from 'node:assert/strict';
import { tgQueue } from '../src/utils/tgQueue.js';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('tgQueue limits concurrent Telegram calls to five and preserves all results', async () => {
  let active = 0;
  let maxActive = 0;
  let started = 0;
  const releases: Array<() => void> = [];

  const jobs = Array.from({ length: 12 }, (_, index) => tgQueue(async () => {
    active++;
    started++;
    maxActive = Math.max(maxActive, active);
    await new Promise<void>(resolve => releases.push(resolve));
    active--;
    return index;
  }));

  await sleep(25);
  assert.equal(maxActive, 5);
  assert.equal(releases.length, 5);

  while (started < 12) {
    const previousStarted = started;
    releases.splice(0).forEach(release => release());
    for (let i = 0; i < 20 && started === previousStarted; i++) await sleep(5);
    assert.ok(started > previousStarted, 'queued jobs should start after a slot is released');
  }
  releases.splice(0).forEach(release => release());

  assert.deepEqual(await Promise.all(jobs), Array.from({ length: 12 }, (_, index) => index));
  assert.equal(maxActive, 5);
});

test('tgQueue propagates non-rate-limit errors without retrying', async () => {
  let attempts = 0;
  const error = new Error('permanent');
  await assert.rejects(
    tgQueue(async () => {
      attempts++;
      throw error;
    }),
    error,
  );
  assert.equal(attempts, 1);
});

test('tgQueue retries Telegram 429 responses', async () => {
  let attempts = 0;
  const result = await tgQueue(async () => {
    attempts++;
    if (attempts === 1) {
      throw { response: { error_code: 429, parameters: { retry_after: 0 } } };
    }
    return 'ok';
  });
  assert.equal(result, 'ok');
  assert.equal(attempts, 2);
});

test('tgQueue retries transient network errors (socket hang up) then succeeds', async () => {
  let attempts = 0;
  const result = await tgQueue(async () => {
    attempts++;
    if (attempts === 1) {
      throw new Error('request to https://api.telegram.org/bot/sendPhoto failed, reason: socket hang up');
    }
    return 'ok';
  });
  assert.equal(result, 'ok');
  assert.equal(attempts, 2);
});

test('tgQueue does not transient-retry permanent Telegram errors', async () => {
  let attempts = 0;
  const err = Object.assign(new Error('400: Bad Request: message text is empty'), {
    response: { error_code: 400, description: 'Bad Request: message text is empty' },
  });
  await assert.rejects(
    tgQueue(async () => {
      attempts++;
      throw err;
    }),
    err,
  );
  assert.equal(attempts, 1);
});

test('tgQueueCall reopens consumed file streams when a call is retried', async () => {
  const { tgQueueCall } = await import('../src/utils/tgQueue.js');
  const { mkdtempSync, writeFileSync, createReadStream } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');

  const dir = mkdtempSync(path.join(tmpdir(), 'tgq-'));
  const file = path.join(dir, 'a.bin');
  writeFileSync(file, 'hello');

  const read = (s: NodeJS.ReadableStream) => new Promise<string>((resolve, reject) => {
    let data = '';
    s.on('data', c => { data += c; });
    s.on('end', () => resolve(data));
    s.on('error', reject);
  });

  const seen: string[] = [];
  let calls = 0;
  const result = await tgQueueCall(async (...args: unknown[]) => {
    const input = args[1] as { source: NodeJS.ReadableStream };
    seen.push(await read(input.source));
    if (++calls === 1) throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    return 'ok';
  }, [123, { source: createReadStream(file) }]);

  assert.equal(result, 'ok');
  assert.deepEqual(seen, ['hello', 'hello']);
});

test('refreshFileStreams keeps the byte range of the original stream', async () => {
  const { refreshFileStreams } = await import('../src/utils/tgQueue.js');
  const { mkdtempSync, writeFileSync, createReadStream } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');

  const dir = mkdtempSync(path.join(tmpdir(), 'tgq-'));
  const file = path.join(dir, 'b.bin');
  writeFileSync(file, '0123456789');

  const [fresh] = refreshFileStreams([createReadStream(file, { start: 2, end: 4 })]);
  const data = await new Promise<string>((resolve, reject) => {
    let out = '';
    fresh.on('data', c => { out += c; });
    fresh.on('end', () => resolve(out));
    fresh.on('error', reject);
  });
  assert.equal(data, '234');
});
