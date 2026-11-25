const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { Config, deepMerge } = require('../src/shared/config');

test('defaults are populated and data dir lives under the home dir', () => {
  const c = new Config({ env: {}, homeDir: '/home/u' });
  assert.equal(c.get('app.name'), 'MockingBird');
  assert.equal(c.get('app.dataDir'), path.join('/home/u', '.MockingBird'));
  assert.equal(c.get('window.width'), 980);
});

test('get returns the fallback for unknown paths', () => {
  const c = new Config({ env: {}, homeDir: '/h' });
  assert.equal(c.get('nope.nothing', 'x'), 'x');
  assert.equal(c.get('window.nope'), undefined);
});

test('set creates nested paths', () => {
  const c = new Config({ env: {}, homeDir: '/h' });
  c.set('llm.provider', 'ollama');
  assert.equal(c.get('llm.provider'), 'ollama');
});

test('environment variables override defaults', () => {
  const c = new Config({
    env: { MOCKINGBIRD_DATA_DIR: '/data', MOCKINGBIRD_LOG_LEVEL: 'debug' },
    homeDir: '/h',
  });
  assert.equal(c.get('app.dataDir'), '/data');
  assert.equal(c.get('logging.level'), 'debug');
});

test('explicit overrides merge deeply without dropping siblings', () => {
  const c = new Config({ env: {}, homeDir: '/h', overrides: { window: { width: 1200 } } });
  assert.equal(c.get('window.width'), 1200);
  assert.equal(c.get('window.height'), 700);
});

test('toJSON returns a detached copy', () => {
  const c = new Config({ env: {}, homeDir: '/h' });
  const snap = c.toJSON();
  snap.window.width = 1;
  assert.equal(c.get('window.width'), 980);
});

test('deepMerge replaces arrays instead of merging them', () => {
  assert.deepEqual(deepMerge({ a: [1, 2] }, { a: [3] }), { a: [3] });
});
