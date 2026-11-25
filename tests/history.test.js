const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { HistoryStore, summarise } = require('../src/main/history/store');
const { computeProgress } = require('../src/main/history/stats');
const { sessionToMarkdown, defaultExportName, fenced } = require('../src/main/history/export');
const { HistoryService } = require('../src/main/history/service');
const { registerIpc } = require('../src/main/ipc');
const { INVOKE_CHANNELS: C } = require('../src/shared/channels');
const { Config } = require('../src/shared/config');

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 0, 10, 12, 0, 0);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mb-hist-'));
let n = 0;

function snap(over = {}) {
  n += 1;
  const id = over.id || `sess-${String(n).padStart(8, '0')}`;
  return {
    id,
    mode: 'dsa',
    language: 'python',
    difficulty: 'medium',
    role: 'backend',
    status: 'finished',
    startedAt: T0 - 60000,
    finishedAt: T0,
    questionCount: 2,
    hasNext: false,
    questions: [
      {
        index: 0, text: 'Two sum?', hints: ['think hash'], skipped: false, askedAt: 1, answeredAt: 2,
        answer: { text: 'use ```a map```', imageCount: 0 },
        evaluation: { score: 8, summary: 'Good.', strengths: ['clear'], improvements: ['edge cases'], followUp: 'Why O(n)?' },
      },
      { index: 1, text: 'LRU cache?', hints: [], skipped: true, askedAt: 3, answeredAt: 4, answer: null, evaluation: null },
    ],
    report: { questionsAsked: 2, questionsAnswered: 1, questionsSkipped: 1, hintsUsed: 1, averageScore: 8, summary: 'Nice work.', focusAreas: ['design'] },
    ...over,
  };
}

// ---- store ----

test('store saves atomically, lists summaries newest first, and gets full snapshots', () => {
  const store = new HistoryStore({ dir: path.join(tmp(), 'h') });
  const a = snap({ finishedAt: T0 });
  const b = snap({ finishedAt: T0 + DAY });
  store.save(a);
  const summary = store.save(b);
  assert.equal(summary.id, b.id);
  assert.equal(summary.averageScore, 8);
  assert.deepEqual(store.list().map((s) => s.id), [b.id, a.id]);
  assert.deepEqual(store.list({ limit: 1 }).map((s) => s.id), [b.id]);
  assert.equal(store.get(a.id).questions[0].text, 'Two sum?');
  assert.deepEqual(fs.readdirSync(store.dir).filter((f) => f.endsWith('.tmp')), []);
});

test('store handles a missing dir and unknown ids', () => {
  const store = new HistoryStore({ dir: path.join(tmp(), 'nope') });
  assert.deepEqual(store.list(), []);
  assert.equal(store.get('sess-12345678'), null);
  assert.equal(store.delete('sess-12345678'), false);
});

test('store rejects unfinished snapshots and path-traversal ids', () => {
  const store = new HistoryStore({ dir: tmp() });
  assert.throws(() => store.save(snap({ status: 'awaiting_answer' })), /Only finished/);
  assert.throws(() => store.save(null), /Only finished/);
  for (const bad of ['../evil', 'a/b', '', 'short', 'x'.repeat(80), 'has space id', null]) {
    assert.throws(() => store.get(bad), /Invalid session id/, String(bad));
    assert.throws(() => store.delete(bad), /Invalid session id/, String(bad));
  }
});

test('store skips corrupt and unfinished files instead of failing', () => {
  const dir = tmp();
  const warnings = [];
  const store = new HistoryStore({ dir, logger: { warn: (...a) => warnings.push(a) } });
  store.save(snap({ id: 'good-0001' }));
  fs.writeFileSync(path.join(dir, 'broken-01.json'), '{not json');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'ignore me');
  fs.writeFileSync(path.join(dir, 'draft-001.json'), JSON.stringify({ id: 'draft-001', status: 'ready' }));
  assert.deepEqual(store.list().map((s) => s.id), ['good-0001']);
  assert.equal(warnings.length, 1);
  assert.throws(() => (fs.writeFileSync(path.join(dir, 'bad-0002.json'), 'xx'), store.get('bad-0002')), /Could not read session/);
});

