const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { OverlayManager, buildOverlayOptions, supportsAcrylic, resolveStyle, clampGlass, STYLES } = require('../src/main/overlay');
const { registerIpc } = require('../src/main/ipc');
const { INVOKE_CHANNELS: C } = require('../src/shared/channels');
const { Config } = require('../src/shared/config');
const { UserSettings } = require('../src/main/settings/user-settings');
const { SettingsService } = require('../src/main/settings/service');

function fakeWindow() {
  const w = new EventEmitter();
  Object.assign(w, {
    visible: false, destroyed: false, sent: [], calls: [], bounds: { x: 10, y: 20, width: 500, height: 300 },
    isDestroyed: () => w.destroyed,
    isVisible: () => w.visible,
    getBounds: () => w.bounds,
    show: () => { w.visible = true; },
    showInactive: () => { w.visible = true; w.calls.push('showInactive'); },
    hide: () => { w.visible = false; },
    destroy: () => { w.destroyed = true; w.emit('closed'); },
    setAlwaysOnTop() {},
    setOpacity() {},
    setIgnoreMouseEvents: (...a) => w.calls.push(['ignore', ...a]),
    setSize: (...a) => w.calls.push(['size', ...a]),
    webContents: new EventEmitter(),
  });
  w.webContents.send = (ch, p) => w.sent.push([ch, p]);
  return w;
}
function manager(extra = {}) {
  const created = [];
  const m = new OverlayManager({ createWindow: (o) => { const w = fakeWindow(); w.options = o; created.push(w); return w; }, ...extra });
  return { m, created };
}

// ---- options per style ----

test('solid windows are opaque', () => {
  const o = buildOverlayOptions({ style: 'solid' });
  assert.equal(o.transparent, undefined);
  assert.equal(o.backgroundMaterial, undefined);
  assert.equal(o.backgroundColor, '#0e1014');
});

test('glass windows are see-through', () => {
  const o = buildOverlayOptions({ style: 'glass' });
  assert.equal(o.transparent, true);
  assert.equal(o.backgroundColor, '#00000000');
  assert.equal(o.backgroundMaterial, undefined);
});

test('acrylic uses the Windows material or macOS vibrancy, and every style stays frameless and visible', () => {
  const win = buildOverlayOptions({ style: 'acrylic', platform: 'win32' });
  assert.equal(win.backgroundMaterial, 'acrylic');
  assert.equal(win.backgroundColor, '#00000000');
  assert.equal(win.transparent, undefined);
  assert.equal(buildOverlayOptions({ style: 'acrylic', platform: 'darwin' }).vibrancy, 'under-window');
  for (const style of STYLES) {
    const o = buildOverlayOptions({ style });
    assert.equal(o.frame, false);
    assert.equal(o.alwaysOnTop, true);
    for (const flag of ['skipTaskbar', 'focusable', 'contentProtection']) assert.equal(o[flag], undefined, `${style}: ${flag}`);
  }
});

test('saved bounds win over the default corner position', () => {
  const o = buildOverlayOptions({ style: 'glass', workArea: { x: 0, y: 0, width: 1920, height: 1080 }, bounds: { x: 5, y: 6, width: 700, height: 400 } });
  assert.deepEqual([o.x, o.y, o.width, o.height], [5, 6, 700, 400]);
});

// ---- availability ----

test('acrylic needs Windows 11 22H2 or macOS', () => {
  assert.equal(supportsAcrylic({ platform: 'win32', release: '10.0.26300' }), true);
  assert.equal(supportsAcrylic({ platform: 'win32', release: '10.0.22621' }), true);
  assert.equal(supportsAcrylic({ platform: 'win32', release: '10.0.19045' }), false);
  assert.equal(supportsAcrylic({ platform: 'win32', release: '' }), false);
  assert.equal(supportsAcrylic({ platform: 'darwin' }), true);
  assert.equal(supportsAcrylic({ platform: 'linux' }), false);
});

test('an unavailable or unknown style falls back to glass', () => {
  assert.equal(resolveStyle('acrylic', false), 'glass');
  assert.equal(resolveStyle('acrylic', true), 'acrylic');
  assert.equal(resolveStyle('solid', false), 'solid');
  assert.equal(resolveStyle('weird', true), 'glass');
});

