const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ACTIONS, DEFAULT_SHORTCUTS, ShortcutManager, isValidAccelerator, canonical } = require('../src/main/shortcuts');
const { QuickAsk, DEFAULT_PROMPT } = require('../src/main/quick-ask');
const { fromEvent } = require('../src/renderer/accelerator');
const { UserSettings } = require('../src/main/settings/user-settings');
const { SettingsService } = require('../src/main/settings/service');
const { Config } = require('../src/shared/config');

// ---- validation ----

test('valid accelerators need a modifier and one key', () => {
  for (const ok of ['CommandOrControl+Shift+S', 'Alt+Shift+V', 'Ctrl+F5', 'Shift+Alt+Space', 'Control+Plus', 'Super+Up', 'Alt+/', 'CmdOrCtrl+Shift+F12', 'Ctrl+Num5']) {
    assert.equal(isValidAccelerator(ok), true, ok);
  }
});

test('invalid accelerators are rejected', () => {
  for (const bad of ['', 'S', 'F5', 'Ctrl', 'Ctrl+', '+S', 'Ctrl+Ctrl+S', 'Ctrl+Shift', 'Hyper+S', 'Ctrl+AB', 'Ctrl+F25', 'Ctrl+Shift+S+D', null, undefined, 42, 'x'.repeat(80)]) {
    assert.equal(isValidAccelerator(bad), false, String(bad));
  }
});

test('canonical treats aliases and order as the same shortcut', () => {
  assert.equal(canonical('Ctrl+Shift+S'), canonical('Shift+CommandOrControl+s'));
  assert.equal(canonical('Option+A'), canonical('Alt+a'));
  assert.notEqual(canonical('Ctrl+S'), canonical('Ctrl+Shift+S'));
});

test('default shortcuts are valid and unique', () => {
  const values = Object.values(DEFAULT_SHORTCUTS);
  assert.deepEqual(Object.keys(DEFAULT_SHORTCUTS), Object.keys(ACTIONS));
  assert.ok(values.every(isValidAccelerator));
  assert.equal(new Set(values.map(canonical)).size, values.length);
});

// ---- manager ----

function fakeGlobal({ taken = [] } = {}) {
  const reg = new Map();
  return {
    reg,
    register: (acc, fn) => {
      if (taken.includes(acc)) return false;
      reg.set(acc, fn);
      return true;
    },
    unregister: (acc) => reg.delete(acc),
  };
}
const handlers = (log) => Object.fromEntries(Object.keys(ACTIONS).map((a) => [a, () => log.push(a)]));

test('apply registers every action and reports success', () => {
  const g = fakeGlobal();
  const log = [];
  const m = new ShortcutManager({ globalShortcut: g, handlers: handlers(log) });
  const status = m.apply(DEFAULT_SHORTCUTS);
  assert.ok(Object.values(status).every((s) => s.ok));
  assert.equal(g.reg.size, 5);
  g.reg.get('Alt+Shift+V')();
  g.reg.get('CommandOrControl+Shift+S')();
  assert.deepEqual(log, ['toggleVoice', 'captureAsk']);
});

test('a shortcut taken by another app is reported, the rest still work', () => {
  const g = fakeGlobal({ taken: ['Alt+Shift+V'] });
  const m = new ShortcutManager({ globalShortcut: g, handlers: handlers([]) });
  const status = m.apply(DEFAULT_SHORTCUTS);
  assert.equal(status.toggleVoice.ok, false);
  assert.match(status.toggleVoice.error, /Another app/);
  assert.equal(status.captureAsk.ok, true);
  assert.equal(g.reg.size, 4);
});

test('duplicate and invalid accelerators are not registered', () => {
  const g = fakeGlobal();
  const m = new ShortcutManager({ globalShortcut: g, handlers: handlers([]) });
  const status = m.apply({ ...DEFAULT_SHORTCUTS, toggleOverlay: 'Ctrl+Shift+S', toggleClickThrough: 'oops' });
  assert.equal(status.captureAsk.ok, true);
  assert.equal(status.toggleOverlay.ok, false);
  assert.match(status.toggleOverlay.error, /Already used for "Capture the screen and answer"/);
  assert.match(status.toggleClickThrough.error, /Not a valid shortcut/);
  assert.equal(g.reg.size, 3);
});

