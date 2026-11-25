'use strict';

// Pause-based utterance segmentation. The idea (flush on speaker pauses instead of
// a fixed timer, with pre-roll and a hard cap) follows OpenCluely's speech service
// (Apache-2.0); this is a separate implementation that works on raw PCM16 frames.

const { BYTES_PER_SAMPLE, rmsPcm16 } = require('./pcm');

const DEFAULTS = Object.freeze({
  sampleRate: 16000,
  frameMs: 20,
  silenceHangoverMs: 700,
  minUtteranceMs: 350,
  maxUtteranceMs: 15000,
  preRollMs: 300,
  energyFloor: 0.008,
  noiseMultiplier: 3,
});

class UtteranceSegmenter {
  constructor(options = {}) {
    this.o = { ...DEFAULTS, ...options };
    this.frameBytes = Math.round((this.o.sampleRate * this.o.frameMs) / 1000) * BYTES_PER_SAMPLE;
    this.pending = Buffer.alloc(0);
    this.noiseFloor = this.o.energyFloor / 2;
    this._resetUtterance();
    this.preRoll = [];
    this.preRollFrames = Math.max(0, Math.round(this.o.preRollMs / this.o.frameMs));
  }

  _resetUtterance() {
    this.speaking = false;
    this.frames = [];
    this.speechMs = 0;
    this.silenceMs = 0;
    this.totalMs = 0;
  }

  get threshold() {
    return Math.max(this.o.energyFloor, this.noiseFloor * this.o.noiseMultiplier);
  }

  /** Feed any amount of PCM16 audio; returns the utterances (Buffers) completed by it. */
  push(chunk) {
    const out = [];
    this.pending = Buffer.concat([this.pending, chunk]);
    while (this.pending.length >= this.frameBytes) {
      const frame = this.pending.subarray(0, this.frameBytes);
      this.pending = this.pending.subarray(this.frameBytes);
      const utterance = this._frame(Buffer.from(frame));
      if (utterance) out.push(utterance);
    }
    return out;
  }

  _frame(frame) {
    const energy = rmsPcm16(frame);
    const loud = energy > this.threshold;
    const ms = this.o.frameMs;

    if (!this.speaking) {
      if (!loud) {
        this.noiseFloor = this.noiseFloor * 0.95 + energy * 0.05;
        this.preRoll.push(frame);
        if (this.preRoll.length > this.preRollFrames) this.preRoll.shift();
        return null;
      }
      this.speaking = true;
      this.frames = [...this.preRoll, frame];
      this.totalMs = this.frames.length * ms;
      this.preRoll = [];
      this.speechMs = ms;
      this.silenceMs = 0;
      return null;
    }

    this.frames.push(frame);
    this.totalMs += ms;
    if (loud) {
      this.speechMs += ms;
      this.silenceMs = 0;
    } else {
      this.silenceMs += ms;
    }

    if (this.silenceMs >= this.o.silenceHangoverMs || this.totalMs >= this.o.maxUtteranceMs) {
      return this._finish();
    }
    return null;
  }

  _finish() {
    const keep = this.speechMs >= this.o.minUtteranceMs ? Buffer.concat(this.frames) : null;
    this._resetUtterance();
    return keep;
  }

  /** Emit any speech still in progress (call when capture stops). */
  flush() {
    this.pending = Buffer.alloc(0);
    if (!this.speaking) return null;
    return this._finish();
  }

  reset() {
    this.pending = Buffer.alloc(0);
    this.preRoll = [];
    this._resetUtterance();
  }
}

module.exports = { UtteranceSegmenter, DEFAULTS };
