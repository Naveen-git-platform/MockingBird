const test = require('node:test');
const assert = require('node:assert/strict');
const { extractJson } = require('../src/main/interview/json');
const { normalizeEvaluation, normalizeSummary } = require('../src/main/interview/evaluation');
const { InterviewSession, MAX_HINTS } = require('../src/main/interview/session');
const { InterviewManager } = require('../src/main/interview/manager');
const { interviewOptions } = require('../src/main/interview/options');
const prompts = require('../src/main/interview/prompts');

/** LLM stand-in: replies come from a queue of strings (or functions). */
function fakeLlm(...replies) {
  const calls = [];
  return {
    calls,
    async generate(request, { onDelta } = {}) {
      calls.push(request);
      const next = replies.length > 1 ? replies.shift() : replies[0];
      const text = typeof next === 'function' ? next(request) : next;
      if (text instanceof Error) throw text;
      if (onDelta) for (const ch of text.match(/.{1,5}/gs) || []) onDelta(ch);
      return { text, provider: 'fake', model: 'fake' };
    },
  };
}

const EVAL = (score, extra = {}) => JSON.stringify({ score, summary: 'ok', strengths: ['clear'], improvements: ['edge cases'], followUp: 'Why?', ...extra });
const mk = (llm, opts = {}) => new InterviewSession({ llm, ...opts });

// ---- json + evaluation ----

test('extractJson handles raw, fenced, and prose-wrapped JSON', () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('```json\n{"a":2}\n```'), { a: 2 });
  assert.deepEqual(extractJson('Sure! Here you go: {"a":3} hope that helps'), { a: 3 });
});

test('extractJson rejects empty, non-JSON and array output', () => {
  assert.throws(() => extractJson(''), /Empty/);
  assert.throws(() => extractJson('no json here'), /valid JSON/);
  assert.throws(() => extractJson('[1,2,3]'), /valid JSON/);
  assert.throws(() => extractJson(null), /Empty/);
});

test('normalizeEvaluation clamps scores, trims lists and validates', () => {
  const e = normalizeEvaluation({ score: '11.26', summary: ' good ', strengths: ['a', '', 5, 'b'], improvements: Array(9).fill('x'), followUp: ' ' });
  assert.equal(e.score, 10);
  assert.equal(e.summary, 'good');
  assert.deepEqual(e.strengths, ['a', 'b']);
  assert.equal(e.improvements.length, 5);
  assert.equal(e.followUp, null);
  assert.equal(normalizeEvaluation({ score: -3 }).score, 0);
  assert.equal(normalizeEvaluation({ score: 7.34 }).score, 7.3);
  assert.throws(() => normalizeEvaluation({ score: 'high' }), /numeric score/);
  assert.throws(() => normalizeEvaluation({}), /numeric score/);
  assert.throws(() => normalizeEvaluation(null), /object/);
});

test('normalizeSummary cleans the narrative', () => {
  assert.deepEqual(normalizeSummary({ summary: ' hi ', focusAreas: ['dp', 3] }), { summary: 'hi', focusAreas: ['dp'] });
  assert.throws(() => normalizeSummary(7), /object/);
});

// ---- prompts ----

test('prompts: question prompt lists earlier questions to avoid repeats', () => {
  const p = prompts.questionPrompt({ asked: ['Two sum', 'LRU cache'], index: 2, total: 5 });
  assert.match(p, /do NOT repeat/);
  assert.match(p, /1\. Two sum/);
  assert.match(p, /question 3 of 5/);
  assert.doesNotMatch(prompts.questionPrompt({ asked: [], index: 0, total: 3 }), /already asked/);
});

test('prompts: hints get more specific by level and carry earlier hints', () => {
  assert.equal(prompts.HINT_LEVELS.length, 3);
  const p = prompts.hintPrompt({ question: 'Q', level: 2, previousHints: ['first'] });
  assert.match(p, /1\. first/);
  assert.match(p, /key insight/);
});

