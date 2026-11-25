const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { WhisperWorker } = require('../src/main/voice/whisper-worker');
const { VoiceController } = require('../src/main/voice/voice-controller');
const { resolvePython } = require('../src/main/voice/python-env');
const { installMediaHandlers } = require('../src/main/media');
const { tone, silence } = require('./helpers/audio');

function fakeSpawn(handler, { emitReady = true } = {}) {
  const spawned = [];
  const spawn = (cmd, args) => {
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.killed = false;
    proc.kill = () => { proc.killed = true; };
    proc.written = [];
    proc.reply = (obj) => proc.stdout.emit('data', Buffer.from(`${JSON.stringify(obj)}\n`));
    proc.stdin = {
      write(line) {
        const req = JSON.parse(line);
        proc.written.push(req);
        setImmediate(() => handler(req, proc));
      },
    };
    proc.cmd = cmd;
    proc.args = args;
    spawned.push(proc);
    if (emitReady) setImmediate(() => proc.reply({ event: 'ready' }));
    return proc;
  };
  spawn.spawned = spawned;
  return spawn;
}

const okHandler = (req, proc) => proc.reply({ id: req.id, ok: true, text: 'hello world', language: 'en', device: 'cpu' });
const mkWorker = (spawn, extra = {}) => new WhisperWorker({ pythonPath: 'py', scriptPath: 'w.py', spawn, idleUnloadMs: 0, ...extra });

test('worker spawns python with the script and resolves transcribe replies', async () => {
  const spawn = fakeSpawn(okHandler);
  const w = mkWorker(spawn);
  const res = await w.transcribe('/tmp/a.wav', { model: 'tiny', language: 'en' });
  assert.equal(res.text, 'hello world');
  const proc = spawn.spawned[0];
  assert.equal(proc.cmd, 'py');
  assert.deepEqual(proc.args, ['w.py']);
  assert.deepEqual(proc.written[0], { id: 1, action: 'transcribe', audio_path: '/tmp/a.wav', model: 'tiny', language: 'en', model_dir: null, device: 'auto' });
});

test('worker reuses one process across requests and matches replies by id', async () => {
  const spawn = fakeSpawn((req, proc) => {
    const delay = req.id === 1 ? 20 : 0;
    setTimeout(() => proc.reply({ id: req.id, ok: true, text: `t${req.id}` }), delay);
  });
  const w = mkWorker(spawn);
  const [a, b] = await Promise.all([w.transcribe('a.wav'), w.transcribe('b.wav')]);
  assert.deepEqual([a.text, b.text], ['t1', 't2']);
  assert.equal(spawn.spawned.length, 1);
});

test('worker rejects with the worker error message when ok is false', async () => {
  const w = mkWorker(fakeSpawn((req, proc) => proc.reply({ id: req.id, ok: false, error: 'CUDA requested' })));
  await assert.rejects(w.transcribe('a.wav'), /CUDA requested/);
});

test('worker handles replies split across chunks and ignores junk lines', async () => {
  const w = mkWorker(fakeSpawn((req, proc) => {
    proc.stdout.emit('data', Buffer.from('not json\n'));
    const line = JSON.stringify({ id: req.id, ok: true, text: 'split' });
    proc.stdout.emit('data', Buffer.from(line.slice(0, 10)));
    proc.stdout.emit('data', Buffer.from(`${line.slice(10)}\n`));
  }));
  assert.equal((await w.transcribe('a.wav')).text, 'split');
});

test('worker fails pending requests when the process exits, then respawns', async () => {
  let n = 0;
  const spawn = fakeSpawn((req, proc) => {
    n += 1;
    if (n === 1) {
      proc.stderr.emit('data', Buffer.from('Traceback\nImportError: no whisper'));
      proc.emit('exit', 1);
    } else proc.reply({ id: req.id, ok: true, text: 'back' });
  });
  const w = mkWorker(spawn);
  await assert.rejects(w.transcribe('a.wav'), /exited \(code 1\).*no whisper/);
  assert.equal((await w.transcribe('a.wav')).text, 'back');
  assert.equal(spawn.spawned.length, 2);
});