test('availableStyles marks acrylic unavailable on old Windows', () => {
  const { m } = manager({ platform: 'win32', release: '10.0.19045' });
  assert.deepEqual(m.availableStyles().map((s) => [s.id, s.available]), [['solid', true], ['glass', true], ['acrylic', false]]);
  assert.equal(manager({ platform: 'win32', release: '10.0.26300' }).m.availableStyles()[2].available, true);
});

// ---- manager ----

test('the window is created in the configured style', () => {
  const { m, created } = manager({ style: 'glass' });
  m.show();
  assert.equal(created[0].options.transparent, true);
  const acrylic = manager({ style: 'acrylic', platform: 'win32', release: '10.0.26300' });
  acrylic.m.show();
  assert.equal(acrylic.created[0].options.backgroundMaterial, 'acrylic');
  const fallback = manager({ style: 'acrylic', platform: 'linux' });
  fallback.m.show();
  assert.equal(fallback.created[0].options.transparent, true);
  assert.equal(fallback.m.state().style, 'glass');
});

test('changing the style rebuilds the window in the same place and keeps it visible', () => {
  const { m, created } = manager({ style: 'solid' });
  m.show();
  created[0].bounds = { x: 111, y: 222, width: 640, height: 400 };
  assert.equal(m.setStyle('glass'), 'glass');
  assert.equal(created.length, 2);
  assert.equal(created[0].destroyed, true);
  assert.equal(created[1].options.transparent, true);
  assert.deepEqual([created[1].options.x, created[1].options.y, created[1].options.width, created[1].options.height], [111, 222, 640, 400]);
  assert.equal(m.isVisible(), true);
  assert.equal(m.window, created[1]);
});

test('a hidden overlay stays hidden after a style change', () => {
  const { m, created } = manager({ style: 'solid' });
  m.show();
  m.hide();
  m.setStyle('glass');
  assert.equal(created[1].visible, false);
});

test('the current answer is shown again after a rebuild', () => {
  const { m, created } = manager({ style: 'solid' });
  m.show();
  m.send('answer:begin', { id: 1, question: 'q' });
  m.send('answer:delta', { id: 1, text: 'hello ' });
  m.send('answer:delta', { id: 1, text: 'world' });
  m.setStyle('glass');
  created[1].webContents.emit('did-finish-load');
  const replayed = created[1].sent.filter(([c]) => c.startsWith('answer:'));
  assert.deepEqual(replayed.map(([c, p]) => [c, p.text || p.question]), [['answer:begin', 'q'], ['answer:delta', 'hello '], ['answer:delta', 'world']]);
});

test('a new answer replaces the saved one, so old text is never replayed', () => {
  const { m, created } = manager({ style: 'solid' });
  m.show();
  m.send('answer:begin', { id: 1, question: 'old' });
  m.send('answer:delta', { id: 1, text: 'OLD' });
  m.send('answer:begin', { id: 2, question: 'new' });
  m.send('answer:delta', { id: 2, text: 'NEW' });
  m.setStyle('glass');
  created[1].webContents.emit('did-finish-load');
  const texts = created[1].sent.filter(([c]) => c.startsWith('answer:')).map(([, p]) => p.text || p.question);
  assert.deepEqual(texts, ['new', 'NEW']);
});

test('click-through survives a rebuild', () => {
  const { m, created } = manager({ style: 'solid' });
  m.show();
  m.setClickThrough(true);
  m.setStyle('glass');
  created[1].webContents.emit('did-finish-load');
  assert.deepEqual(created[1].calls.filter((c) => Array.isArray(c) && c[0] === 'ignore').at(-1), ['ignore', true, { forward: true }]);
});

test('setting the same effective style does not rebuild, and bad styles throw', () => {
  const { m, created } = manager({ style: 'glass', platform: 'linux' });
  m.show();
  m.setStyle('acrylic');
  assert.equal(created.length, 1);
  assert.throws(() => m.setStyle('neon'), /Unknown overlay style/);
});

test('style changes before the window exists are remembered', () => {
  const { m, created } = manager({ style: 'solid' });
  m.setStyle('glass');
  m.show();
  assert.equal(created.length, 1);
  assert.equal(created[0].options.transparent, true);
});

test('glass tint is clamped and reported in state', () => {
  const { m, created } = manager({ style: 'glass', glass: 0.5 });
  m.show();
  assert.equal(m.setGlass(0), 0.05);
  assert.equal(m.setGlass(9), 0.95);
  assert.equal(clampGlass('x'), 0.35);
  assert.deepEqual(m.state(), { visible: true, opacity: 0.95, clickThrough: false, style: 'glass', glass: 0.95 });
  assert.equal(created[0].sent.at(-1)[1].glass, 0.95);
});

