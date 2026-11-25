const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SecretStore } = require('../src/main/settings/secrets');
const { UserSettings } = require('../src/main/settings/user-settings');
const { makeKeyResolver, keySource, KEY_PROVIDERS } = require('../src/main/settings/keys');
const { SettingsService } = require('../src/main/settings/service');
const { hardenWebContents } = require('../src/main/security');
const { resolveWorkerScript } = require('../src/main/voice/python-env');
const { createLlmService } = require('../src/main/llm/service');
const { createProvider, listProviderNames } = require('../src/main/llm/registry');
const { registerIpc } = require('../src/main/ipc');
const { INVOKE_CHANNELS: C } = require('../src/shared/channels');
const { Config } = require('../src/shared/config');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mb-set-'));

/** Reversible fake: not real encryption, but proves nothing plain-text is stored. */
function fakeSafeStorage({ available = true } = {}) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (s) => Buffer.from(`ENC:${Buffer.from(s).reverse().toString('hex')}`),
    decryptString: (b) => {
      const t = b.toString();
      if (!t.startsWith('ENC:')) throw new Error('bad ciphertext');
      return Buffer.from(Buffer.from(t.slice(4), 'hex').reverse()).toString();
    },
  };
}
const store = (opts) => new SecretStore({ file: path.join(tmp(), 'secrets.json'), safeStorage: fakeSafeStorage(opts) });

// ---- secrets ----

test('secrets round-trip and never touch disk in plain text', () => {
  const s = store();
  s.set('openai', '  sk-test-1234567890  ');
  assert.equal(s.get('openai'), 'sk-test-1234567890');
  assert.equal(s.has('openai'), true);
  const raw = fs.readFileSync(s.file, 'utf8');
  assert.ok(!raw.includes('sk-test-1234567890'));
  assert.ok(!raw.includes(Buffer.from('sk-test-1234567890').toString('hex')));
});

test('secrets refuse to save when secure storage is unavailable', () => {
  const s = store({ available: false });
  assert.equal(s.available, false);
  assert.throws(() => s.set('openai', 'sk-x'), /Secure storage is not available/);
  assert.equal(fs.existsSync(s.file), false);
  assert.equal(s.get('openai'), '');
});

test('secrets validate names and values', () => {
  const s = store();
  for (const bad of ['', 'A', '../x', 'a b', null, 'x'.repeat(40)]) assert.throws(() => s.set(bad, 'k'), /Invalid secret name/, String(bad));
  assert.throws(() => s.get('../x'), /Invalid secret name/);
  assert.throws(() => s.set('openai', '   '), /cannot be empty/);
  assert.throws(() => s.set('openai', 12), /cannot be empty/);
  assert.throws(() => s.set('openai', 'two words'), /spaces/);
  assert.throws(() => s.set('openai', 'k'.repeat(600)), /too long/);
});

test('secrets delete, missing values and corrupt files are handled', () => {
  const s = store();
  assert.equal(s.get('gemini'), '');
  assert.equal(s.has('gemini'), false);
  assert.equal(s.delete('gemini'), false);
  s.set('gemini', 'g-key');
  assert.equal(s.delete('gemini'), true);
  assert.equal(s.has('gemini'), false);
  fs.writeFileSync(s.file, '{broken');
  assert.equal(s.get('gemini'), '');
  s.set('gemini', 'again');
  assert.equal(s.get('gemini'), 'again');
  fs.writeFileSync(s.file, JSON.stringify({ gemini: Buffer.from('garbage').toString('base64') }));
  assert.equal(s.get('gemini'), '');
});

test('secret files leave no temp files behind', () => {
  const s = store();
  s.set('openai', 'k');
  assert.deepEqual(fs.readdirSync(path.dirname(s.file)).filter((f) => f.endsWith('.tmp')), []);
});

// ---- key resolver ----

test('key resolver prefers stored keys, falls back to env, and ignores unknown providers', () => {
  const s = store();
  const env = { OPENAI_API_KEY: 'env-openai', GEMINI_API_KEY: 'env-gemini' };
  const get = makeKeyResolver({ secrets: s, env });
  assert.equal(get('openai'), 'env-openai');
  s.set('openai', 'stored-openai');
  assert.equal(get('openai'), 'stored-openai');
  assert.equal(get('gemini'), 'env-gemini');
  assert.equal(get('anthropic'), '');
  assert.equal(get('ollama'), '');
  assert.equal(get('../evil'), '');
  assert.deepEqual(KEY_PROVIDERS, ['gemini', 'openai', 'anthropic']);
});

test('key resolver survives a failing secret store', () => {
  const get = makeKeyResolver({ secrets: { get: () => { throw new Error('boom'); } }, env: { GEMINI_API_KEY: 'e' } });
  assert.equal(get('gemini'), 'e');
});

