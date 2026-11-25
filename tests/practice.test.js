const test = require('node:test');
const assert = require('node:assert/strict');
const { PracticeService } = require('../src/main/practice/service');
const { practiceOptions } = require('../src/main/practice/options');
const { registerIpc } = require('../src/main/ipc');
const { INVOKE_CHANNELS: C, EVENT_CHANNELS: E } = require('../src/shared/channels');
const { Config } = require('../src/shared/config');

function fakeLlm(...replies) {
  const calls = [];
  return {
    calls,
    describe: () => [{ name: 'fake', model: 'm', configured: true, supportsImages: true }],
    async generate(request, hooks = {}) {
      calls.push(request);
      const next = replies.length > 1 ? replies.shift() : replies[0];
      if (next instanceof Error) throw next;
      hooks.onDelta?.(next);
      return { text: next, provider: 'fake', model: 'm' };
    },
  };
}
const input = (text, images = []) => ({ text, images });

test('ask builds a mode-aware request and returns the answer', async () => {
  const llm = fakeLlm('Use a hash map.');
  const p = new PracticeService({ llm });
  const res = await p.ask(input('two sum'), { mode: 'dsa', language: 'go', style: 'hints' });
  assert.deepEqual(res, { text: 'Use a hash map.', provider: 'fake', model: 'm' });
  const req = llm.calls[0];
  assert.match(req.system, /Answer in Go only/);
  assert.match(req.system, /Hints only/);
  assert.equal(req.messages.at(-1).content, 'two sum');
});

test('ask uses defaults when options are omitted', async () => {
  const llm = fakeLlm('ok');
  await new PracticeService({ llm, defaults: { style: 'full', language: 'java' } }).ask(input('q'));
  assert.match(llm.calls[0].system, /Java/);
  assert.match(llm.calls[0].system, /Full solution/);
});

test('follow-ups carry earlier turns; images are noted but not stored', async () => {
  const llm = fakeLlm('first', 'second');
  const p = new PracticeService({ llm });
  await p.ask(input('', [{ mimeType: 'image/png', data: 'QUJD' }]));
  await p.ask(input('and the complexity?'));
  const msgs = llm.calls[1].messages;
  assert.equal(msgs.length, 3);
  assert.match(msgs[0].content, /see attached image.*1 image attached/);
  assert.equal(msgs[1].content, 'first');
  assert.equal(p.turns, 2);
});

test('reset clears memory', async () => {
  const llm = fakeLlm('a');
  const p = new PracticeService({ llm });
  await p.ask(input('q'));
  p.reset();
  await p.ask(input('q2'));
  assert.equal(llm.calls[1].messages.length, 1);
});

test('a failed ask leaves memory untouched and unlocks the service', async () => {
  const llm = fakeLlm(new Error('offline'), 'fine');
  const p = new PracticeService({ llm });
  await assert.rejects(p.ask(input('q')), /offline/);
  assert.equal(p.turns, 0);
  assert.equal(p.busy, false);
  assert.equal((await p.ask(input('q'))).text, 'fine');
});

test('concurrent asks are rejected', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const p = new PracticeService({ llm: { async generate() { await gate; return { text: 'x' }; } } });
  const first = p.ask(input('a'));
  await assert.rejects(p.ask(input('b')), /Still answering/);
  release();
  await first;
});

test('invalid options are rejected before calling the model', async () => {
  const llm = fakeLlm('x');
  const p = new PracticeService({ llm });
  await assert.rejects(p.ask(input('q'), { mode: 'nope' }), /Unknown mode/);
  await assert.rejects(p.ask(input('q'), { style: 'nope' }), /Unknown style/);
  await assert.rejects(p.ask(input('q'), { language: 'nope' }), /Unknown language/);
  await p.ask(input('q'), { mode: 'behavioral', language: 'nope' });
  assert.equal(llm.calls.length, 1);
});

test('stored memory is capped', async () => {
  const p = new PracticeService({ llm: fakeLlm('a') });
  for (let i = 0; i < 40; i += 1) await p.ask(input(`q${i}`));
  assert.equal(p.history.length, 60);
  assert.equal(p.history[0].role, 'user');
});

test('practiceOptions lists modes, languages and styles', () => {
  const o = practiceOptions();
  assert.equal(o.modes.length, 5);
  assert.ok(o.languages.some((l) => l.id === 'rust'));
  assert.deepEqual(o.styles.map((s) => s.id), ['hints', 'guided', 'full']);
});

test('practice and llm IPC: validates input, streams deltas, resets', async () => {
  const sent = [];
  const event = { sender: { isDestroyed: () => false, send: (ch, p) => sent.push([ch, p]) } };
  const llm = fakeLlm('streamed answer');
  const practice = new PracticeService({ llm });
  const handlers = new Map();
  registerIpc({ handle: (ch, fn) => handlers.set(ch, fn) }, { config: new Config({ env: {}, homeDir: '/h' }), appInfo: {}, practice, practiceOptions, llm });
  const h = (ch) => handlers.get(ch);

  assert.equal((await h(C.PRACTICE_OPTIONS)()).modes.length, 5);
  assert.equal((await h(C.LLM_STATUS)())[0].name, 'fake');
  const res = await h(C.PRACTICE_ASK)(event, { text: ' hi ', mode: 'sql', style: 'full', language: 42, ignored: 'x' });
  assert.equal(res.text, 'streamed answer');
  assert.deepEqual(sent[0], [E.PRACTICE_DELTA, { text: 'streamed answer' }]);
  assert.match(llm.calls[0].system, /SQL and databases/);
  await assert.rejects(h(C.PRACTICE_ASK)(event, { text: '' }), /Type a question/);
  await assert.rejects(h(C.PRACTICE_ASK)(event, { text: 'x', mode: 'bogus' }), /Unknown mode/);
  assert.equal(await h(C.PRACTICE_RESET)(), null);
  assert.equal(practice.turns, 0);
});