test('store delete and clear', () => {
  const store = new HistoryStore({ dir: tmp() });
  const a = snap();
  const b = snap();
  store.save(a);
  store.save(b);
  assert.equal(store.delete(a.id), true);
  assert.equal(store.list().length, 1);
  assert.equal(store.clear(), 1);
  assert.deepEqual(store.list(), []);
});

test('summarise falls back when the report is missing', () => {
  const s = summarise({ id: 'x', mode: 'sql', questions: [1, 2, 3] });
  assert.deepEqual([s.questionsAsked, s.averageScore, s.hintsUsed, s.role], [3, null, 0, '']);
});

// ---- stats ----

const sum = (over) => ({ id: `i${Math.random()}`, mode: 'dsa', questionsAsked: 5, hintsUsed: 0, averageScore: 5, finishedAt: T0, ...over });

test('computeProgress on no data is all empty', () => {
  const p = computeProgress([], { now: T0 });
  assert.deepEqual([p.sessions, p.overallAverage, p.bestScore, p.streakDays, p.improvement, p.hintsPerQuestion], [0, null, null, 0, null, 0]);
  assert.deepEqual(p.trend, []);
});

test('computeProgress aggregates totals and per-mode averages', () => {
  const p = computeProgress([
    sum({ mode: 'dsa', averageScore: 6, questionsAsked: 4, hintsUsed: 2 }),
    sum({ mode: 'dsa', averageScore: 8, questionsAsked: 6, hintsUsed: 0 }),
    sum({ mode: 'behavioral', averageScore: null, questionsAsked: 3 }),
  ], { now: T0 });
  assert.equal(p.sessions, 3);
  assert.equal(p.totalQuestions, 13);
  assert.equal(p.overallAverage, 7);
  assert.equal(p.bestScore, 8);
  assert.equal(p.hintsPerQuestion, 0.2);
  assert.deepEqual(p.byMode.dsa, { sessions: 2, questions: 10, averageScore: 7 });
  assert.deepEqual(p.byMode.behavioral, { sessions: 1, questions: 3, averageScore: null });
});

test('computeProgress trend is chronological and improvement compares halves', () => {
  const list = [4, 5, 7, 9].map((score, i) => sum({ id: `s${i}`, averageScore: score, finishedAt: T0 + i * DAY }));
  const p = computeProgress([...list].reverse(), { now: T0 + 3 * DAY });
  assert.deepEqual(p.trend.map((t) => t.id), ['s0', 's1', 's2', 's3']);
  assert.equal(p.improvement, 3.5);
  assert.equal(computeProgress(list, { now: T0, trendLength: 2 }).trend.length, 2);
  assert.equal(computeProgress([list[0]], { now: T0 }).improvement, null);
});

test('computeProgress streak counts consecutive days and survives until tonight', () => {
  const days = (...offsets) => offsets.map((d) => sum({ finishedAt: T0 - d * DAY }));
  assert.equal(computeProgress(days(0, 1, 2), { now: T0 }).streakDays, 3);
  assert.equal(computeProgress(days(1, 2), { now: T0 }).streakDays, 2);
  assert.equal(computeProgress(days(2, 3), { now: T0 }).streakDays, 0);
  assert.equal(computeProgress(days(0, 2, 3), { now: T0 }).streakDays, 1);
  assert.equal(computeProgress([sum({ finishedAt: T0 }), sum({ finishedAt: T0 + 1000 })], { now: T0 + 2000 }).streakDays, 1);
});

test('computeProgress respects the local timezone for day boundaries', () => {
  const late = Date.UTC(2026, 0, 10, 23, 30); // 23:30 UTC
  const early = Date.UTC(2026, 0, 11, 0, 30); // 00:30 UTC next day
  const items = [sum({ finishedAt: late }), sum({ finishedAt: early })];
  assert.equal(computeProgress(items, { now: early, tzOffsetMinutes: 0 }).streakDays, 2);
  // UTC-5: both land on the same local day
  assert.equal(computeProgress(items, { now: early, tzOffsetMinutes: 300 }).streakDays, 1);
});

// ---- export ----

test('fenced picks a fence longer than any backtick run', () => {
  assert.equal(fenced('plain'), '```\nplain\n```');
  assert.equal(fenced('has ``` inside'), '````\nhas ``` inside\n````');
});

