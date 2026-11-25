import test from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { redactSecrets, redactLogArg } from '../src/utils/redact.js';

const TOKEN = '1234567890:ABCDEFabcdef1234567890abcdefABCDEF123';

test('redactSecrets strips bot tokens from Telegram URLs', () => {
  assert.equal(
    redactSecrets(`https://api.telegram.org/file/bot${TOKEN}/photos/x.jpg`),
    'https://api.telegram.org/file/bot<redacted>/photos/x.jpg',
  );
});

test('redactLogArg keeps token-free values untouched (same reference)', () => {
  const err = new Error('boom');
  const obj = { a: 1 };
  assert.equal(redactLogArg(err), err);
  assert.equal(redactLogArg(obj), obj);
  assert.equal(redactLogArg(42), 42);
});

test('redactLogArg returns a redacted Error copy when the error carries a token', () => {
  const err = Object.assign(new Error('request failed'), {
    config: { url: `https://api.telegram.org/file/bot${TOKEN}/doc.pdf` },
    code: 'ECONNRESET',
  });
  const out = redactLogArg(err);
  assert.ok(out instanceof Error);
  assert.equal((out as Error).message, 'request failed');
  assert.equal((out as Error & { code?: string }).code, 'ECONNRESET');
  assert.ok(!inspect(out, { depth: 6 }).includes(TOKEN));
});