test('resize clamps to the minimum and to the work area', () => {
  const { m, created } = manager({ getWorkArea: () => ({ x: 0, y: 0, width: 1600, height: 900 }) });
  assert.equal(m.resize(500, 400), null);
  m.show();
  assert.deepEqual(m.resize(10, 10), { width: 300, height: 180 });
  assert.deepEqual(m.resize(9999, 9999), { width: 1600, height: 900 });
  assert.deepEqual(m.resize(600.7, 400.2), { width: 601, height: 400 });
  assert.deepEqual(created[0].calls.filter((c) => Array.isArray(c) && c[0] === 'size').at(-1), ['size', 601, 400]);
  assert.deepEqual(m.resize(NaN, NaN), { width: 300, height: 180 });
});

// ---- ipc + settings ----

test('overlay:resize validates its argument', async () => {
  const { m } = manager();
  m.show();
  const handlers = new Map();
  registerIpc({ handle: (ch, fn) => handlers.set(ch, fn) }, { config: new Config({ env: {}, homeDir: '/h' }), appInfo: {}, overlay: m });
  const resize = (arg) => handlers.get(C.OVERLAY_RESIZE)({}, arg);
  assert.deepEqual(await resize({ width: 500, height: 300 }), { width: 500, height: 300 });
  for (const bad of [null, 'x', {}, { width: 'a', height: 1 }, { width: 1 }]) assert.equal(await resize(bad), null, JSON.stringify(bad));
});

function settingsHarness() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mb-gl-')), 's.json');
  const userSettings = new UserSettings({ file, providers: [] });
  const config = new Config({ env: {}, homeDir: '/h' });
  const { m } = manager({ style: config.get('overlay.style'), glass: config.get('overlay.glass'), platform: 'win32', release: '10.0.26300' });
  const svc = new SettingsService({
    config, userSettings, llm: { rebuild() {} }, providerNames: [], secrets: { available: true },
    extras: () => ({ overlayStyles: m.availableStyles() }),
    onChange: (k, v) => {
      if (k === 'overlay.style') m.setStyle(v);
      if (k === 'overlay.glass') m.setGlass(v);
    },
  });
  return { svc, m, userSettings };
}

test('the overlay defaults to see-through glass', () => {
  const { svc, m } = settingsHarness();
  const out = svc.get();
  assert.equal(out.overlayStyle, 'glass');
  assert.equal(out.overlayGlass, 0.35);
  assert.equal(out.overlayOpacity, 1);
  assert.equal(out.overlayStyles.length, 3);
  assert.equal(m.state().style, 'glass');
});

test('style and tint persist, validate and apply live', () => {
  const h = settingsHarness();
  h.m.show();
  assert.equal(h.svc.setSetting('overlay.style', 'acrylic').overlayStyle, 'acrylic');
  assert.equal(h.m.state().style, 'acrylic');
  assert.equal(h.svc.setSetting('overlay.glass', 0.6).overlayGlass, 0.6);
  assert.equal(h.m.state().glass, 0.6);
  assert.throws(() => h.svc.setSetting('overlay.style', 'neon'), /Invalid value/);
  assert.throws(() => h.svc.setSetting('overlay.glass', 0.01), /Invalid value/);
  assert.throws(() => h.svc.setSetting('overlay.glass', '0.5'), /Invalid value/);
  assert.deepEqual(h.userSettings.overrides().overlay, { style: 'acrylic', glass: 0.6 });
});

// ---- stylesheet + page ----

test('the overlay stylesheet derives its translucency from tokens and the tint variable', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'overlay.css'), 'utf8');
  assert.match(css, /color-mix\(in srgb, var\(--bg\) calc\(var\(--glass\) \* 100%\), transparent\)/);
  assert.match(css, /html \{[^}]*background: transparent/);
  assert.match(css, /\[data-surface='solid'\]/);
  assert.deepEqual(css.match(/#[0-9a-fA-F]{3,8}\b/g) || [], []);
});

test('the overlay page has a resize grip and a tint slider', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'overlay.html'), 'utf8');
  assert.match(html, /id="grip"/);
  assert.match(html, /id="tint"/);
});