test('keySource reports stored, env or none without exposing keys', () => {
  const s = store();
  assert.equal(keySource('openai', { secrets: s, env: {} }), null);
  assert.equal(keySource('openai', { secrets: s, env: { OPENAI_API_KEY: 'x' } }), 'env');
  s.set('openai', 'k');
  assert.equal(keySource('openai', { secrets: s, env: { OPENAI_API_KEY: 'x' } }), 'stored');
  assert.equal(keySource('ollama', { secrets: s, env: {} }), null);
});

// ---- user settings ----

test('user settings persist allowlisted values and produce nested overrides', () => {
  const file = path.join(tmp(), 'settings.json');
  const u = new UserSettings({ file, providers: ['gemini', 'openai'] });
  assert.deepEqual(u.overrides(), {});
  u.set('llm.primary', 'openai');
  u.set('llm.providers.openai.model', 'gpt-4.1-mini');
  assert.deepEqual(u.overrides(), { llm: { primary: 'openai', providers: { openai: { model: 'gpt-4.1-mini' } } } });
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8'))['llm.primary'], 'openai');
});

test('user settings reject unknown keys and bad values, and ignore tampered files', () => {
  const file = path.join(tmp(), 'settings.json');
  const u = new UserSettings({ file, providers: ['gemini'] });
  assert.throws(() => u.set('app.dataDir', '/etc'), /not allowed/);
  assert.throws(() => u.set('llm.primary', 'nope'), /Invalid value/);
  assert.throws(() => u.set('llm.providers.openai.model', 'bad model!'), /Invalid value/);
  assert.throws(() => u.set('llm.providers.ollama.baseUrl', 'file:///etc/passwd'), /Invalid value/);
  fs.writeFileSync(file, JSON.stringify({ 'llm.primary': 'evil', 'app.dataDir': '/x', 'llm.providers.openai.model': 42 }));
  assert.deepEqual(u.overrides(), {});
  fs.writeFileSync(file, 'not json');
  assert.deepEqual(u.overrides(), {});
  fs.writeFileSync(file, '[1,2]');
  assert.deepEqual(u.load(), {});
});

// ---- llm ordering ----

const fakeCreate = (name) => ({ name, model: `${name}-m`, supportsImages: true, isConfigured: () => true, async *stream() {} });

test('llm chain starts with the primary provider then the others', () => {
  const config = new Config({ env: {}, homeDir: '/h', overrides: { llm: { primary: 'anthropic' } } });
  const svc = createLlmService(config, { createProvider: fakeCreate, providerNames: ['gemini', 'openai', 'anthropic', 'ollama'] });
  assert.deepEqual(svc.providers.map((p) => p.name), ['anthropic', 'gemini', 'openai', 'ollama']);
});

test('rebuild applies a changed primary and passes getApiKey to providers', () => {
  const seen = [];
  const config = new Config({ env: {}, homeDir: '/h' });
  const getApiKey = () => 'k';
  const svc = createLlmService(config, { createProvider: (n, s, deps) => (seen.push(deps.getApiKey), fakeCreate(n)), getApiKey, providerNames: ['gemini', 'openai'] });
  assert.equal(svc.providers[0].name, 'gemini');
  config.set('llm.primary', 'openai');
  svc.rebuild();
  assert.deepEqual(svc.providers.map((p) => p.name), ['openai', 'gemini']);
  assert.ok(seen.every((f) => f === getApiKey));
});

test('an explicit chain still wins over primary', () => {
  const config = new Config({ env: {}, homeDir: '/h', overrides: { llm: { chain: ['ollama'] } } });
  assert.deepEqual(createLlmService(config, { createProvider: fakeCreate }).providers.map((p) => p.name), ['ollama']);
});

test('real providers pick up a key saved after startup', async () => {
  const s = store();
  const config = new Config({ env: {}, homeDir: '/h' });
  const svc = createLlmService(config, { createProvider, getApiKey: makeKeyResolver({ secrets: s, env: {} }), providerNames: listProviderNames() });
  assert.equal(svc.describe().find((p) => p.name === 'openai').configured, false);
  s.set('openai', 'sk-late');
  assert.equal(svc.describe().find((p) => p.name === 'openai').configured, true);
});

// ---- settings service + IPC ----

function settingsHarness(env = {}) {
  const secrets = store();
  const config = new Config({ env: {}, homeDir: '/h' });
  const userSettings = new UserSettings({ file: path.join(tmp(), 's.json'), providers: listProviderNames() });
  let rebuilt = 0;
  const llm = { rebuild: () => { rebuilt += 1; } };
  const svc = new SettingsService({ config, secrets, userSettings, llm, providerNames: listProviderNames(), env });
  return { svc, secrets, config, userSettings, rebuilds: () => rebuilt };
}

