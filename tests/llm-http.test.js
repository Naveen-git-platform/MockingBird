const test = require('node:test');
const assert = require('node:assert/strict');
const { postJson, parseSSE, parseNDJSON } = require('../src/main/llm/http');
const { LlmError, kindFromStatus } = require('../src/main/llm/errors');
const { streamResponse, fakeFetch } = require('./helpers/fake-fetch');

async function gather(gen) {
  const out = [];
  for await (const x of gen) out.push(x);
  return out;
}

test('parseSSE handles events split across chunks and CRLF', async () => {
  const body = streamResponse(['data: {"a"', ':1}\r\n\r\nevent: ping\ndata: x\n', '\ndata: tail']).body;
  const events = await gather(parseSSE(body));
  assert.deepEqual(events, [
    { event: null, data: '{"a":1}' },
    { event: 'ping', data: 'x' },
    { event: null, data: 'tail' },
  ]);
});

test('parseSSE skips comments and joins multi-line data', async () => {
  const body = streamResponse([': keepalive\ndata: a\ndata: b\n\n']).body;
  assert.deepEqual(await gather(parseSSE(body)), [{ event: null, data: 'a\nb' }]);
});

test('parseNDJSON parses each line and ignores blanks', async () => {
  const body = streamResponse(['{"n":1}\n\n{"n":', '2}\n']).body;
  assert.deepEqual(await gather(parseNDJSON(body)), [{ n: 1 }, { n: 2 }]);
});

test('kindFromStatus maps http codes', () => {
  assert.equal(kindFromStatus(401), 'auth');
  assert.equal(kindFromStatus(403), 'auth');
  assert.equal(kindFromStatus(429), 'rate_limit');
  assert.equal(kindFromStatus(503), 'server');
  assert.equal(kindFromStatus(400), 'bad_request');
});

test('LlmError retryable flag follows kind', () => {
  assert.equal(new LlmError('x', { kind: 'rate_limit' }).retryable, true);
  assert.equal(new LlmError('x', { kind: 'auth' }).retryable, false);
  assert.equal(new LlmError('x', { kind: 'config' }).retryable, false);
});

test('postJson turns HTTP errors into typed LlmErrors', async () => {
  const f = fakeFetch(new Response('nope', { status: 429 }));
  await assert.rejects(
    postJson(f, 'http://x', { body: {}, provider: 'p' }),
    (e) => e instanceof LlmError && e.kind === 'rate_limit' && e.status === 429 && e.retryable
  );
});

test('postJson maps network failures', async () => {
  const f = async () => {
    throw new TypeError('fetch failed');
  };
  await assert.rejects(postJson(f, 'http://x', { body: {}, provider: 'p' }), (e) => e.kind === 'network');
});

test('postJson times out waiting for headers', async () => {
  const f = (_url, init) =>
    new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted'))));
  await assert.rejects(postJson(f, 'http://x', { body: {}, provider: 'p', timeoutMs: 20 }), (e) => e.kind === 'timeout');
});

test('postJson reports an external abort as aborted, not retryable', async () => {
  const ctrl = new AbortController();
  const f = (_url, init) =>
    new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted'))));
  const p = postJson(f, 'http://x', { body: {}, provider: 'p', signal: ctrl.signal, timeoutMs: 5000 });
  ctrl.abort();
  await assert.rejects(p, (e) => e.kind === 'aborted' && !e.retryable);
});