test('sessionToMarkdown renders the report, questions and feedback', () => {
  const md = sessionToMarkdown(snap());
  assert.match(md, /^# MockingBird interview report/);
  assert.match(md, /\*\*Type:\*\* Data structures & algorithms/);
  assert.match(md, /\*\*Average score:\*\* 8\/10/);
  assert.match(md, /## Question 1 \(8\/10\)/);
  assert.match(md, /## Question 2 \(skipped\)/);
  assert.match(md, /- think hash/);
  assert.match(md, /\*\*Strengths:\*\*\n\n- clear/);
  assert.match(md, /\*\*Follow-up question:\*\* Why O\(n\)\?/);
  assert.match(md, /Focus next on/);
  assert.match(md, /````\nuse ```a map```\n````/);
  assert.ok(md.endsWith('\n') && !md.endsWith('\n\n'));
});

test('sessionToMarkdown covers image-only answers and unscored sessions', () => {
  const s = snap({ mode: 'behavioral', language: null, role: '' });
  s.questions[0].answer = { text: '', imageCount: 1 };
  s.report = { ...s.report, averageScore: null };
  const md = sessionToMarkdown(s);
  assert.match(md, /1 image attachment/);
  assert.match(md, /\*\*Average score:\*\* n\/a/);
  assert.doesNotMatch(md, /\*\*Language:\*\*/);
  assert.throws(() => sessionToMarkdown(snap({ status: 'ready' })), /Only finished/);
  assert.throws(() => sessionToMarkdown(null), /Only finished/);
});

test('defaultExportName uses the date and mode', () => {
  assert.equal(defaultExportName(snap({ mode: 'sql' })), 'mockingbird-2026-01-10-sql.md');
});

// ---- service + ipc ----

function service(over = {}) {
  const store = new HistoryStore({ dir: tmp() });
  const written = [];
  const svc = new HistoryService({
    store,
    showSaveDialog: async () => ({ canceled: false, filePath: '/out/report.md' }),
    writeFile: async (...a) => { written.push(a); },
    now: () => T0,
    tzOffsetMinutes: () => 0,
    ...over,
  });
  return { svc, store, written };
}

test('service exports a saved session through the save dialog', async () => {
  const { svc, written } = service();
  const s = snap();
  svc.save(s);
  const res = await svc.exportSession(s.id);
  assert.deepEqual(res, { path: '/out/report.md' });
  assert.equal(written[0][0], '/out/report.md');
  assert.match(written[0][1], /MockingBird interview report/);
});

test('service export handles cancel and missing sessions', async () => {
  const s = snap();
  const { svc } = service({ showSaveDialog: async () => ({ canceled: true }) });
  svc.save(s);
  assert.deepEqual(await svc.exportSession(s.id), { canceled: true });
  await assert.rejects(svc.exportSession('missing-0001'), /not found/);
  const { svc: svc2, written } = service({ showSaveDialog: async () => undefined });
  svc2.save(s);
  assert.deepEqual(await svc2.exportSession(s.id), { canceled: true });
  assert.equal(written.length, 0);
});

test('service stats read from the store', () => {
  const { svc } = service();
  svc.save(snap({ finishedAt: T0 }));
  const p = svc.stats();
  assert.equal(p.sessions, 1);
  assert.equal(p.streakDays, 1);
});

test('history IPC handlers delegate to the service', async () => {
  const { svc } = service();
  const s = snap();
  svc.save(s);
  const handlers = new Map();
  registerIpc({ handle: (ch, fn) => handlers.set(ch, fn) }, { config: new Config({ env: {}, homeDir: '/h' }), appInfo: {}, history: svc });
  const h = (ch) => handlers.get(ch);
  assert.equal((await h(C.HISTORY_LIST)({}, { limit: 5 })).length, 1);
  assert.equal((await h(C.HISTORY_LIST)({}, 'junk')).length, 1);
  assert.equal((await h(C.HISTORY_GET)({}, s.id)).id, s.id);
  assert.equal((await h(C.HISTORY_STATS)()).sessions, 1);
  assert.deepEqual(await h(C.HISTORY_EXPORT)({}, s.id), { path: '/out/report.md' });
  assert.equal(await h(C.HISTORY_DELETE)({}, s.id), true);
  assert.equal(await h(C.HISTORY_CLEAR)(), 0);
});
