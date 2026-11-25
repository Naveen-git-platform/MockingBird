'use strict';

const { resolveMode } = require('../modes/modes');
const { resolveLanguage } = require('../modes/languages');

const DIFFICULTIES = Object.freeze(['easy', 'medium', 'hard']);
const INTERVIEW_MODES = Object.freeze(['dsa', 'system-design', 'behavioral', 'sql']);

function persona({ mode, language, difficulty, role }) {
  const m = resolveMode(mode);
  const lines = [
    'You are MockingBird, a professional technical interviewer running a realistic mock interview.',
    `Interview type: ${m.label}. Difficulty: ${difficulty}.`,
  ];
  if (role) lines.push(`The candidate is preparing for: ${role}.`);
  if (m.needsLanguage) {
    const lang = resolveLanguage(language);
    if (lang) lines.push(`The candidate codes in ${lang.label}; tag code blocks with \`\`\`${lang.fence}.`);
  }
  lines.push('Stay in the interviewer role. Be fair, specific and encouraging. Never reveal a full solution unless it is part of the requested feedback.');
  return lines.join('\n');
}

function questionPrompt({ asked, index, total }) {
  const history = asked.length ? `Questions already asked (do NOT repeat or closely rephrase these):\n${asked.map((q, i) => `${i + 1}. ${q}`).join('\n')}\n\n` : '';
  return `${history}Ask interview question ${index + 1} of ${total}. Output ONLY the question text in Markdown, with any constraints or examples the candidate needs. Do not include hints, solutions or commentary.`;
}

function evaluationPrompt({ question }) {
  return [
    'Evaluate the candidate answer to this interview question.',
    '',
    `Question:\n${question}`,
    '',
    'Respond with ONLY a JSON object, no prose and no code fences, with exactly these keys:',
    '{"score": number from 0 to 10, "summary": string (2-3 sentences), "strengths": string[] (up to 4), "improvements": string[] (up to 4, concrete and actionable), "followUp": string (one follow-up question an interviewer might ask)}',
    'Score honestly: 5 means partially correct, 8 or more means strong and complete. An empty or irrelevant answer scores 0 to 2.',
  ].join('\n');
}

const HINT_LEVELS = Object.freeze([
  'Give a very small nudge: name the general technique or the thing to think about. One or two sentences. No code, no algorithm.',
  'Give a more specific hint: describe the key insight or data structure, still without the full algorithm or code.',
  'Give the approach step by step in plain language, but still no complete code.',
]);

function hintPrompt({ question, level, previousHints }) {
  const prior = previousHints.length ? `Hints already given:\n${previousHints.map((h, i) => `${i + 1}. ${h}`).join('\n')}\n\n` : '';
  return `Question:\n${question}\n\n${prior}${HINT_LEVELS[level - 1]}`;
}

function summaryPrompt({ records }) {
  const body = records
    .map((r, i) => `${i + 1}. ${r.skipped ? '[skipped]' : `score ${r.score}/10`}, hints used: ${r.hints}. Question: ${r.question.slice(0, 160)}${r.improvements.length ? ` Weaknesses: ${r.improvements.join('; ')}` : ''}`)
    .join('\n');
  return [
    'Write a short end-of-interview report for the candidate based on these results:',
    body,
    '',
    'Respond with ONLY a JSON object: {"summary": string (3-4 sentences, encouraging but honest), "focusAreas": string[] (up to 4 topics to practise next)}',
  ].join('\n');
}

module.exports = { DIFFICULTIES, INTERVIEW_MODES, HINT_LEVELS, persona, questionPrompt, evaluationPrompt, hintPrompt, summaryPrompt };
