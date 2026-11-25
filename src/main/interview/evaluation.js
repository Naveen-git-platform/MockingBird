'use strict';

const MAX_ITEMS = 5;
const MAX_ITEM_CHARS = 400;

function cleanList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v) => typeof v === 'string' && v.trim())
    .map((v) => v.trim().slice(0, MAX_ITEM_CHARS))
    .slice(0, MAX_ITEMS);
}

/**
 * Validate and clamp a model-produced evaluation. Throws when the score is missing
 * or not a number, so the caller can ask the model again.
 */
function normalizeEvaluation(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Evaluation must be an object');
  const score = typeof raw.score === 'string' ? Number(raw.score) : raw.score;
  if (typeof score !== 'number' || !Number.isFinite(score)) throw new Error('Evaluation is missing a numeric score');
  return {
    score: Math.round(Math.max(0, Math.min(10, score)) * 10) / 10,
    summary: typeof raw.summary === 'string' ? raw.summary.trim().slice(0, 800) : '',
    strengths: cleanList(raw.strengths),
    improvements: cleanList(raw.improvements),
    followUp: typeof raw.followUp === 'string' && raw.followUp.trim() ? raw.followUp.trim().slice(0, 500) : null,
  };
}

function normalizeSummary(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Summary must be an object');
  return {
    summary: typeof raw.summary === 'string' ? raw.summary.trim().slice(0, 1200) : '',
    focusAreas: cleanList(raw.focusAreas),
  };
}

module.exports = { normalizeEvaluation, normalizeSummary };
