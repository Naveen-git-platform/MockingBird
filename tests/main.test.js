const test = require('node:test');
const assert = require('node:assert/strict');
const { Config } = require('../src/shared/config');
const { buildWindowOptions } = require('../src/main/window-options');
const { registerIpc } = require('../src/main/ipc');
const { INVOKE_CHANNELS, ALLOWED_INVOKE } = require('../src/shared/channels');

const config = new Config({ env: {}, homeDir: '/h' });

test('window options use hardened web preferences', () => {
  const opts = buildWindowOptions(config, { preloadPath: '/p.js' });
  assert.equal(opts.webPreferences.contextIsolation, true);
  assert.equal(opts.webPreferences.nodeIntegration, false);
  assert.equal(opts.webPreferences.sandbox, true);
  assert.equal(opts.webPreferences.preload, '/p.js');
  assert.equal(opts.show, false);
  assert.equal(opts.title, 'MockingBird');
});

test('window options never enable stealth flags', () => {
  const opts = buildWindowOptions(config);
  for (const key of ['skipTaskbar', 'alwaysOnTop', 'transparent']) {
    assert.equal(opts[key], undefined, key);
  }
});

function fakeIpc() {
  const handlers = new Map();
  return { handlers, handle: (ch, fn) => handlers.set(ch, fn) };
}

test('registerIpc wires every allowed channel', () => {
  const ipc = fakeIpc();
  registerIpc(ipc, { config, appInfo: { name: 'MockingBird' } });
  for (const ch of ALLOWED_INVOKE) assert.ok(ipc.handlers.has(ch), ch);
});

test('app:info returns a copy of app info', async () => {
  const ipc = fakeIpc();
  const appInfo = { name: 'MockingBird', version: '0.1.0' };
  registerIpc(ipc, { config, appInfo });
  const result = await ipc.handlers.get(INVOKE_CHANNELS.APP_INFO)();
  assert.deepEqual(result, appInfo);
  assert.notEqual(result, appInfo);
});

test('config:get returns a value for a path and the full config without one', async () => {
  const ipc = fakeIpc();
  registerIpc(ipc, { config, appInfo: {} });
  const get = ipc.handlers.get(INVOKE_CHANNELS.CONFIG_GET);
  assert.equal(await get({}, 'window.width'), 980);
  assert.equal((await get({})).app.name, 'MockingBird');
  assert.equal((await get({}, 42)).app.name, 'MockingBird');
});
