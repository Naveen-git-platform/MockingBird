'use strict';

/**
 * How much of the answer the trainer reveals. This is what makes MockingBird a
 * trainer instead of an answer machine: the default is "guided".
 */
const STYLES = Object.freeze({
  hints: {
    id: 'hints',
    label: 'Hints only',
    instruction:
      'Reveal as little as possible. Give at most three short hints that nudge the learner toward the idea, ordered from vague to specific. Do NOT write code or state the final algorithm. End by asking what they would try next.',
    maxTokens: 700,
  },
  guided: {
    id: 'guided',
    label: 'Guided approach',
    instruction:
      'Explain the approach step by step with reasoning and complexity, but do NOT give a complete implementation. You may show tiny illustrative snippets. End by inviting the learner to write the code and paste it for review.',
    maxTokens: 1500,
  },
  full: {
    id: 'full',
    label: 'Full solution',
    instruction:
      'Give the complete answer: the key insight, the approach, a clean implementation, a short dry run, and time and space complexity.',
    maxTokens: 3000,
  },
});

const DEFAULT_STYLE = 'guided';

function resolveStyle(id) {
  return STYLES[id] || null;
}

module.exports = { STYLES, DEFAULT_STYLE, resolveStyle };