test('re-applying unregisters the previous shortcuts first', () => {
  const g = fakeGlobal();
  const m = new ShortcutManager({ globalShortcut: g, handlers: handlers([]) });
  m.apply(DEFAULT_SHORTCUTS);
  m.apply({ ...DEFAULT_SHORTCUTS, captureAsk: 'Ctrl+Alt+K' });
  assert.equal(g.reg.has('CommandOrControl+Shift+S'), false);
  assert.equal(g.reg.has('Ctrl+Alt+K'), true);
  assert.equal(g.reg.size, 5);
});

test('disabled mode registers nothing and says why', () => {
  const g = fakeGlobal();
  const m = new ShortcutManager({ globalShortcut: g, handlers: handlers([]) });
  m.apply(DEFAULT_SHORTCUTS);
  const status = m.apply(DEFAULT_SHORTCUTS, { enabled: false });
  assert.equal(g.reg.size, 0);
  assert.ok(Object.values(status).every((s) => !s.ok && /turned off/.test(s.error)));
});

test('unregisterAll clears everything, and registration errors are contained', () => {
  const g = fakeGlobal();
  const m = new ShortcutManager({ globalShortcut: g, handlers: handlers([]) });
  m.apply(DEFAULT_SHORTCUTS);
  m.unregisterAll();
  assert.equal(g.reg.size, 0);
  const warnings = [];
  const bad = { register: () => { throw new Error('boom'); }, unregister: () => { throw new Error('gone'); } };
  const m2 = new ShortcutManager({ globalShortcut: bad, handlers: handlers([]), logger: { warn: (...a) => warnings.push(a), error() {} } });
  assert.equal(m2.apply(DEFAULT_SHORTCUTS).captureAsk.ok, false);
  assert.equal(warnings.length, 5);
  assert.doesNotThrow(() => m2.unregisterAll());
});

test('handler errors, sync and async, never escape', async () => {
  const errors = [];
  const g = fakeGlobal();
  const h = handlers([]);
  h.captureAsk = () => { throw new Error('sync fail'); };
  h.toggleVoice = () => Promise.reject(new Error('async fail'));
  const m = new ShortcutManager({ globalShortcut: g, handlers: h, logger: { error: (_m, meta) => errors.push(meta.error), warn() {} } });
  m.apply(DEFAULT_SHORTCUTS);
  assert.doesNotThrow(() => g.reg.get('CommandOrControl+Shift+S')());
  g.reg.get('Alt+Shift+V')();
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(errors.sort(), ['async fail', 'sync fail']);
});

// ---- quick ask ----

function quickHarness({ captureError, askError, text = 'answer', routed = { chat: true, overlay: false } } = {}) {
  const events = [];
  const capture = { captureScreen: async () => { if (captureError) throw new Error(captureError); return { mimeType: 'image/png', data: 'QUJD' }; } };
  const practice = { ask: async (input, _o, hooks) => { events.push(['ask', input]); if (askError) throw new Error(askError); hooks.onDelta(text); return { text }; } };
  const answers = {
    begin: (a) => { events.push(['begin', a]); return { id: 1, routed }; },
    delta: (t) => events.push(['delta', t]),
    end: (r) => events.push(['end', r]),
  };
  return { q: new QuickAsk({ capture, practice, answers }), events };
}

test('quick ask captures, asks with the image, and streams through the sink', async () => {
  const { q, events } = quickHarness();
  const res = await q.run();
  assert.deepEqual(res, { text: 'answer', routed: { chat: true, overlay: false } });
  assert.deepEqual(events[0], ['begin', { question: DEFAULT_PROMPT, images: ['data:image/png;base64,QUJD'] }]);
  assert.deepEqual(events[1], ['ask', { text: DEFAULT_PROMPT, images: [{ mimeType: 'image/png', data: 'QUJD' }] }]);
  assert.deepEqual(events.slice(2), [['delta', 'answer'], ['end', { text: 'answer' }]]);
});

