'use strict';

// Node side of the persistent Whisper process. The long-lived worker with a
// JSON-lines protocol and idle unloading follows the approach in OpenCluely's
// whisper-worker.service.js (Apache-2.0); rewritten with an injectable spawn.

const { EventEmitter } = require('node:events');
const childProcess = require('node:child_process');

class WhisperWorker extends EventEmitter {
  constructor({ pythonPath, scriptPath, spawn = childProcess.spawn, idleUnloadMs = 60000, requestTimeoutMs = 120000, logger = null }) {
    super();
    this.pythonPath = pythonPath;
    this.scriptPath = scriptPath;
    this.spawnFn = spawn;
    this.idleUnloadMs = idleUnloadMs;
    this.requestTimeoutMs = requestTimeoutMs;
    this.logger = logger;
    this.proc = null;
    this.buffer = '';
    this.stderrTail = '';
    this.pending = new Map();
    this.seq = 0;
    this.idleTimer = null;
  }

  _ensureProcess() {
    if (this.proc) return;
    const proc = this.spawnFn(this.pythonPath, [this.scriptPath], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.proc = proc;
    this.buffer = '';
    this.stderrTail = '';
    proc.stdout.on('data', (chunk) => this._onData(chunk));
    proc.stderr?.on('data', (chunk) => {
      this.stderrTail = (this.stderrTail + chunk.toString()).slice(-2000);
    });
    proc.on('error', (err) => this._fail(proc, new Error(`Could not start Whisper worker: ${err.message}`)));
    proc.on('exit', (code) => {
      const tail = this.stderrTail.trim().split('\n').pop();
      this._fail(proc, new Error(`Whisper worker exited (code ${code})${tail ? `: ${tail}` : ''}`));
    });
  }

  _onData(chunk) {
    this.buffer += chunk.toString();
    let idx;
    while ((idx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        this.logger?.warn('non-JSON line from whisper worker', line.slice(0, 120));
        continue;
      }
      this._onMessage(msg);
    }
  }

  _onMessage(msg) {
    if (msg.event === 'ready') {
      this.emit('ready', msg);
      return;
    }
    if (msg.event === 'fatal') {
      this._fail(this.proc, new Error(msg.error || 'Whisper worker failed to start'));
      return;
    }
    const entry = this.pending.get(msg.id);
    if (!entry) return;
    this.pending.delete(msg.id);
    clearTimeout(entry.timer);
    if (msg.ok) entry.resolve(msg);
    else entry.reject(new Error(msg.error || 'Whisper worker error'));
  }

  _fail(proc, error) {
    if (proc && this.proc === proc) this.proc = null;
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
      this.pending.delete(id);
    }
  }

  _clearIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  _scheduleIdleUnload() {
    this._clearIdle();
    if (!this.idleUnloadMs) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.proc && this.pending.size === 0) this.request({ action: 'unload' }).catch(() => {});
    }, this.idleUnloadMs);
    this.idleTimer.unref?.();
  }

  request(payload) {
    this._ensureProcess();
    const id = (this.seq += 1);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Whisper request timed out after ${this.requestTimeoutMs}ms`));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.proc.stdin.write(`${JSON.stringify({ id, ...payload })}\n`);
      } catch (err) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(err);
      }
    });
  }

  async transcribe(audioPath, { model = 'small', language = 'auto', modelDir = null, device = 'auto' } = {}) {
    this._clearIdle();
    try {
      return await this.request({ action: 'transcribe', audio_path: audioPath, model, language, model_dir: modelDir, device });
    } finally {
      this._scheduleIdleUnload();
    }
  }

  warmup({ model = 'small', modelDir = null, device = 'auto' } = {}) {
    this._clearIdle();
    return this.request({ action: 'warmup', model, model_dir: modelDir, device }).finally(() => this._scheduleIdleUnload());
  }

  async close() {
    this._clearIdle();
    const proc = this.proc;
    if (!proc) return;
    try {
      await this.request({ action: 'shutdown' });
    } catch {
      // the process may already be gone
    }
    if (this.proc === proc) {
      proc.kill?.();
      this.proc = null;
    }
  }
}

module.exports = { WhisperWorker };
