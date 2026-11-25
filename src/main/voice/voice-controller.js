'use strict';

const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { UtteranceSegmenter } = require('./vad');
const { pcm16ToWav, durationMs, bytesToMs } = require('./pcm');
const { isHallucination } = require('./hallucinations');

/**
 * Turns streamed PCM16 frames into transcripts.
 *   mode 'vad'    - utterances are cut on speaker pauses
 *   mode 'manual' - everything between start() and stop() is one utterance
 * Events: 'status' {state}, 'transcript' {text, durationMs, language}, 'error' Error
 */
class VoiceController extends EventEmitter {
  constructor({ worker, settings = {}, tmpDir = os.tmpdir(), fsImpl = fs, logger = null }) {
    super();
    this.worker = worker;
    this.settings = {
      sampleRate: 16000,
      model: 'small',
      language: 'auto',
      device: 'auto',
      modelDir: null,
      manualMaxMs: 90000,
      minUtteranceMs: 350,
      vad: {},
      ...settings,
    };
    this.tmpDir = tmpDir;
    this.fs = fsImpl;
    this.logger = logger;
    this.state = 'idle';
    this.mode = 'vad';
    this.segmenter = null;
    this.manual = [];
    this.manualBytes = 0;
    this.queue = Promise.resolve();
    this.counter = 0;
  }

  _setState(state) {
    this.state = state;
    this.emit('status', { state, mode: this.mode });
  }

  start({ mode = 'vad' } = {}) {
    if (mode !== 'vad' && mode !== 'manual') throw new Error(`Unknown capture mode: ${mode}`);
    if (this.state === 'listening') throw new Error('Already listening');
    this.mode = mode;
    this.manual = [];
    this.manualBytes = 0;
    this.segmenter = mode === 'vad' ? new UtteranceSegmenter({ sampleRate: this.settings.sampleRate, ...this.settings.vad }) : null;
    this._setState('listening');
  }

  pushFrame(pcm) {
    if (this.state !== 'listening' || !Buffer.isBuffer(pcm) || pcm.length === 0) return;
    if (this.mode === 'vad') {
      for (const utterance of this.segmenter.push(pcm)) this._enqueue(utterance);
      return;
    }
    this.manual.push(pcm);
    this.manualBytes += pcm.length;
    if (bytesToMs(this.manualBytes, this.settings.sampleRate) >= this.settings.manualMaxMs) {
      this.stop().catch(() => {});
    }
  }

  /** Stop listening, transcribe what is left, and resolve once the queue has drained. */
  async stop() {
    if (this.state !== 'listening') return this.queue;
    if (this.mode === 'vad') {
      const tail = this.segmenter.flush();
      if (tail) this._enqueue(tail);
    } else if (this.manualBytes > 0) {
      const all = Buffer.concat(this.manual);
      if (durationMs(all, this.settings.sampleRate) >= this.settings.minUtteranceMs) this._enqueue(all);
    }
    this.manual = [];
    this.manualBytes = 0;
    this._setState('idle');
    return this.queue;
  }

  _enqueue(pcm) {
    this.queue = this.queue.then(() => this._transcribe(pcm)).catch(() => {});
  }

  async _transcribe(pcm) {
    const file = path.join(this.tmpDir, `mockingbird-utt-${process.pid}-${Date.now()}-${(this.counter += 1)}.wav`);
    try {
      await this.fs.promises.writeFile(file, pcm16ToWav(pcm, this.settings.sampleRate));
      const result = await this.worker.transcribe(file, {
        model: this.settings.model,
        language: this.settings.language,
        modelDir: this.settings.modelDir,
        device: this.settings.device,
      });
      const text = (result.text || '').trim();
      if (isHallucination(text)) {
        this.logger?.debug('dropped likely hallucination', text.slice(0, 60));
        return;
      }
      this.emit('transcript', { text, durationMs: durationMs(pcm, this.settings.sampleRate), language: result.language || null });
    } catch (err) {
      this.logger?.error('transcription failed', err.message);
      this.emit('error', err);
    } finally {
      this.fs.promises.unlink(file).catch(() => {});
    }
  }
}

module.exports = { VoiceController };