test('quick ask shows capture and model failures as the answer instead of throwing', async () => {
  const a = quickHarness({ captureError: 'no display' });
  assert.deepEqual(await a.q.run(), { error: 'no display' });
  assert.deepEqual(a.events.at(-1), ['end', { error: 'Could not capture the screen: no display' }]);
  const b = quickHarness({ askError: 'rate limited' });
  assert.equal((await b.q.run()).error, 'rate limited');
  assert.deepEqual(b.events.at(-1), ['end', { error: 'rate limited' }]);
});

test('a second quick ask while one is running is skipped; the lock is released afterwards', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const q = new QuickAsk({
    capture: { captureScreen: async () => { await gate; return { mimeType: 'image/png', data: 'x' }; } },
    practice: { ask: async () => ({ text: 'ok' }) },
    answers: { begin: () => ({ routed: {} }), delta() {}, end() {} },
  });
  const first = q.run();
  assert.deepEqual(await q.run(), { skipped: 'busy' });
  release();
  await first;
  assert.equal(q.busy, false);
  assert.equal((await q.run()).text, 'ok');
});

// ---- accelerator builder ----

const ev = (key, mods = {}) => ({ key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods });

test('fromEvent builds accelerators from key presses', () => {
  assert.equal(fromEvent(ev('s', { ctrlKey: true, shiftKey: true })), 'CommandOrControl+Shift+S');
  assert.equal(fromEvent(ev('r', { altKey: true })), 'Alt+R');
  assert.equal(fromEvent(ev(' ', { ctrlKey: true })), 'CommandOrControl+Space');
  assert.equal(fromEvent(ev('ArrowUp', { altKey: true })), 'Alt+Up');
  assert.equal(fromEvent(ev('F5', { shiftKey: true })), 'Shift+F5');
  assert.equal(fromEvent(ev('+', { ctrlKey: true })), 'CommandOrControl+Plus');
  assert.equal(fromEvent(ev('s', { metaKey: true }), false), 'Super+S');
  assert.equal(fromEvent(ev('s', { metaKey: true, ctrlKey: true }), true), 'Command+Control+S');
});

test('fromEvent ignores bare modifiers and modifier-less keys', () => {
  assert.equal(fromEvent(ev('Control', { ctrlKey: true })), null);
  assert.equal(fromEvent(ev('Shift', { shiftKey: true })), null);
  assert.equal(fromEvent(ev('a')), null);
});

test('every accelerator fromEvent can build passes validation', () => {
  const samples = [ev('s', { ctrlKey: true, shiftKey: true }), ev('ArrowLeft', { altKey: true }), ev('Escape', { ctrlKey: true }), ev('F12', { altKey: true, shiftKey: true }), ev('+', { altKey: true }), ev('/', { ctrlKey: true })];
  for (const s of samples) assert.equal(isValidAccelerator(fromEvent(s)), true, fromEvent(s));
});

// ---- settings integration ----

function harness() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mb-sc-')), 's.json');
  const userSettings = new UserSettings({ file, providers: ['gemini'] });
  const config = new Config({ env: {}, homeDir: '/h' });
  const g = fakeGlobal();
  const manager = new ShortcutManager({ globalShortcut: g, handlers: handlers([]) });
  const changes = [];
  const svc = new SettingsService({
    config, userSettings, shortcuts: manager, llm: { rebuild() {} }, providerNames: ['gemini'],
    secrets: { available: true, has: () => false, get: () => '' }, onChange: (k, v) => changes.push([k, v]),
  });
  return { svc, config, g, userSettings, changes };
}

