const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { OverlayManager, buildOverlayOptions, clampOpacity } = require('../src/main/overlay');
const { AnswerSink, TARGETS } = require('../src/main/answers');
const { registerIpc } = require('../src/main/ipc');
const { INVOKE_CHANNELS: C, EVENT_CHANNELS: E } = require('../src/shared/channels');
const { Config } = require('../src/shared/config');
const { UserSettings } = require('../src/main/settings/user-settings');
const { SettingsService } = require('../src/main/settings/service');

function fakeWindow() {
  const w = new EventEmitter();
  Object.assign(w, {
    visible: false,
    destroyed: false,
    sent: [],
    calls: [],
    isDestroyed: () => w.destroyed,
    isVisible: () => w.visible,
    show: () => { w.visible = true; w.calls.push('show'); },
    showInactive: () => { w.visible = true; w.calls.push('showInactive'); },
    hide: () => { w.visible = false; w.calls.push('hide'); },
    destroy: () => { w.destroyed = true; w.emit('closed'); },
    setAlwaysOnTop: (...a) => w.calls.push(['alwaysOnTop', ...a]),
    setOpacity: (v) => w.calls.push(['opacity', v]),
    setIgnoreMouseEvents: (...a) => w.calls.push(['ignore', ...a]),
    webContents: { send: (ch, p) => w.sent.push([ch, p]) },
  });
  return w;
}

function manager(extra = {}) {
  const created = [];
  const m = new OverlayManager({ createWindow: (opts) => { const w = fakeWindow(); w.options = opts; created.push(w); return w; }, ...extra });
  return { m, created };
}

// ---- options ----

test('overlay window is visible, always on top, and has no concealment flags', () => {
  const o = buildOverlayOptions({ opacity: 0.8, workArea: { x: 0, y: 0, width: 1920, height: 1040 } });
  assert.equal(o.alwaysOnTop, true);
  assert.equal(o.frame, false);
  assert.equal(o.opacity, 0.8);
  assert.equal(o.webPreferences.sandbox, true);
  assert.equal(o.webPreferences.contextIsolation, true);
  assert.equal(o.webPreferences.nodeIntegration, false);
  for (const key of ['skipTaskbar', 'transparent', 'focusable', 'contentProtection']) assert.equal(o[key], undefined, key);
  assert.deepEqual([o.x, o.y], [1920 - 440 - 24, 1040 - 340 - 24]);
});

test('clampOpacity keeps the overlay readable', () => {
  assert.equal(clampOpacity(0), 0.3);
  assert.equal(clampOpacity(5), 1);
  assert.equal(clampOpacity(0.6), 0.6);
  assert.equal(clampOpacity(NaN), 1);
  assert.equal(clampOpacity('x'), 1);
});

// ---- manager ----

test('window is created lazily and reused', () => {
  const { m, created } = manager();
  assert.equal(m.window, null);
  assert.equal(m.isVisible(), false);
  m.show();
  m.hide();
  m.show();
  assert.equal(created.length, 1);
  assert.deepEqual(created[0].calls.find((c) => Array.isArray(c) && c[0] === 'alwaysOnTop'), ['alwaysOnTop', true, 'floating']);
});

test('show does not steal focus unless asked', () => {
  const { m, created } = manager();
  m.show();
  assert.deepEqual(created[0].calls.filter((c) => typeof c === 'string'), ['showInactive']);
  m.hide();
  m.show({ focus: true });
  assert.ok(created[0].calls.includes('show'));
});

test('toggle flips visibility', () => {
  const { m } = manager();
  m.toggle();
  assert.equal(m.isVisible(), true);
  m.toggle();
  assert.equal(m.isVisible(), false);
});

