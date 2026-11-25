const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LANGUAGES, resolveLanguage, listModes, resolveMode, STYLES, resolveStyle,
  buildSystemPrompt, buildRequest, trimHistory,
} = require('../src/main/modes');
const { Config } = require('../src/shared/config');

test('resolveLanguage accepts ids, aliases and mixed case', () => {
  assert.equal(resolveLanguage('Python').id, 'python');
  assert.equal(resolveLanguage('c++').id, 'cpp');
  assert.equal(resolveLanguage(' JS ').id, 'javascript');
  assert.equal(resolveLanguage('golang').id, 'go');
  assert.equal(resolveLanguage('cobol'), null);
  assert.equal(resolveLanguage(undefined), null);
});

test('every language has a unique id and a fence tag', () => {
  const ids = LANGUAGES.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const l of LANGUAGES) assert.ok(l.fence && l.label);
});

test('five interview modes are available, DSA no longer the only one', () => {
  assert.deepEqual(listModes().map((m) => m.id).sort(), ['behavioral', 'dsa', 'explain', 'sql', 'system-design']);
  assert.equal(resolveMode('dsa').needsLanguage, true);
  assert.equal(resolveMode('behavioral').needsLanguage, false);
  assert.equal(resolveMode('nope'), null);
});

test('three answer styles exist and differ in token budget', () => {
  assert.deepEqual(Object.keys(STYLES).sort(), ['full', 'guided', 'hints']);
  assert.ok(STYLES.hints.maxTokens < STYLES.guided.maxTokens);
  assert.ok(STYLES.guided.maxTokens < STYLES.full.maxTokens);
  assert.equal(resolveStyle('x'), null);
});

test('DSA prompt pins the chosen language and fence tag', () => {
  const p = buildSystemPrompt({ mode: 'dsa', language: 'c++', style: 'full' });
  assert.match(p, /Answer in C\+\+ only/);
  assert.match(p, /```cpp/);
  assert.match(p, /two pointers/);
});

test('non-code modes do not inject a language', () => {
  const p = buildSystemPrompt({ mode: 'behavioral', language: 'rust' });
  assert.doesNotMatch(p, /Answer in/);
  assert.match(p, /STAR/);
});

test('hint style forbids code and full style asks for an implementation', () => {
  assert.match(buildSystemPrompt({ style: 'hints' }), /Do NOT write code/);
  assert.match(buildSystemPrompt({ style: 'full' }), /clean implementation/);
});

test('defaults are dsa + python + guided', () => {
  const p = buildSystemPrompt();
  assert.match(p, /data structures and algorithms/);
  assert.match(p, /Python/);
  assert.match(p, /Guided approach/);
});

test('unknown mode, style or language throws a clear error', () => {
  assert.throws(() => buildSystemPrompt({ mode: 'x' }), /Unknown mode: x/);
  assert.throws(() => buildSystemPrompt({ style: 'x' }), /Unknown style: x/);
  assert.throws(() => buildSystemPrompt({ language: 'x' }), /Unknown language: x/);
});

test('trimHistory keeps the newest messages and starts on a user turn', () => {
  const h = [
    { role: 'user', content: '1' }, { role: 'assistant', content: '2' },
    { role: 'user', content: '3' }, { role: 'assistant', content: '4' },
  ];
  assert.deepEqual(trimHistory(h, 3).map((m) => m.content), ['3', '4']);
  assert.deepEqual(trimHistory(h, 0), []);
  assert.equal(trimHistory(h, 10).length, 4);
  assert.deepEqual(trimHistory(undefined), []);
});

test('buildRequest sends plain text as a string and caps tokens by style', () => {
  const r = buildRequest({ style: 'hints', input: { text: '  two sum  ' } });
  assert.equal(r.messages.at(-1).content, 'two sum');
  assert.equal(r.maxTokens, STYLES.hints.maxTokens);
  assert.match(r.system, /MockingBird/);
});

test('buildRequest builds multimodal content for screenshots', () => {
  const r = buildRequest({ input: { text: 'solve', images: [{ mimeType: 'image/png', data: 'QUJD' }] } });
  assert.deepEqual(r.messages.at(-1).content, [
    { type: 'text', text: 'solve' },
    { type: 'image', mimeType: 'image/png', data: 'QUJD' },
  ]);
});

test('buildRequest accepts an image with no text', () => {
  const r = buildRequest({ input: { images: [{ mimeType: 'image/png', data: 'x' }] } });
  assert.equal(r.messages.at(-1).content.length, 1);
});

test('buildRequest rejects empty input', () => {
  assert.throws(() => buildRequest({ input: { text: '   ' } }), /Nothing to send/);
  assert.throws(() => buildRequest({}), /Nothing to send/);
});

test('buildRequest limits history and appends the new turn last', () => {
  const history = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: String(i) }));
  const r = buildRequest({ history, maxHistory: 4, input: { text: 'new' } });
  assert.deepEqual(r.messages.map((m) => m.content), ['16', '17', '18', '19', 'new']);
  assert.equal(r.messages[0].role, 'user');
});

test('config exposes valid practice defaults', () => {
  const c = new Config({ env: {}, homeDir: '/h' });
  assert.ok(resolveMode(c.get('practice.mode')));
  assert.ok(resolveStyle(c.get('practice.style')));
  assert.ok(resolveLanguage(c.get('practice.language')));
});