test('worker surfaces spawn errors and fatal startup messages', async () => {
  const w1 = mkWorker(fakeSpawn((req, proc) => proc.emit('error', new Error('ENOENT')), { emitReady: false }));
  await assert.rejects(w1.transcribe('a.wav'), /Could not start Whisper worker: ENOENT/);
  const w2 = mkWorker(fakeSpawn(() => {}, { emitReady: false }));
  const p = w2.transcribe('a.wav');
  setImmediate(() => w2.proc.reply({ event: 'fatal', error: 'Missing Python package: whisper' }));
  await assert.rejects(p, /Missing Python package: whisper/);
});

test('worker times out a silent process', async () => {
  const w = mkWorker(fakeSpawn(() => {}), { requestTimeoutMs: 30 });
  await assert.rejects(w.transcribe('a.wav'), /timed out/);
});

test('worker unloads the model after the idle period', async () => {
  const spawn = fakeSpawn(okHandler);
  const w = mkWorker(spawn, { idleUnloadMs: 20 });
  await w.transcribe('a.wav');
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(spawn.spawned[0].written.at(-1).action, 'unload');
  await w.close();
});

test('worker close sends shutdown and clears the process', async () => {
  const spawn = fakeSpawn(okHandler);
  const w = mkWorker(spawn);
  await w.warmup();
  await w.close();
  assert.equal(spawn.spawned[0].written.at(-1).action, 'shutdown');
  assert.equal(w.proc, null);
  await w.close();
});

// ---- controller ----

