const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { THEMES, THEME_IDS, DEFAULT_THEME, TOKEN_NAMES, buildTokensCss, isTheme, themeList } = require('../src/shared/themes');
const { UserSettings } = require('../src/main/settings/user-settings');
const { SettingsService } = require('../src/main/settings/service');
const { Config } = require('../src/shared/config');
const { ALLOWED_EVENTS } = require('../src/shared/channels');

const root = path.join(__dirname, '..');

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const palettes = () => THEMES.flatMap((t) => [[t.id, t.tokens], ...(t.lightTokens ? [[`${t.id} (light)`, t.lightTokens]] : [])]);

test('the generated tokens.css matches the theme definitions (run `npm run build:themes` if this fails)', () => {
  const onDisk = fs.readFileSync(path.join(root, 'src', 'renderer', 'tokens.css'), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(onDisk, buildTokensCss());
});

test('theme ids are unique, the default exists, and there are several to choose from', () => {
  assert.equal(new Set(THEME_IDS).size, THEME_IDS.length);
  assert.ok(THEME_IDS.includes(DEFAULT_THEME));
  assert.ok(THEMES.length >= 6);
  assert.deepEqual(THEME_IDS.slice(0, 3), ['system', 'dark', 'light']);
});

test('every theme defines every token as a 6-digit hex colour', () => {
  for (const [name, tokens] of palettes()) {
    for (const token of TOKEN_NAMES) assert.match(tokens[token] || '', /^#[0-9a-f]{6}$/i, `${name}: ${token}`);
  }
});

test('every theme has a CSS block and sets its colour scheme', () => {
  const css = buildTokensCss();
  for (const t of THEMES.slice(1)) {
    assert.ok(css.includes(`:root[data-theme="${t.id}"] {`), t.id);
    const block = css.slice(css.indexOf(`:root[data-theme="${t.id}"] {`));
    assert.ok(block.slice(0, block.indexOf('}')).includes(`color-scheme: ${t.scheme};`), t.id);
  }
  assert.ok(css.includes('@media (prefers-color-scheme: light)'));
  assert.ok(css.includes(':root:not([data-theme])'));
});

test('text is readable on every surface in every theme (WCAG AA, 4.5:1)', () => {
  for (const [name, t] of palettes()) {
    for (const surface of ['bg', 'surface', 'surface-2']) {
      assert.ok(contrast(t.text, t[surface]) >= 4.5, `${name}: text on ${surface} = ${contrast(t.text, t[surface]).toFixed(2)}`);
      assert.ok(contrast(t.muted, t[surface]) >= 4.5, `${name}: muted on ${surface} = ${contrast(t.muted, t[surface]).toFixed(2)}`);
    }
  }
});

test('buttons and status colours are readable too', () => {
  for (const [name, t] of palettes()) {
    assert.ok(contrast(t['accent-ink'], t.accent) >= 4.5, `${name}: accent button = ${contrast(t['accent-ink'], t.accent).toFixed(2)}`);
    for (const status of ['accent', 'good', 'warn', 'bad']) {
      assert.ok(contrast(t[status], t.surface) >= 3, `${name}: ${status} on surface = ${contrast(t[status], t.surface).toFixed(2)}`);
    }
  }
});

test('isTheme only accepts known ids', () => {
  for (const id of THEME_IDS) assert.equal(isTheme(id), true);
  for (const bad of ['', 'neon', 'DARK', null, undefined, 5, '../x']) assert.equal(isTheme(bad), false, String(bad));
});

test('themeList gives each theme a three-colour swatch', () => {
  const list = themeList();
  assert.equal(list.length, THEMES.length);
  for (const t of list) {
    assert.equal(t.swatch.length, 3);
    assert.ok(t.label && ['dark', 'light'].includes(t.scheme));
  }
});

test('theme.js is loaded by both windows, and theme changes are an allowed event', () => {
  for (const page of ['index.html', 'overlay.html']) {
    assert.match(fs.readFileSync(path.join(root, 'src', 'renderer', page), 'utf8'), /<script src="theme\.js"><\/script>/, page);
  }
  assert.ok(ALLOWED_EVENTS.has('theme:changed'));
});

test('no renderer stylesheet hard-codes a colour outside the generated tokens', () => {
  for (const file of ['styles.css', 'overlay.css']) {
    const css = fs.readFileSync(path.join(root, 'src', 'renderer', file), 'utf8');
    const hex = css.match(/#[0-9a-fA-F]{3,8}\b/g) || [];
    assert.deepEqual(hex, [], `${file} should use var(--token) instead of ${hex.join(', ')}`);
  }
});

// ---- settings ----

function harness() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mb-th-')), 's.json');
  const userSettings = new UserSettings({ file, providers: [] });
  const config = new Config({ env: {}, homeDir: '/h' });
  const changes = [];
  const svc = new SettingsService({
    config, userSettings, llm: { rebuild() {} }, providerNames: [], secrets: { available: true },
    onChange: (k, v) => changes.push([k, v]),
  });
  return { svc, config, userSettings, changes };
}

test('the default theme follows the system and settings expose the list', () => {
  const { svc } = harness();
  const out = svc.get();
  assert.equal(out.theme, 'system');
  assert.equal(out.themes.length, THEMES.length);
});

test('choosing a theme persists, applies and notifies', () => {
  const h = harness();
  assert.equal(h.svc.setSetting('ui.theme', 'ocean').theme, 'ocean');
  assert.equal(h.config.get('ui.theme'), 'ocean');
  assert.deepEqual(h.changes, [['ui.theme', 'ocean']]);
  assert.deepEqual(h.userSettings.overrides(), { ui: { theme: 'ocean' } });
});

test('unknown themes are rejected', () => {
  const h = harness();
  assert.throws(() => h.svc.setSetting('ui.theme', 'neon'), /Invalid value/);
  assert.throws(() => h.svc.setSetting('ui.theme', { id: 'dark' }), /Invalid value/);
  assert.equal(h.config.get('ui.theme'), 'system');
});
