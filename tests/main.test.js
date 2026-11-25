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

const fakeCapture = {
  listSources: async () => [{ id: 'screen:1:0' }],
  captureScreen: async (o) => ({ mimeType: 'image/png', data: `screen-${o.displayId}` }),
  captureSource: async (id) => ({ mimeType: 'image/png', data: id }),
  captureArea: async (id, r, v) => ({ mimeType: 'image/png', data: `${id}-${r.x}-${v.width}` }),
  readClipboardImage: () => null,
};

test('registerIpc wires every allowed channel', () => {
  const ipc = fakeIpc();
  registerIpc(ipc, { config, appInfo: { name: 'MockingBird' }, capture: fakeCapture });
  for (const ch of ALLOWED_INVOKE) assert.ok(ipc.handlers.has(ch), ch);
});

test('capture channels are skipped when no capture service is supplied', () => {
  const ipc = fakeIpc();
  registerIpc(ipc, { config, appInfo: {} });
  assert.equal(ipc.handlers.has(INVOKE_CHANNELS.CAPTURE_SCREEN), false);
  assert.equal(ipc.handlers.has(INVOKE_CHANNELS.INPUT_VALIDATE), true);
});

test('capture handlers return data URLs and pass arguments through', async () => {
  const ipc = fakeIpc();
  registerIpc(ipc, { config, appInfo: {}, capture: fakeCapture });
  const h = (ch) => ipc.handlers.get(ch);
  assert.deepEqual(await h(INVOKE_CHANNELS.CAPTURE_SOURCES)(), [{ id: 'screen:1:0' }]);
  assert.equal(await h(INVOKE_CHANNELS.CAPTURE_SCREEN)({}, { displayId: 3 }), 'data:image/png;base64,screen-3');
  assert.equal(await h(INVOKE_CHANNELS.CAPTURE_SOURCE)({}, 'w1'), 'data:image/png;base64,w1');
  assert.equal(await h(INVOKE_CHANNELS.CAPTURE_AREA)({}, 'w1', { x: 4 }, { width: 9 }), 'data:image/png;base64,w1-4-9');
  assert.equal(await h(INVOKE_CHANNELS.CLIPBOARD_IMAGE)(), null);
});

test('input:validate normalizes renderer input', async () => {
  const ipc = fakeIpc();
  registerIpc(ipc, { config, appInfo: {} });
  const validate = ipc.handlers.get(INVOKE_CHANNELS.INPUT_VALIDATE);
  assert.deepEqual(await validate({}, { text: ' hi ' }), { text: 'hi', images: [] });
  assert.throws(() => validate({}, { text: '' }), /Type a question/);
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
