const test = require('node:test');
const assert = require('node:assert/strict');
const { rmsPcm16, pcm16ToWav, durationMs, bytesToMs } = require('../src/main/voice/pcm');
const { UtteranceSegmenter } = require('../src/main/voice/vad');
const { isHallucination } = require('../src/main/voice/hallucinations');
const { downsample, floatToInt16 } = require('../src/renderer/pcm-convert');
const { tone, silence, RATE } = require('./helpers/audio');

test('rmsPcm16: silence is 0, loud tone is high, empty is 0', () => {
  assert.equal(rmsPcm16(silence(20)), 0);
  assert.equal(rmsPcm16(Buffer.alloc(0)), 0);
  const r = rmsPcm16(tone(20, 0.5));
  assert.ok(r > 0.3 && r < 0.4, String(r));
});

test('pcm16ToWav writes a valid 44-byte header', () => {
  const pcm = tone(100);
  const wav = pcm16ToWav(pcm, RATE);
  assert.equal(wav.length, 44 + pcm.length);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt16LE(20), 1);
  assert.equal(wav.readUInt32LE(24), RATE);
  assert.equal(wav.readUInt32LE(40), pcm.length);
  assert.equal(wav.readUInt32LE(4), 36 + pcm.length);
});

test('durationMs and bytesToMs agree', () => {
  assert.equal(durationMs(tone(250)), 250);
  assert.equal(bytesToMs(32000, 16000), 1000);
});

test('segmenter emits one utterance after speech then a pause', () => {
  const seg = new UtteranceSegmenter();
  const out = seg.push(Buffer.concat([silence(200), tone(800), silence(900)]));
  assert.equal(out.length, 1);
  const ms = durationMs(out[0]);
  assert.ok(ms >= 800 && ms <= 800 + 300 + 800, `utterance was ${ms}ms`);
});

test('segmenter keeps pre-roll audio before speech onset', () => {
  const seg = new UtteranceSegmenter({ preRollMs: 300 });
  const [u] = seg.push(Buffer.concat([silence(1000), tone(600), silence(800)]));
  // at least pre-roll (300) + speech (600)
  assert.ok(durationMs(u) >= 900, `utterance was ${durationMs(u)}ms`);
});

test('segmenter drops blips shorter than the minimum utterance', () => {
  const seg = new UtteranceSegmenter({ minUtteranceMs: 350 });
  assert.equal(seg.push(Buffer.concat([silence(200), tone(100), silence(1000)])).length, 0);
});

test('segmenter does not cut a sentence on a short pause', () => {
  const seg = new UtteranceSegmenter({ silenceHangoverMs: 700 });
  const out = seg.push(Buffer.concat([tone(500), silence(300), tone(500), silence(900)]));
  assert.equal(out.length, 1);
});

test('segmenter splits two utterances separated by a long pause', () => {
  const seg = new UtteranceSegmenter();
  const out = seg.push(Buffer.concat([tone(600), silence(900), tone(600), silence(900)]));
  assert.equal(out.length, 2);
});

test('segmenter force-flushes a long monologue at the cap and keeps going', () => {
  const seg = new UtteranceSegmenter({ maxUtteranceMs: 2000 });
  const out = seg.push(tone(5000));
  assert.ok(out.length >= 2, `got ${out.length}`);
  for (const u of out) assert.ok(durationMs(u) <= 2100);
});

test('segmenter accepts arbitrary chunk sizes', () => {
  const seg = new UtteranceSegmenter();
  const audio = Buffer.concat([silence(200), tone(800), silence(900)]);
  const out = [];
  for (let i = 0; i < audio.length; i += 333) out.push(...seg.push(audio.subarray(i, i + 333)));
  assert.equal(out.length, 1);
});

test('flush emits speech in progress; reset discards it', () => {
  const seg = new UtteranceSegmenter();
  seg.push(tone(600));
  assert.ok(seg.flush());
  assert.equal(seg.flush(), null);
  seg.push(tone(600));
  seg.reset();
  assert.equal(seg.flush(), null);
});

test('segmenter ignores quiet background noise below the energy floor', () => {
  const seg = new UtteranceSegmenter({ energyFloor: 0.02 });
  assert.equal(seg.push(Buffer.concat([tone(2000, 0.005), silence(500)])).length, 0);
});

test('isHallucination flags stock phantom phrases and junk', () => {
  for (const t of ['', '   ', 'Thank you.', 'Thanks for watching!', 'Subtitles by the Amara.org community', '[Music]', '(silence)', '♪♪', 'you', 'the the the the the the the']) {
    assert.equal(isHallucination(t), true, JSON.stringify(t));
  }
  assert.equal(isHallucination(null), true);
});

test('isHallucination keeps real interview speech', () => {
  for (const t of ['Given an array of integers, return the indices of two numbers that add up to a target.', 'Tell me about a time you led a project', 'Thank you for the explanation, can you show the time complexity?']) {
    assert.equal(isHallucination(t), false, t);
  }
});

test('floatToInt16 clamps and scales', () => {
  const out = floatToInt16(Float32Array.from([0, 1, -1, 2, -2, 0.5]));
  assert.deepEqual(Array.from(out), [0, 32767, -32768, 32767, -32768, 16383]);
});

test('downsample reduces length by the rate ratio and rejects upsampling', () => {
  const input = Float32Array.from({ length: 480 }, (_, i) => i / 480);
  const out = downsample(input, 48000, 16000);
  assert.equal(out.length, 160);
  assert.ok(Math.abs(out[1] - input[3]) < 1e-6);
  assert.equal(downsample(input, 16000, 16000), input);
  assert.throws(() => downsample(input, 8000, 16000), /upsample/);
});