function fakeWorker(textFor = () => 'what is a hash map') {
  const calls = [];
  return {
    calls,
    async transcribe(file, opts) {
      calls.push({ file, opts, existed: fs.existsSync(file), size: fs.existsSync(file) ? fs.statSync(file).size : 0 });
      return { text: textFor(calls.length), language: 'en' };
    },
  };
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mb-voice-'));

test('controller (vad) transcribes each utterance and cleans up temp files', async () => {
  const dir = tmp();
  const worker = fakeWorker();
  const vc = new VoiceController({ worker, tmpDir: dir });
  const seen = [];
  vc.on('transcript', (t) => seen.push(t));
  vc.start({ mode: 'vad' });
  vc.pushFrame(Buffer.concat([tone(700), silence(900), tone(700), silence(900)]));
  await vc.stop();
  assert.equal(seen.length, 2);
  assert.equal(seen[0].text, 'what is a hash map');
  assert.ok(seen[0].durationMs >= 700);
  assert.equal(worker.calls.length, 2);
  assert.ok(worker.calls.every((c) => c.existed && c.size > 44));
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('controller (manual) sends everything between start and stop as one utterance', async () => {
  const worker = fakeWorker();
  const vc = new VoiceController({ worker, tmpDir: tmp() });
  vc.start({ mode: 'manual' });
  vc.pushFrame(tone(500));
  vc.pushFrame(silence(1500));
  vc.pushFrame(tone(500));
  assert.equal(worker.calls.length, 0);
  await vc.stop();
  assert.equal(worker.calls.length, 1);
  assert.ok(worker.calls[0].size > 44 + 32000 * 2);
});

test('controller (manual) auto-stops at the max duration', async () => {
  const worker = fakeWorker();
  const vc = new VoiceController({ worker, tmpDir: tmp(), settings: { manualMaxMs: 1000 } });
  const states = [];
  vc.on('status', (s) => states.push(s.state));
  vc.start({ mode: 'manual' });
  vc.pushFrame(tone(1200));
  await vc.queue;
  assert.equal(vc.state, 'idle');
  assert.deepEqual(states, ['listening', 'idle']);
  assert.equal(worker.calls.length, 1);
});

test('controller drops hallucinated transcripts and reports worker failures without dying', async () => {
  let n = 0;
  const worker = {
    async transcribe() {
      n += 1;
      if (n === 1) return { text: 'Thank you.' };
      if (n === 2) throw new Error('worker down');
      return { text: 'real words here' };
    },
  };
  const vc = new VoiceController({ worker, tmpDir: tmp() });
  const texts = [];
  const errors = [];
  vc.on('transcript', (t) => texts.push(t.text));
  vc.on('error', (e) => errors.push(e.message));
  vc.start({ mode: 'vad' });
  for (let i = 0; i < 3; i += 1) vc.pushFrame(Buffer.concat([tone(600), silence(900)]));
  await vc.stop();
  assert.deepEqual(texts, ['real words here']);
  assert.deepEqual(errors, ['worker down']);
});

test('controller state rules', async () => {
  const vc = new VoiceController({ worker: fakeWorker(), tmpDir: tmp() });
  assert.throws(() => vc.start({ mode: 'bogus' }), /Unknown capture mode/);
  vc.pushFrame(tone(100));
  vc.start();
  assert.throws(() => vc.start(), /Already listening/);
  vc.pushFrame('not a buffer');
  vc.pushFrame(Buffer.alloc(0));
  await vc.stop();
  await vc.stop();
  assert.equal(vc.state, 'idle');
});

test('controller ignores a manual recording shorter than the minimum', async () => {
  const worker = fakeWorker();
  const vc = new VoiceController({ worker, tmpDir: tmp() });
  vc.start({ mode: 'manual' });
  vc.pushFrame(tone(100));
  await vc.stop();
  assert.equal(worker.calls.length, 0);
});

test('controller passes model settings to the worker', async () => {
  const worker = fakeWorker();
  const vc = new VoiceController({ worker, tmpDir: tmp(), settings: { model: 'base', language: 'en', device: 'cpu', modelDir: '/m' } });
  vc.start({ mode: 'manual' });
  vc.pushFrame(tone(600));
  await vc.stop();
  assert.deepEqual(worker.calls[0].opts, { model: 'base', language: 'en', modelDir: '/m', device: 'cpu' });
});

// ---- python + media ----

test('resolvePython prefers config, then env, then a data-dir venv, then the system python', () => {
  assert.deepEqual(resolvePython({ configured: '/x/python', env: {} }), { path: '/x/python', source: 'config' });
  assert.deepEqual(resolvePython({ env: { WHISPER_PYTHON: '/e/py' } }), { path: '/e/py', source: 'env' });
  const venv = resolvePython({ env: {}, dataDir: '/d', platform: 'win32', exists: () => true });
  assert.equal(venv.source, 'venv');
  assert.match(venv.path, /Scripts[\\/]python\.exe$/);
  assert.match(resolvePython({ env: {}, dataDir: '/d', platform: 'linux', exists: () => true }).path, /bin[\\/]python$/);
  assert.deepEqual(resolvePython({ env: {}, dataDir: '/d', platform: 'win32', exists: () => false }), { path: 'python', source: 'system' });
  assert.deepEqual(resolvePython({ env: {}, platform: 'darwin' }), { path: 'python3', source: 'system' });
});

function fakeSession() {
  const s = { perms: null, check: null, display: null };
  s.setPermissionRequestHandler = (fn) => { s.perms = fn; };
  s.setPermissionCheckHandler = (fn) => { s.check = fn; };
  s.setDisplayMediaRequestHandler = (fn) => { s.display = fn; };
  return s;
}

test('media permissions: only the app itself may use the microphone', () => {
  const s = fakeSession();
  installMediaHandlers(s, { desktopCapturer: {}, platform: 'linux' });
  const ask = (permission, url) => { let r; s.perms({ getURL: () => url }, permission, (v) => { r = v; }, { requestingUrl: url }); return r; };
  assert.equal(ask('media', 'file:///app/index.html'), true);
  assert.equal(ask('media', 'https://evil.example'), false);
  assert.equal(ask('geolocation', 'file:///app/index.html'), false);
  assert.equal(s.check({}, 'media', 'file://'), true);
  assert.equal(s.check({}, 'notifications', 'file://'), false);
  assert.equal(s.display, null);
});

test('media: loopback system audio is offered on Windows only', async () => {
  const s = fakeSession();
  installMediaHandlers(s, { desktopCapturer: { getSources: async () => [{ id: 'screen:1:0' }] }, platform: 'win32' });
  let got;
  await s.display({}, (v) => { got = v; });
  assert.deepEqual(got, { video: { id: 'screen:1:0' }, audio: 'loopback' });
  const s2 = fakeSession();
  installMediaHandlers(s2, { desktopCapturer: { getSources: async () => [] }, platform: 'win32' });
  await s2.display({}, (v) => { got = v; });
  assert.deepEqual(got, {});
  const s3 = fakeSession();
  installMediaHandlers(s3, { desktopCapturer: { getSources: async () => { throw new Error('x'); } }, platform: 'win32' });
  await s3.display({}, (v) => { got = v; });
  assert.deepEqual(got, {});
});
