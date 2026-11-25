const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createLogger } = require('../src/shared/logger');

function fakeSink() {
  const lines = [];
  const push = (l) => lines.push(l);
  return { lines, log: push, info: push, warn: push, error: push };
}
const fixed = () => new Date('2026-01-02T03:04:05.000Z');

test('respects the level threshold', () => {
  const sink = fakeSink();
  const log = createLogger({ level: 'warn', sink, clock: fixed });
  log.info('hidden');
  log.warn('shown');
  assert.equal(sink.lines.length, 1);
  assert.match(sink.lines[0], /WARN \[app\] shown/);
});

test('appends serialised metadata', () => {
  const sink = fakeSink();
  createLogger({ sink, clock: fixed }).info('hello', { a: 1 });
  assert.match(sink.lines[0], /hello \{"a":1\}$/);
});

test('survives circular metadata', () => {
  const sink = fakeSink();
  const circ = {};
  circ.self = circ;
  createLogger({ sink, clock: fixed }).info('x', circ);
  assert.match(sink.lines[0], /unserialisable/);
});

test('child loggers extend the scope', () => {
  const sink = fakeSink();
  createLogger({ scope: 'main', sink, clock: fixed }).child('llm').info('hi');
  assert.match(sink.lines[0], /\[main:llm\]/);
});

test('writes a per-day log file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mb-log-'));
  createLogger({ sink: null, logDir: dir, clock: fixed }).info('to file');
  const content = fs.readFileSync(path.join(dir, 'mockingbird-2026-01-02.log'), 'utf8');
  assert.match(content, /to file/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an unwritable log dir never throws', () => {
  const blocker = path.join(os.tmpdir(), `mb-blocker-${Date.now()}`);
  fs.writeFileSync(blocker, 'file');
  assert.doesNotThrow(() => createLogger({ sink: null, logDir: path.join(blocker, 'sub') }).error('boom'));
  fs.rmSync(blocker, { force: true });
});
