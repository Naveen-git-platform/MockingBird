'use strict';

// Whisper tends to invent stock phrases when it is given silence or noise.
const PHANTOM_PHRASES = new Set([
  'thank you',
  'thanks',
  'thanks for watching',
  'thank you for watching',
  'thank you so much for watching',
  'please subscribe',
  'subscribe to my channel',
  'like and subscribe',
  'bye',
  'bye bye',
  'goodbye',
  'you',
  'okay',
  'ok',
  'hmm',
  'um',
  'uh',
  'so',
]);

const PHANTOM_PATTERNS = [/subtitles? by/i, /amara\.org/i, /transcribed by/i, /^\[.*\]$/, /^\(.*\)$/, /^♪+$/];

function normalise(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when a word or short phrase repeats many times ("the the the the the"). */
function isRepetitionLoop(norm) {
  const words = norm.split(' ');
  if (words.length < 6) return false;
  const counts = new Map();
  for (const w of words) counts.set(w, (counts.get(w) || 0) + 1);
  const top = Math.max(...counts.values());
  return top / words.length >= 0.8;
}

/** Decide whether a transcript is likely a hallucination rather than real speech. */
function isHallucination(text) {
  if (typeof text !== 'string') return true;
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (PHANTOM_PATTERNS.some((re) => re.test(trimmed))) return true;
  const norm = normalise(trimmed);
  if (!norm) return true;
  if (PHANTOM_PHRASES.has(norm)) return true;
  return isRepetitionLoop(norm);
}

module.exports = { isHallucination };
