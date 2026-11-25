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
  ipc.on = () => {};
  registerIpc(ipc, { config, appInfo: { name: 'MockingBird' }, capture: fakeCapture, voice: { state: 'idle', mode: 'vad' }, interview: {} });
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

// ---- voice IPC ----
const { bindVoiceEvents } = require('../src/main/ipc');
const { EventEmitter } = require('node:events');
const { SEND_CHANNELS, EVENT_CHANNELS, ALLOWED_SEND, ALLOWED_EVENTS } = require('../src/shared/channels');

function fakeIpcWithOn() {
  const ipc = fakeIpc();
  ipc.listeners = new Map();
  ipc.on = (ch, fn) => ipc.listeners.set(ch, fn);
  return ipc;
}

test('voice handlers drive the controller and forward frames as Buffers', async () => {
  const frames = [];
  const voice = { state: 'idle', mode: 'vad', start(o) { this.state = 'listening'; this.mode = o.mode || 'vad'; }, async stop() { this.state = 'idle'; }, pushFrame: (b) => frames.push(b) };
  const ipc = fakeIpcWithOn();
  registerIpc(ipc, { config, appInfo: {}, voice });
  assert.deepEqual(await ipc.handlers.get(INVOKE_CHANNELS.VOICE_START)({}, { mode: 'manual' }), { state: 'listening', mode: 'manual' });
  assert.deepEqual(await ipc.handlers.get(INVOKE_CHANNELS.VOICE_STATUS)(), { state: 'listening', mode: 'manual' });
  assert.deepEqual(await ipc.handlers.get(INVOKE_CHANNELS.VOICE_STOP)(), { state: 'idle', mode: 'manual' });
  const frame = ipc.listeners.get(SEND_CHANNELS.VOICE_FRAME);
  frame({}, new Int16Array([1, 2]).buffer);
  frame({}, new Uint8Array([9, 8, 7]));
  frame({}, 'junk');
  assert.equal(frames.length, 2);
  assert.equal(frames[0].length, 4);
  assert.equal(frames[1].length, 3);
});

test('bindVoiceEvents forwards events to live windows only', () => {
  const sent = [];
  const win = (destroyed) => ({ isDestroyed: () => destroyed, webContents: { send: (ch, p) => sent.push([ch, p]) } });
  const voice = new EventEmitter();
  bindVoiceEvents(voice, () => [win(false), win(true)]);
  voice.emit('transcript', { text: 'hi' });
  voice.emit('status', { state: 'listening' });
  voice.emit('error', new Error('boom'));
  assert.deepEqual(sent, [
    [EVENT_CHANNELS.VOICE_TRANSCRIPT, { text: 'hi' }],
    [EVENT_CHANNELS.VOICE_STATUS, { state: 'listening' }],
    [EVENT_CHANNELS.VOICE_ERROR, { message: 'boom' }],
  ]);
});

test('send and event allowlists contain exactly the declared channels', () => {
  assert.deepEqual([...ALLOWED_SEND], ['voice:frame']);
  assert.deepEqual([...ALLOWED_EVENTS].sort(), ['interview:delta', 'voice:error', 'voice:status', 'voice:transcript']);
});

// ---- interview IPC ----
test('interview IPC streams deltas to the caller and validates answers', async () => {
  const sent = [];
  const event = { sender: { isDestroyed: () => false, send: (ch, p) => sent.push([ch, p]) } };
  const calls = [];
  const interview = {
    start: async (opts, hooks) => { hooks.onDelta('Q'); calls.push(['start', opts]); return { status: 'awaiting_answer' }; },
    answer: async (input) => { calls.push(['answer', input]); return { evaluation: { score: 1 } }; },
    hint: async (hooks) => { hooks.onDelta('H'); return { hint: { level: 1 } }; },
    skip: () => ({ status: 'evaluated' }),
    next: async (hooks) => { hooks.onDelta('N'); return { status: 'awaiting_answer' }; },
    finish: async () => ({ status: 'finished' }),
    state: () => null,
    discard: () => calls.push(['discard']),
  };
  const ipc = fakeIpc();
  registerIpc(ipc, { config, appInfo: {}, interview, interviewOptions: () => ({ modes: [] }) });
  const h = (ch) => ipc.handlers.get(ch);
  assert.deepEqual(await h(INVOKE_CHANNELS.INTERVIEW_OPTIONS)(), { modes: [] });
  await h(INVOKE_CHANNELS.INTERVIEW_START)(event, { mode: 'sql' });
  await h(INVOKE_CHANNELS.INTERVIEW_START)(event, 'junk');
  await h(INVOKE_CHANNELS.INTERVIEW_HINT)(event);
  await h(INVOKE_CHANNELS.INTERVIEW_NEXT)(event);
  assert.deepEqual(sent.map(([, p]) => `${p.kind}:${p.text}`), ['question:Q', 'question:Q', 'hint:H', 'question:N']);
  assert.equal(sent[0][0], EVENT_CHANNELS.INTERVIEW_DELTA);
  assert.deepEqual(calls[0], ['start', { mode: 'sql' }]);
  assert.deepEqual(calls[1], ['start', {}]);
  await h(INVOKE_CHANNELS.INTERVIEW_ANSWER)(event, { text: ' my answer ' });
  assert.deepEqual(calls[2], ['answer', { text: 'my answer', images: [] }]);
  assert.throws(() => h(INVOKE_CHANNELS.INTERVIEW_ANSWER)(event, { text: '' }), /Type a question|Type or attach/);
  assert.deepEqual(h(INVOKE_CHANNELS.INTERVIEW_SKIP)(), { status: 'evaluated' });
  assert.deepEqual(await h(INVOKE_CHANNELS.INTERVIEW_FINISH)(), { status: 'finished' });
  assert.equal(h(INVOKE_CHANNELS.INTERVIEW_STATE)(), null);
  assert.equal(h(INVOKE_CHANNELS.INTERVIEW_DISCARD)(), null);
  assert.deepEqual(calls.at(-1), ['discard']);
});

test('interview deltas are not sent to a destroyed window', async () => {
  const sent = [];
  const event = { sender: { isDestroyed: () => true, send: (...a) => sent.push(a) } };
  const interview = { start: async (_o, hooks) => hooks.onDelta('x'), state: () => null };
  const ipc = fakeIpc();
  registerIpc(ipc, { config, appInfo: {}, interview });
  await ipc.handlers.get(INVOKE_CHANNELS.INTERVIEW_START)(event, {});
  assert.deepEqual(sent, []);
});
