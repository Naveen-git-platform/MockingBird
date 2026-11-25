'use strict';

const BYTES_PER_SAMPLE = 2;

/** Root-mean-square energy of little-endian PCM16 audio, normalised to 0..1. */
function rmsPcm16(buf) {
  const n = Math.floor(buf.length / BYTES_PER_SAMPLE);
  if (n === 0) return 0;
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    const s = buf.readInt16LE(i * BYTES_PER_SAMPLE) / 32768;
    sum += s * s;
  }
  return Math.sqrt(sum / n);
}

/** Wrap mono PCM16 samples in a WAV container. */
function pcm16ToWav(pcm, sampleRate = 16000, channels = 1) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * channels * BYTES_PER_SAMPLE, 28);
  header.writeUInt16LE(channels * BYTES_PER_SAMPLE, 32);
  header.writeUInt16LE(8 * BYTES_PER_SAMPLE, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function bytesToMs(bytes, sampleRate = 16000) {
  return Math.round((bytes / BYTES_PER_SAMPLE / sampleRate) * 1000);
}

function durationMs(pcm, sampleRate = 16000) {
  return bytesToMs(pcm.length, sampleRate);
}

module.exports = { BYTES_PER_SAMPLE, rmsPcm16, pcm16ToWav, durationMs, bytesToMs };