test('closing the window hides it instead of destroying it', () => {
  const { m, created } = manager();
  m.show();
  let prevented = false;
  created[0].emit('close', { preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(m.isVisible(), false);
  assert.equal(created[0].destroyed, false);
});

test('destroy lets the window close for real and recreates it on demand', () => {
  const { m, created } = manager();
  m.show();
  m.destroy();
  assert.equal(created[0].destroyed, true);
  assert.equal(m.window, null);
  const m2 = manager().m;
  m2.show();
  m2.quitting = true;
  let prevented = false;
  m2.window.emit('close', { preventDefault: () => { prevented = true; } });
  assert.equal(prevented, false);
});

test('opacity is clamped, applied live and remembered for the next window', () => {
  const { m, created } = manager({ opacity: 0.9 });
  assert.equal(m.setOpacity(0.1), 0.3);
  assert.equal(m.opacity, 0.3);
  m.show();
  assert.equal(created[0].options.opacity, 0.3);
  m.setOpacity(0.7);
  assert.deepEqual(created[0].calls.filter((c) => Array.isArray(c) && c[0] === 'opacity').at(-1), ['opacity', 0.7]);
});

test('click-through forwards mouse moves and is switched off when the overlay hides', () => {
  const { m, created } = manager();
  m.show();
  assert.equal(m.setClickThrough(true), true);
  assert.deepEqual(created[0].calls.filter((c) => Array.isArray(c) && c[0] === 'ignore').at(-1), ['ignore', true, { forward: true }]);
  m.hide();
  assert.equal(m.clickThrough, false);
  assert.deepEqual(created[0].calls.filter((c) => Array.isArray(c) && c[0] === 'ignore').at(-1), ['ignore', false, { forward: true }]);
  assert.equal(m.setClickThrough('yes'), true);
});

test('state reports visibility, opacity and click-through, and changes are pushed to the window', () => {
  const { m, created } = manager({ opacity: 0.8 });
  m.show();
  assert.deepEqual(m.state(), { visible: true, opacity: 0.8, clickThrough: false, style: 'solid', glass: 0.35 });
  const last = created[0].sent.at(-1);
  assert.equal(last[0], E.OVERLAY_STATE_CHANGED);
  assert.deepEqual(last[1], { visible: true, opacity: 0.8, clickThrough: false, style: 'solid', glass: 0.35 });
});

test('operations before the window exists are safe', () => {
  const { m } = manager();
  assert.doesNotThrow(() => { m.hide(); m.send('x', {}); m.setOpacity(0.5); m.setClickThrough(false); m.destroy(); });
});

// ---- answer sink ----

function sinkHarness(target) {
  const chat = fakeWindow();
  const gone = fakeWindow();
  gone.destroyed = true;
  const { m, created } = manager();
  const sink = new AnswerSink({ overlay: m, getChatWindows: () => [chat, gone], getTarget: () => target });
  return { sink, chat, overlay: () => created[0], overlayManager: m };
}
const kinds = (w) => w.sent.filter(([c]) => c.startsWith('answer:')).map(([c, p]) => `${c.split(':')[1]}${p.text ? `:${p.text}` : ''}`);

test('target chat: only the chat window gets the answer and the overlay stays closed', () => {
  const h = sinkHarness('chat');
  const { routed } = h.sink.begin({ question: 'q', images: ['data:x'] });
  h.sink.delta('A');
  h.sink.end({ text: 'A' });
  assert.deepEqual(routed, { chat: true, overlay: false });
  assert.deepEqual(kinds(h.chat), ['begin', 'delta:A', 'end:A']);
  assert.equal(h.overlay(), undefined);
});

test('target overlay: the overlay opens and receives the answer, chat gets nothing', () => {
  const h = sinkHarness('overlay');
  const { routed } = h.sink.begin({ question: 'q', images: ['data:x'] });
  h.sink.delta('B');
  h.sink.end({ text: 'B' });
  assert.deepEqual(routed, { chat: false, overlay: true });
  assert.deepEqual(kinds(h.chat), []);
  assert.deepEqual(kinds(h.overlay()), ['begin', 'delta:B', 'end:B']);
  assert.equal(h.overlayManager.isVisible(), true);
  assert.deepEqual(h.overlay().sent.find(([c]) => c === 'answer:begin')[1].images, []);
});

test('target both: both receive it; images only go to chat', () => {
  const h = sinkHarness('both');
  h.sink.begin({ question: 'q', images: ['data:x'] });
  h.sink.delta('C');
  assert.deepEqual(kinds(h.chat), ['begin', 'delta:C']);
  assert.deepEqual(kinds(h.overlay()), ['begin', 'delta:C']);
  assert.deepEqual(h.chat.sent[0][1].images, ['data:x']);
});

test('unknown target falls back to chat; TARGETS lists the valid ones', () => {
  assert.deepEqual(TARGETS, ['chat', 'overlay', 'both']);
  assert.deepEqual(sinkHarness('weird').sink.routed(), { chat: true, overlay: false });
});

test('answers carry increasing ids and errors are forwarded', () => {
  const h = sinkHarness('chat');
  const a = h.sink.begin({ question: '1' });
  h.sink.end({ text: 'x' });
  const b = h.sink.begin({ question: '2' });
  h.sink.end({ error: 'boom' });
  assert.equal(b.id, a.id + 1);
  assert.deepEqual(h.chat.sent.at(-1)[1], { id: b.id, error: 'boom' });
});

test('delta and end without a begin are ignored; end only fires once', () => {
  const h = sinkHarness('chat');
  h.sink.delta('x');
  h.sink.end({ text: 'x' });
  assert.deepEqual(h.chat.sent, []);
  h.sink.begin({});
  h.sink.end({ text: 'a' });
  h.sink.end({ text: 'again' });
  assert.deepEqual(kinds(h.chat), ['begin', 'end:a']);
});

// ---- ipc ----

test('overlay IPC handlers drive the manager', async () => {
  const { m } = manager();
  const handlers = new Map();
  registerIpc({ handle: (ch, fn) => handlers.set(ch, fn) }, { config: new Config({ env: {}, homeDir: '/h' }), appInfo: {}, overlay: m });
  const call = (ch, ...a) => handlers.get(ch)({}, ...a);
  assert.equal((await call(C.OVERLAY_SHOW)).visible, true);
  assert.equal((await call(C.OVERLAY_STATE)).visible, true);
  assert.equal((await call(C.OVERLAY_SET_CLICK_THROUGH, true)).clickThrough, true);
  assert.equal((await call(C.OVERLAY_SET_CLICK_THROUGH, 'truthy')).clickThrough, false);
  assert.equal((await call(C.OVERLAY_HIDE)).visible, false);
  assert.equal((await call(C.OVERLAY_TOGGLE)).visible, true);
});

test('practice:ask routes through the answer sink and reports where it went', async () => {
  const events = [];
  const answers = {
    begin: (a) => { events.push(['begin', a]); return { id: 1, routed: { chat: false, overlay: true } }; },
    delta: (t) => events.push(['delta', t]),
    end: (r) => events.push(['end', r]),
  };
  const practice = { ask: async (input, opts, hooks) => { hooks.onDelta('hi'); return { text: 'hi', provider: 'p', model: 'm' }; } };
  const handlers = new Map();
  registerIpc({ handle: (ch, fn) => handlers.set(ch, fn) }, { config: new Config({ env: {}, homeDir: '/h' }), appInfo: {}, practice, answers });
  const res = await handlers.get(C.PRACTICE_ASK)({}, { text: ' q ', images: [{ mimeType: 'image/png', data: 'QUJD' }] });
  assert.deepEqual(res, { text: 'hi', provider: 'p', model: 'm', routed: { chat: false, overlay: true } });
  assert.deepEqual(events[0], ['begin', { question: 'q', images: ['data:image/png;base64,QUJD'] }]);
  assert.deepEqual(events.slice(1), [['delta', 'hi'], ['end', { text: 'hi' }]]);
});

test('practice:ask ends the answer with the error when the model fails', async () => {
  const events = [];
  const answers = { begin: () => ({ id: 1, routed: { chat: true, overlay: false } }), delta() {}, end: (r) => events.push(r) };
  const practice = { ask: async () => { throw new Error('offline'); } };
  const handlers = new Map();
  registerIpc({ handle: (ch, fn) => handlers.set(ch, fn) }, { config: new Config({ env: {}, homeDir: '/h' }), appInfo: {}, practice, answers });
  await assert.rejects(handlers.get(C.PRACTICE_ASK)({}, { text: 'q' }), /offline/);
  assert.deepEqual(events, [{ error: 'offline' }]);
});

test('invalid practice input is rejected before any answer starts', async () => {
  let began = false;
  const answers = { begin: () => { began = true; return { routed: {} }; }, delta() {}, end() {} };
  const handlers = new Map();
  registerIpc({ handle: (ch, fn) => handlers.set(ch, fn) }, { config: new Config({ env: {}, homeDir: '/h' }), appInfo: {}, practice: {}, answers });
  await assert.rejects(handlers.get(C.PRACTICE_ASK)({}, { text: '  ' }), /Type a question/);
  assert.equal(began, false);
});

// ---- settings ----

test('routing and overlay opacity are allowlisted, validated and applied live', () => {
  const fsMod = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const file = path.join(fsMod.mkdtempSync(path.join(os.tmpdir(), 'mb-ov-')), 's.json');
  const userSettings = new UserSettings({ file, providers: ['gemini'] });
  const config = new Config({ env: {}, homeDir: '/h' });
  const applied = [];
  const svc = new SettingsService({
    config, userSettings, llm: { rebuild() {} }, providerNames: ['gemini'],
    secrets: { available: true, has: () => false, get: () => '' },
    onChange: (k, v) => applied.push([k, v]),
  });
  assert.equal(svc.get().routing, 'chat');
  assert.equal(svc.get().overlayOpacity, 1);
  assert.equal(svc.setSetting('routing.target', 'both').routing, 'both');
  assert.equal(svc.setSetting('overlay.opacity', 0.5).overlayOpacity, 0.5);
  assert.deepEqual(applied, [['routing.target', 'both'], ['overlay.opacity', 0.5]]);
  assert.throws(() => svc.setSetting('routing.target', 'stealth'), /Invalid value/);
  assert.throws(() => svc.setSetting('overlay.opacity', 0.1), /Invalid value/);
  assert.throws(() => svc.setSetting('overlay.opacity', '0.5'), /Invalid value/);
  assert.deepEqual(userSettings.overrides(), { routing: { target: 'both' }, overlay: { opacity: 0.5 } });
});
