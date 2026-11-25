'use strict';

const RATE = 16000;

/** PCM16 sine tone. amplitude 0..1 of full scale. */
function tone(ms, amplitude = 0.3, freq = 440) {
  const n = Math.round((RATE * ms) / 1000);
  const buf = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i += 1) {
    buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / RATE) * amplitude * 32767), i * 2);
  }
  return buf;
}

function silence(ms) {
  return Buffer.alloc(Math.round((RATE * ms) / 1000) * 2);
}

module.exports = { RATE, tone, silence };
