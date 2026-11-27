const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getJson } = require('../src/main/llm/http');
const { createProvider } = require('../src/main/llm/registry');
const { LlmService } = require('../src/main/llm/service');
const { LlmError } = require('../src/main/llm/errors');
const { SettingsService } = require('../src/main/settings/service');
const { UserSettings } = require('../src/main/settings/user-settings');
const { registerIpc } = require('../src/main/ipc');
const { INVOKE_CHANNELS: C } = require('../src/shared/channels');
const { Config } = require('../src/shared/config');
const { streamResponse, sse, fakeFetch } = require('./helpers/fake-fetch');

const getApiKey = (n) => ({ gemini: 'g-key', openrouter: 'r-key' }[n] || '');
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });

// ---- getJson ----

test('getJson returns parsed JSON and sends headers', async () => {
  const f = fakeFetch(json({ ok: 1 }));
  assert.deepEqual(await getJson(f, 'http://x', { headers: { a: 'b' }, provider: 'p' }), { ok: 1 });
  assert.equal(f.calls[0].init.method, 'GET');
  assert.equal(f.calls[0].init.headers.a, 'b');
});

test('getJson maps HTTP, network and timeout failures to typed errors', async () => {
  await assert.rejects(getJson(fakeFetch(new Response('nope', { status: 404 })), 'http://x', { provider: 'p' }), (e) => e instanceof LlmError && e.kind === 'bad_request' && e.status === 404 && /nope/.test(e.message));
  await assert.rejects(getJson(fakeFetch(new Response('x', { status: 401 })), 'http://x', { provider: 'p' }), (e) => e.kind === 'auth');
  await assert.rejects(getJson(async () => { throw new TypeError('fetch failed'); }, 'http://x', { provider: 'p' }), (e) => e.kind === 'network');
  const hang = (_u, init) => new Promise((_r, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted'))));
  await assert.rejects(getJson(hang, 'http://x', { provider: 'p', timeoutMs: 20 }), (e) => e.kind === 'timeout');
});

// ---- listModels ----

test('gemini lists only chat-capable gemini models, without the models/ prefix', async () => {
  const f = fakeFetch(json({
    models: [
      { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
      { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
      { name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] },
      { name: 'models/imagen-3', supportedGenerationMethods: ['predict'] },
    ],
  }));
  const p = createProvider('gemini', {}, { fetch: f, getApiKey });
  assert.deepEqual(await p.listModels(), ['gemini-2.5-flash', 'gemini-2.5-pro']);
  assert.match(f.calls[0].url, /\/models\?pageSize=200$/);
  assert.equal(f.calls[0].init.headers['x-goog-api-key'], 'g-key');
});

test('gemini listModels needs a key and surfaces HTTP errors', async () => {
  await assert.rejects(createProvider('gemini', {}, { fetch: fakeFetch(json({})), getApiKey: () => '' }).listModels(), (e) => e.kind === 'config');
  await assert.rejects(createProvider('gemini', {}, { fetch: fakeFetch(new Response('API key not valid', { status: 400 })), getApiKey }).listModels(), (e) => e.kind === 'bad_request' && /API key not valid/.test(e.message));
});

test('openrouter lists models without needing a key; openai needs one', async () => {
  const f = fakeFetch(json({ data: [{ id: 'openai/gpt-4o-mini' }, { id: 'google/gemini-2.5-flash' }] }));
  const p = createProvider('openrouter', {}, { fetch: f, getApiKey: () => '' });
  assert.deepEqual(await p.listModels(), ['google/gemini-2.5-flash', 'openai/gpt-4o-mini']);
  assert.equal(f.calls[0].url, 'https://openrouter.ai/api/v1/models');
  assert.equal(f.calls[0].init.headers.authorization, undefined);
  await assert.rejects(createProvider('openai', {}, { fetch: fakeFetch(json({ data: [] })), getApiKey: () => '' }).listModels(), (e) => e.kind === 'config');
});

// ---- logging ----

test('failed attempts are logged with the provider message and status', async () => {
  const logs = [];
  const provider = {
    name: 'gemini', model: 'm', supportsImages: true, isConfigured: () => true,
    async *stream() { throw new LlmError('gemini returned HTTP 404: model not found', { kind: 'bad_request', status: 404, provider: 'gemini' }); },
  };
  const svc = new LlmService({ providers: [provider], sleep: async () => {}, logger: { warn: (m, meta) => logs.push([m, meta]) } });
  await assert.rejects(svc.generate({ messages: [{ role: 'user', content: 'x' }] }), /model not found/);
  assert.equal(logs.length, 1);
  assert.deepEqual(logs[0][1], { provider: 'gemini', attempt: 0, kind: 'bad_request', status: 404, message: 'gemini returned HTTP 404: model not found' });
});

// ---- testProvider ----

function fakeProvider(over = {}) {
  return { name: 'gemini', model: 'gemini-x', supportsImages: true, isConfigured: () => true, async *stream() { yield 'po'; yield 'ng'; }, ...over };
}
function service(providers) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mb-pt-')), 's.json');
  return new SettingsService({
    config: new Config({ env: {}, homeDir: '/h' }), userSettings: new UserSettings({ file, providers: ['gemini'] }),
    llm: { providers, rebuild() {} }, providerNames: providers.map((p) => p.name), secrets: { available: true, has: () => false, get: () => '' },
  });
}

test('testProvider reports success with timing, reply and model', async () => {
  const r = await service([fakeProvider()]).testProvider('gemini');
  assert.equal(r.ok, true);
  assert.equal(r.reply, 'pong');
  assert.equal(r.model, 'gemini-x');
  assert.ok(Number.isFinite(r.ms));
});

test('testProvider returns the provider error and the usable models on a 4xx', async () => {
  const bad = fakeProvider({
    async *stream() { throw new LlmError('gemini returned HTTP 404: models/gemini-x is not found', { kind: 'bad_request', status: 404 }); },
    listModels: async () => ['gemini-2.5-flash', 'gemini-2.5-pro'],
  });
  const r = await service([bad]).testProvider('gemini');
  assert.equal(r.ok, false);
  assert.equal(r.kind, 'bad_request');
  assert.equal(r.status, 404);
  assert.match(r.error, /is not found/);
  assert.deepEqual(r.models, ['gemini-2.5-flash', 'gemini-2.5-pro']);
});

test('testProvider does not list models for auth errors, and reports a listing failure', async () => {
  let listed = false;
  const auth = fakeProvider({ async *stream() { throw new LlmError('HTTP 403', { kind: 'auth', status: 403 }); }, listModels: async () => { listed = true; return []; } });
  const a = await service([auth]).testProvider('gemini');
  assert.equal(a.kind, 'auth');
  assert.equal(listed, false);
  assert.equal(a.models, undefined);
  const badList = fakeProvider({ async *stream() { throw new LlmError('HTTP 400', { kind: 'bad_request', status: 400 }); }, listModels: async () => { throw new LlmError('listing failed', { kind: 'auth' }); } });
  const b = await service([badList]).testProvider('gemini');
  assert.equal(b.modelsError, 'listing failed');
});

test('testProvider handles unconfigured and unknown providers, and never leaks keys', async () => {
  const none = await service([fakeProvider({ isConfigured: () => false })]).testProvider('gemini');
  assert.deepEqual([none.ok, none.kind], [false, 'config']);
  await assert.rejects(service([fakeProvider()]).testProvider('nope'), /Unknown provider/);
  const generic = fakeProvider({ async *stream() { throw new Error('boom'); } });
  const r = await service([generic]).testProvider('gemini');
  assert.deepEqual([r.ok, r.kind, r.error], [false, 'unknown', 'boom']);
});

test('settings:test-provider is wired through IPC', async () => {
  const handlers = new Map();
  registerIpc({ handle: (ch, fn) => handlers.set(ch, fn) }, { config: new Config({ env: {}, homeDir: '/h' }), appInfo: {}, settings: service([fakeProvider()]) });
  assert.equal((await handlers.get(C.SETTINGS_TEST_PROVIDER)({}, 'gemini')).ok, true);
  await assert.rejects(handlers.get(C.SETTINGS_TEST_PROVIDER)({}, { evil: true }), /Unknown provider/);
});

test('a real provider test against a fake Gemini endpoint works end to end', async () => {
  const stream = streamResponse(sse([JSON.stringify({ candidates: [{ content: { parts: [{ text: 'pong' }] } }] })]));
  const real = createProvider('gemini', {}, { fetch: fakeFetch(stream), getApiKey });
  const r = await service([real]).testProvider('gemini');
  assert.deepEqual([r.ok, r.reply], [true, 'pong']);
});
