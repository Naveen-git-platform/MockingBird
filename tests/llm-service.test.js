const test = require('node:test');
const assert = require('node:assert/strict');
const { LlmService, createLlmService } = require('../src/main/llm/service');
const { LlmError } = require('../src/main/llm/errors');
const { Config } = require('../src/shared/config');

function fakeProvider(name, behaviours, { configured = true, supportsImages = true } = {}) {
  let call = 0;
  return {
    name,
    model: `${name}-model`,
    supportsImages,
    isConfigured: () => configured,
    calls: () => call,
    async *stream() {
      const b = behaviours[Math.min(call, behaviours.length - 1)];
      call += 1;
      if (b.throwBefore) throw b.throwBefore;
      for (const chunk of b.chunks || []) yield chunk;
      if (b.throwAfter) throw b.throwAfter;
    },
  };
}

const req = { messages: [{ role: 'user', content: 'hi' }] };
const noSleep = async () => {};
const mk = (providers, extra = {}) => new LlmService({ providers, sleep: noSleep, ...extra });

test('streams deltas to onDelta and returns the joined text', async () => {
  const seen = [];
  const svc = mk([fakeProvider('a', [{ chunks: ['He', 'llo'] }])]);
  const res = await svc.generate(req, { onDelta: (d) => seen.push(d) });
  assert.deepEqual(seen, ['He', 'llo']);
  assert.deepEqual(res, { text: 'Hello', provider: 'a', model: 'a-model' });
});

test('retries a retryable failure on the same provider', async () => {
  const a = fakeProvider('a', [{ throwBefore: new LlmError('429', { kind: 'rate_limit' }) }, { chunks: ['ok'] }]);
  const res = await mk([a]).generate(req);
  assert.equal(res.text, 'ok');
  assert.equal(a.calls(), 2);
});

test('backoff delays grow exponentially', async () => {
  const delays = [];
  const a = fakeProvider('a', [
    { throwBefore: new LlmError('x', { kind: 'server' }) },
    { throwBefore: new LlmError('x', { kind: 'server' }) },
    { chunks: ['ok'] },
  ]);
  await new LlmService({ providers: [a], baseDelayMs: 100, sleep: async (ms) => delays.push(ms) }).generate(req);
  assert.deepEqual(delays, [100, 200]);
});

test('non-retryable errors skip retries and fall back to the next provider', async () => {
  const a = fakeProvider('a', [{ throwBefore: new LlmError('bad key', { kind: 'auth' }) }]);
  const b = fakeProvider('b', [{ chunks: ['from b'] }]);
  const res = await mk([a, b]).generate(req);
  assert.equal(res.provider, 'b');
  assert.equal(a.calls(), 1);
});

test('exhausting retries falls back, then throws the last error if all fail', async () => {
  const a = fakeProvider('a', [{ throwBefore: new LlmError('down', { kind: 'server' }) }]);
  const b = fakeProvider('b', [{ throwBefore: new LlmError('also down', { kind: 'network' }) }]);
  await assert.rejects(mk([a, b], { maxRetries: 1 }).generate(req), /also down/);
  assert.equal(a.calls(), 2);
  assert.equal(b.calls(), 2);
});

test('does not retry or fall back after partial output (no duplicated text)', async () => {
  const seen = [];
  const a = fakeProvider('a', [{ chunks: ['par'], throwAfter: new LlmError('cut', { kind: 'network' }) }]);
  const b = fakeProvider('b', [{ chunks: ['whole'] }]);
  await assert.rejects(mk([a, b]).generate(req, { onDelta: (d) => seen.push(d) }), /cut/);
  assert.deepEqual(seen, ['par']);
  assert.equal(b.calls(), 0);
});

test('aborted requests stop immediately', async () => {
  const a = fakeProvider('a', [{ throwBefore: new LlmError('stop', { kind: 'aborted' }) }]);
  const b = fakeProvider('b', [{ chunks: ['x'] }]);
  await assert.rejects(mk([a, b]).generate(req), (e) => e.kind === 'aborted');
  assert.equal(b.calls(), 0);
});

test('unconfigured providers are skipped; all unconfigured gives a config error', async () => {
  const a = fakeProvider('a', [{ chunks: ['no'] }], { configured: false });
  const b = fakeProvider('b', [{ chunks: ['yes'] }]);
  assert.equal((await mk([a, b]).generate(req)).provider, 'b');
  await assert.rejects(mk([a]).generate(req), (e) => e.kind === 'config');
  assert.equal(a.calls(), 0);
});

test('image requests only go to providers that support images', async () => {
  const text = fakeProvider('text', [{ chunks: ['t'] }], { supportsImages: false });
  const vision = fakeProvider('vision', [{ chunks: ['v'] }]);
  const imgReq = { messages: [{ role: 'user', content: [{ type: 'image', mimeType: 'image/png', data: 'x' }] }] };
  assert.equal((await mk([text, vision]).generate(imgReq)).provider, 'vision');
  await assert.rejects(mk([text]).generate(imgReq), /read images/);
});

test('plain errors from a provider are wrapped as unknown LlmErrors', async () => {
  const a = fakeProvider('a', [{ throwBefore: new Error('weird') }]);
  await assert.rejects(mk([a]).generate(req), (e) => e instanceof LlmError && e.kind === 'unknown');
});

test('constructor requires at least one provider', () => {
  assert.throws(() => new LlmService({ providers: [] }), /at least one/);
});

test('createLlmService builds the chain from config', () => {
  const made = [];
  const config = new Config({ env: {}, homeDir: '/h', overrides: { llm: { chain: ['ollama', 'openai'] } } });
  const svc = createLlmService(config, {
    createProvider: (name, settings) => {
      made.push([name, settings.model]);
      return fakeProvider(name, [{ chunks: [] }]);
    },
  });
  assert.deepEqual(made, [['ollama', 'llama3.2'], ['openai', 'gpt-4o-mini']]);
  assert.deepEqual(svc.describe().map((d) => d.name), ['ollama', 'openai']);
});