test('settings.get reports key status without exposing keys', () => {
  const { svc } = settingsHarness({ GEMINI_API_KEY: 'env-secret-value' });
  const out = svc.get();
  assert.equal(out.primary, 'gemini');
  assert.equal(out.secureStorage, true);
  const gemini = out.providers.find((p) => p.name === 'gemini');
  assert.deepEqual([gemini.needsKey, gemini.keySource, gemini.configured], [true, 'env', true]);
  assert.deepEqual([out.providers.find((p) => p.name === 'openai').configured], [false]);
  const ollama = out.providers.find((p) => p.name === 'ollama');
  assert.deepEqual([ollama.needsKey, ollama.configured], [false, true]);
  assert.ok(!JSON.stringify(out).includes('env-secret-value'));
});

test('settings set/delete key and reject providers without keys', () => {
  const { svc, secrets } = settingsHarness();
  const after = svc.setKey('openai', 'sk-abc');
  assert.equal(after.providers.find((p) => p.name === 'openai').keySource, 'stored');
  assert.ok(!JSON.stringify(after).includes('sk-abc'));
  assert.equal(secrets.get('openai'), 'sk-abc');
  assert.equal(svc.deleteKey('openai').providers.find((p) => p.name === 'openai').configured, false);
  assert.throws(() => svc.setKey('ollama', 'x'), /does not use an API key/);
  assert.throws(() => svc.deleteKey('bogus'), /does not use an API key/);
});

test('settings.setSetting persists, applies live and rebuilds providers', () => {
  const h = settingsHarness();
  const out = h.svc.setSetting('llm.primary', 'ollama');
  assert.equal(out.primary, 'ollama');
  assert.equal(h.config.get('llm.primary'), 'ollama');
  assert.equal(h.rebuilds(), 1);
  assert.equal(h.userSettings.load()['llm.primary'], 'ollama');
  assert.throws(() => h.svc.setSetting('app.dataDir', '/x'), /not allowed/);
  assert.equal(h.rebuilds(), 1);
});

test('settings IPC handlers delegate to the service', async () => {
  const h = settingsHarness();
  const handlers = new Map();
  registerIpc({ handle: (ch, fn) => handlers.set(ch, fn) }, { config: h.config, appInfo: {}, settings: h.svc });
  const call = (ch, ...a) => handlers.get(ch)({}, ...a);
  assert.equal((await call(C.SETTINGS_GET)).primary, 'gemini');
  assert.equal((await call(C.SETTINGS_SET_KEY, 'anthropic', 'a-key')).providers.find((p) => p.name === 'anthropic').keySource, 'stored');
  assert.equal((await call(C.SETTINGS_DELETE_KEY, 'anthropic')).providers.find((p) => p.name === 'anthropic').keySource, null);
  assert.equal((await call(C.SETTINGS_SET, 'llm.primary', 'openai')).primary, 'openai');
});

// ---- hardening + packaging paths ----

function fakeWebContents() {
  const wc = { handlers: {}, on(ev, fn) { this.handlers[ev] = fn; }, setWindowOpenHandler(fn) { this.open = fn; } };
  return wc;
}

test('window.open opens only web links externally and always denies a new window', () => {
  const opened = [];
  const wc = fakeWebContents();
  hardenWebContents(wc, { shell: { openExternal: (u) => opened.push(u) } });
  for (const url of ['https://example.com', 'http://a.b', 'mailto:x@y.z', 'file:///etc/passwd', 'javascript:alert(1)', 'ftp://x']) {
    assert.deepEqual(wc.open({ url }), { action: 'deny' });
  }
  assert.deepEqual(opened, ['https://example.com', 'http://a.b', 'mailto:x@y.z']);
});

test('navigation away from the app and webviews are blocked', () => {
  const wc = fakeWebContents();
  hardenWebContents(wc, { shell: { openExternal() {} } });
  const nav = (url) => { let prevented = false; wc.handlers['will-navigate']({ preventDefault: () => { prevented = true; } }, url); return prevented; };
  assert.equal(nav('https://evil.example'), true);
  assert.equal(nav('file:///app/index.html'), false);
  let blocked = false;
  wc.handlers['will-attach-webview']({ preventDefault: () => { blocked = true; } });
  assert.equal(blocked, true);
});

test('worker script path differs between dev and packaged builds', () => {
  assert.equal(resolveWorkerScript({ isPackaged: false, resourcesPath: '/res', appRoot: '/app' }), path.join('/app', 'scripts', 'whisper_worker.py'));
  assert.equal(resolveWorkerScript({ isPackaged: true, resourcesPath: '/res', appRoot: '/app' }), path.join('/res', 'app.asar.unpacked', 'scripts', 'whisper_worker.py'));
});