test('prompts: persona includes mode, difficulty, role and language for code modes', () => {
  const p = prompts.persona({ mode: 'dsa', language: 'go', difficulty: 'hard', role: 'backend engineer' });
  assert.match(p, /hard/);
  assert.match(p, /backend engineer/);
  assert.match(p, /```go/);
  assert.doesNotMatch(prompts.persona({ mode: 'behavioral', language: 'go', difficulty: 'easy' }), /codes in/);
});

test('interviewOptions describes the form choices', () => {
  const o = interviewOptions();
  assert.deepEqual(o.modes.map((m) => m.id), ['dsa', 'system-design', 'behavioral', 'sql']);
  assert.deepEqual(o.difficulties, ['easy', 'medium', 'hard']);
  assert.ok(o.languages.some((l) => l.id === 'python'));
  assert.ok(!o.languages.some((l) => l.id === 'sql'));
});

// ---- session ----

test('constructor validates its options', () => {
  const llm = fakeLlm('x');
  assert.throws(() => mk(llm, { mode: 'explain' }), /Unsupported interview type/);
  assert.throws(() => mk(llm, { difficulty: 'insane' }), /Unknown difficulty/);
  assert.throws(() => mk(llm, { questionCount: 0 }), /whole number/);
  assert.throws(() => mk(llm, { questionCount: 21 }), /whole number/);
  assert.throws(() => mk(llm, { questionCount: 2.5 }), /whole number/);
  assert.throws(() => mk(llm, { language: 'cobol' }), /Unknown language/);
  assert.equal(mk(llm, { mode: 'behavioral', language: 'cobol' }).language, null);
  assert.equal(mk(llm, { language: 'C++' }).language, 'cpp');
});

test('start asks the first question and streams it', async () => {
  const deltas = [];
  const s = mk(fakeLlm('  Given an array, find two numbers that add to a target.  '));
  const q = await s.start({ onDelta: (d) => deltas.push(d) });
  assert.equal(q.text, 'Given an array, find two numbers that add to a target.');
  assert.equal(s.status, 'awaiting_answer');
  assert.ok(deltas.join('').includes('two numbers'));
  assert.ok(s.startedAt);
  await assert.rejects(s.start(), /Not allowed while the interview is awaiting_answer/);
});

test('start failure leaves the session ready so it can be retried', async () => {
  const s = mk(fakeLlm(new Error('network'), 'Q1'));
  await assert.rejects(s.start(), /network/);
  assert.equal(s.status, 'ready');
  assert.equal(s.questions.length, 0);
  await s.start();
  assert.equal(s.questions.length, 1);
});

test('empty question output is rejected', async () => {
  await assert.rejects(mk(fakeLlm('   ')).start(), /empty question/);
});

test('submitAnswer scores the answer and stores it', async () => {
  const llm = fakeLlm('Q1', EVAL(8));
  const s = mk(llm);
  await s.start();
  const ev = await s.submitAnswer({ text: 'use a hash map' });
  assert.equal(ev.score, 8);
  assert.equal(s.status, 'evaluated');
  assert.deepEqual(s.current.answer, { text: 'use a hash map', imageCount: 0 });
  const req = llm.calls[1];
  assert.equal(req.temperature, 0.2);
  assert.match(req.messages[0].content[0].text, /Candidate answer:\nuse a hash map/);
  assert.match(req.messages[0].content[0].text, /Question:\nQ1/);
});

test('submitAnswer sends attached images as image parts', async () => {
  const llm = fakeLlm('Q1', EVAL(5));
  const s = mk(llm);
  await s.start();
  await s.submitAnswer({ text: '', images: [{ mimeType: 'image/png', data: 'QUJD' }] });
  const parts = llm.calls[1].messages[0].content;
  assert.match(parts[0].text, /see attached image/);
  assert.deepEqual(parts[1], { type: 'image', mimeType: 'image/png', data: 'QUJD' });
  assert.equal(s.current.answer.imageCount, 1);
});

test('submitAnswer retries once when the model returns bad JSON', async () => {
  const llm = fakeLlm('Q1', 'I think it is great!', EVAL(6));
  const s = mk(llm);
  await s.start();
  assert.equal((await s.submitAnswer({ text: 'a' })).score, 6);
  const retry = llm.calls[2].messages;
  assert.equal(retry.length, 3);
  assert.equal(retry[1].role, 'assistant');
  assert.match(retry[2].content, /ONLY the JSON/);
});

test('submitAnswer fails cleanly after two bad replies and can be retried', async () => {
  const s = mk(fakeLlm('Q1', 'nope', 'still nope', EVAL(4)));
  await s.start();
  await assert.rejects(s.submitAnswer({ text: 'a' }), /Could not read the AI feedback/);
  assert.equal(s.status, 'awaiting_answer');
  assert.equal(s.current.answer, null);
  assert.equal((await s.submitAnswer({ text: 'a' })).score, 4);
});

test('submitAnswer rejects empty answers and wrong states', async () => {
  const s = mk(fakeLlm('Q1', EVAL(5)));
  await assert.rejects(s.submitAnswer({ text: 'x' }), /Not allowed while the interview is ready/);
  await s.start();
  await assert.rejects(s.submitAnswer({ text: '  ' }), /Type or attach/);
  await assert.rejects(s.submitAnswer(undefined), /Type or attach/);
  await s.submitAnswer({ text: 'ok' });
  await assert.rejects(s.submitAnswer({ text: 'again' }), /Not allowed while the interview is evaluated/);
});

test('hints are progressive, capped, and recorded', async () => {
  const llm = fakeLlm('Q1', 'h1', 'h2', 'h3', 'h4');
  const s = mk(llm);
  await s.start();
  const h1 = await s.requestHint();
  assert.deepEqual(h1, { level: 1, text: 'h1', remaining: 2 });
  assert.match(llm.calls[1].messages[0].content, /small nudge/);
  const h2 = await s.requestHint();
  assert.equal(h2.level, 2);
  assert.match(llm.calls[2].messages[0].content, /1\. h1/);
  await s.requestHint();
  assert.equal(MAX_HINTS, 3);
  await assert.rejects(s.requestHint(), /No more hints/);
  assert.deepEqual(s.current.hints, ['h1', 'h2', 'h3']);
});

test('hint requires an open question and a non-empty reply', async () => {
  const s = mk(fakeLlm('Q1', ' ', EVAL(5)));
  await assert.rejects(s.requestHint(), /Not allowed/);
  await s.start();
  await assert.rejects(s.requestHint(), /empty hint/);
  assert.equal(s.current.hints.length, 0);
});

test('next asks a fresh question, passing earlier ones to avoid repeats', async () => {
  const llm = fakeLlm('Q1', EVAL(7), 'Q2');
  const s = mk(llm, { questionCount: 2 });
  await s.start();
  await assert.rejects(s.next(), /Not allowed while the interview is awaiting_answer/);
  await s.submitAnswer({ text: 'a' });
  const q2 = await s.next();
  assert.equal(q2.index, 1);
  assert.match(llm.calls[2].messages[0].content, /1\. Q1/);
  assert.equal(s.hasNext, false);
  await s.submitAnswer({ text: 'b' }).catch(() => {});
});

test('next refuses past the last question', async () => {
  const s = mk(fakeLlm('Q1', EVAL(7)), { questionCount: 1 });
  await s.start();
  await s.submitAnswer({ text: 'a' });
  await assert.rejects(s.next(), /last question/);
});

test('skip marks the question skipped with no score', async () => {
  const s = mk(fakeLlm('Q1', 'Q2'), { questionCount: 2 });
  await s.start();
  s.skip();
  assert.equal(s.status, 'evaluated');
  assert.equal(s.current.skipped, true);
  assert.equal(s.current.evaluation, null);
  assert.throws(() => s.skip(), /Not allowed/);
  await s.next();
});

test('finish builds a report with deterministic stats and an AI summary', async () => {
  const llm = fakeLlm(
    'Q1', EVAL(9), 'Q2', 'h', EVAL(4), 'Q3',
    JSON.stringify({ summary: 'Solid start.', focusAreas: ['graphs'] })
  );
  const s = mk(llm, { questionCount: 3 });
  await s.start();
  await s.submitAnswer({ text: 'a' });
  await s.next();
  await s.requestHint();
  await s.submitAnswer({ text: 'b' });
  await s.next();
  s.skip();
  const report = await s.finish();
  assert.equal(s.status, 'finished');
  assert.equal(report.questionsAsked, 3);
  assert.equal(report.questionsAnswered, 2);
  assert.equal(report.questionsSkipped, 1);
  assert.equal(report.hintsUsed, 1);
  assert.equal(report.averageScore, 6.5);
  assert.equal(report.bestQuestion, 0);
  assert.equal(report.weakestQuestion, 1);
  assert.deepEqual(report.perQuestion.map((p) => p.score), [9, 4, null]);
  assert.equal(report.summary, 'Solid start.');
  assert.deepEqual(report.focusAreas, ['graphs']);
  assert.ok(s.finishedAt);
});

test('finish falls back to a plain summary when the model fails', async () => {
  const s = mk(fakeLlm('Q1', EVAL(8), new Error('down')));
  await s.start();
  await s.submitAnswer({ text: 'a' });
  const report = await s.finish();
  assert.match(report.summary, /answered 1 of 1 questions with an average score of 8\/10/);
  assert.deepEqual(report.focusAreas, []);
});

test('finishing with nothing answered skips the AI call', async () => {
  const llm = fakeLlm('Q1');
  const s = mk(llm);
  await s.start();
  const report = await s.finish();
  assert.equal(report.averageScore, null);
  assert.equal(report.bestQuestion, null);
  assert.match(report.summary, /nothing to score/);
  assert.equal(llm.calls.length, 1);
  assert.equal(s.questions[0].skipped, true);
});

test('finish is only allowed once, and not before starting', async () => {
  const s = mk(fakeLlm('Q1', EVAL(5), '{"summary":"s","focusAreas":[]}'));
  await assert.rejects(s.finish(), /Not allowed while the interview is ready/);
  await s.start();
  await s.submitAnswer({ text: 'a' });
  await s.finish();
  await assert.rejects(s.finish(), /Not allowed while the interview is finished/);
});

test('overlapping steps are rejected', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const llm = { async generate() { await gate; return { text: 'Q1' }; } };
  const s = mk(llm);
  const first = s.start();
  await assert.rejects(s.start(), /still running/);
  release();
  await first;
  assert.equal(s.busy, false);
});

test('snapshot is a detached, serialisable copy', async () => {
  const s = mk(fakeLlm('Q1', 'h'));
  await s.start();
  await s.requestHint();
  const snap = s.snapshot();
  snap.questions[0].hints.push('tamper');
  assert.equal(s.current.hints.length, 1);
  assert.equal(JSON.parse(JSON.stringify(snap)).questions[0].text, 'Q1');
  assert.equal(snap.status, 'awaiting_answer');
});

// ---- manager ----

test('manager runs a full flow and calls onFinished with the snapshot', async () => {
  const saved = [];
  const llm = fakeLlm('Q1', EVAL(7), '{"summary":"fine","focusAreas":[]}');
  const m = new InterviewManager({ llm, defaults: { questionCount: 1 }, onFinished: (snap) => saved.push(snap) });
  assert.equal(m.state(), null);
  await assert.rejects(m.answer({ text: 'x' }), /No interview in progress/);
  const started = await m.start({ mode: 'dsa', language: 'python' });
  assert.equal(started.status, 'awaiting_answer');
  const { evaluation, state } = await m.answer({ text: 'a' });
  assert.equal(evaluation.score, 7);
  assert.equal(state.status, 'evaluated');
  const done = await m.finish();
  assert.equal(done.status, 'finished');
  assert.equal(saved.length, 1);
  assert.equal(saved[0].report.averageScore, 7);
});

test('manager blocks a second interview until the first finishes, then allows a new one', async () => {
  const llm = fakeLlm('Q1', EVAL(5), '{"summary":"s","focusAreas":[]}', 'Q-new');
  const m = new InterviewManager({ llm });
  await m.start({});
  await assert.rejects(m.start({}), /already in progress/);
  await m.answer({ text: 'a' });
  await m.finish();
  const second = await m.start({});
  assert.equal(second.questions[0].text, 'Q-new');
});

test('manager survives an onFinished failure and supports hint/skip/next/discard', async () => {
  const llm = fakeLlm('Q1', 'a hint', 'Q2', '{"summary":"s","focusAreas":[]}');
  const m = new InterviewManager({ llm, defaults: { questionCount: 2 }, onFinished: () => { throw new Error('disk full'); } });
  await m.start({});
  assert.equal((await m.hint()).hint.level, 1);
  assert.equal(m.skip().status, 'evaluated');
  assert.equal((await m.next()).questions.length, 2);
  assert.equal((await m.finish()).status, 'finished');
  m.discard();
  assert.equal(m.state(), null);
});

test('manager does not keep a session whose first question failed', async () => {
  const m = new InterviewManager({ llm: fakeLlm(new Error('offline'), 'Q1') });
  await assert.rejects(m.start({}), /offline/);
  assert.equal(m.state(), null);
  assert.equal((await m.start({})).questions.length, 1);
});