test('settings.get lists shortcut rows with status', () => {
  const h = harness();
  h.svc.applyShortcuts();
  const rows = h.svc.get().shortcuts;
  assert.equal(rows.length, 5);
  assert.deepEqual(rows[0], { action: 'captureAsk', label: ACTIONS.captureAsk.label, accelerator: 'CommandOrControl+Shift+S', defaultAccelerator: 'CommandOrControl+Shift+S', ok: true, error: null });
  assert.equal(h.svc.get().shortcutsEnabled, true);
});

test('changing a shortcut persists it and re-registers immediately', () => {
  const h = harness();
  h.svc.applyShortcuts();
  const out = h.svc.setSetting('shortcuts.captureAsk', 'Ctrl+Alt+K');
  assert.equal(out.shortcuts.find((r) => r.action === 'captureAsk').accelerator, 'Ctrl+Alt+K');
  assert.equal(h.g.reg.has('Ctrl+Alt+K'), true);
  assert.equal(h.g.reg.has('CommandOrControl+Shift+S'), false);
  assert.equal(h.userSettings.load()['shortcuts.captureAsk'], 'Ctrl+Alt+K');
  assert.deepEqual(h.userSettings.overrides().shortcuts, { captureAsk: 'Ctrl+Alt+K' });
});

test('invalid shortcuts are rejected and nothing changes', () => {
  const h = harness();
  h.svc.applyShortcuts();
  assert.throws(() => h.svc.setSetting('shortcuts.captureAsk', 'S'), /Invalid value/);
  assert.throws(() => h.svc.setSetting('shortcuts.bogus', 'Ctrl+S'), /not allowed/);
  assert.equal(h.g.reg.has('CommandOrControl+Shift+S'), true);
});

test('the master switch turns every shortcut off and on', () => {
  const h = harness();
  h.svc.applyShortcuts();
  h.svc.setSetting('shortcuts.enabled', false);
  assert.equal(h.g.reg.size, 0);
  assert.equal(h.svc.get().shortcuts.every((r) => !r.ok), true);
  h.svc.setSetting('shortcuts.enabled', true);
  assert.equal(h.g.reg.size, 5);
  assert.throws(() => h.svc.setSetting('shortcuts.enabled', 'yes'), /Invalid value/);
});

test('practice defaults are allowlisted and validated', () => {
  const h = harness();
  assert.equal(h.svc.setSetting('practice.mode', 'sql').practice.mode, 'sql');
  assert.equal(h.svc.setSetting('practice.language', 'rust').practice.language, 'rust');
  assert.equal(h.svc.setSetting('practice.style', 'hints').practice.style, 'hints');
  assert.throws(() => h.svc.setSetting('practice.language', 'c++'), /Invalid value/);
  assert.throws(() => h.svc.setSetting('practice.mode', 'nope'), /Invalid value/);
  assert.deepEqual(h.changes.map(([k]) => k), ['practice.mode', 'practice.language', 'practice.style']);
});

test('without a shortcut manager, settings still work', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mb-sc-')), 's.json');
  const svc = new SettingsService({ config: new Config({ env: {}, homeDir: '/h' }), userSettings: new UserSettings({ file, providers: [] }), llm: { rebuild() {} }, providerNames: [], secrets: { available: true } });
  assert.doesNotThrow(() => svc.applyShortcuts());
  assert.equal(svc.get().shortcuts.every((r) => r.ok === false), true);
});

test('display shows friendly key names per platform', () => {
  const { display } = require('../src/renderer/accelerator');
  assert.equal(display('CommandOrControl+Shift+S'), 'Ctrl+Shift+S');
  assert.equal(display('CommandOrControl+Shift+S', true), 'Cmd+Shift+S');
  assert.equal(display('Alt+Shift+V'), 'Alt+Shift+V');
  assert.equal(display('Alt+Shift+V', true), 'Option+Shift+V');
  assert.equal(display('Super+Up'), 'Win+Up');
  assert.equal(display('Control+Plus'), 'Ctrl+Plus');
});
