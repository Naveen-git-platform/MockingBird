'use strict';

const crypto = require('node:crypto');
const { resolveMode } = require('../modes/modes');
const { resolveLanguage } = require('../modes/languages');
const { DIFFICULTIES, INTERVIEW_MODES, HINT_LEVELS, persona, questionPrompt, evaluationPrompt, hintPrompt, summaryPrompt } = require('./prompts');
const { extractJson } = require('./json');
const { normalizeEvaluation, normalizeSummary } = require('./evaluation');

const MAX_HINTS = HINT_LEVELS.length;

/**
 * One mock interview: the AI asks questions, scores the candidate's answers, gives
 * progressive hints on request, and produces a final report.
 *
 * status: ready -> awaiting_answer -> evaluated -> (awaiting_answer ...) -> finished
 */
class InterviewSession {
  constructor({ llm, mode = 'dsa', language = 'python', difficulty = 'medium', role = '', questionCount = 5, clock = Date.now, id = crypto.randomUUID() }) {
    if (!INTERVIEW_MODES.includes(mode)) throw new Error(`Unsupported interview type: ${mode}`);
    if (!DIFFICULTIES.includes(difficulty)) throw new Error(`Unknown difficulty: ${difficulty}`);
    if (!Number.isInteger(questionCount) || questionCount < 1 || questionCount > 20) {
      throw new Error('questionCount must be a whole number from 1 to 20');
    }
    let lang = null;
    if (resolveMode(mode).needsLanguage) {
      lang = resolveLanguage(language);
      if (!lang) throw new Error(`Unknown language: ${language}`);
    }
    this.llm = llm;
    this.clock = clock;
    this.id = id;
    this.mode = mode;
    this.language = lang ? lang.id : null;
    this.difficulty = difficulty;
    this.role = String(role || '').trim().slice(0, 120);
    this.questionCount = questionCount;
    this.status = 'ready';
    this.questions = [];
    this.report = null;
    this.startedAt = null;
    this.finishedAt = null;
    this.busy = false;
  }

  get current() {
    return this.questions[this.questions.length - 1] || null;
  }

  get hasNext() {
    return this.questions.length < this.questionCount;
  }

  _system() {
    return persona({ mode: this.mode, language: this.language, difficulty: this.difficulty, role: this.role });
  }

  async _exclusive(fn) {
    if (this.busy) throw new Error('Another step is still running');
    this.busy = true;
    try {
      return await fn();
    } finally {
      this.busy = false;
    }
  }

  _expect(...statuses) {
    if (!statuses.includes(this.status)) throw new Error(`Not allowed while the interview is ${this.status}`);
  }

  async _ask(onDelta) {
    const asked = this.questions.map((q) => q.text);
    const { text } = await this.llm.generate(
      {
        system: this._system(),
        messages: [{ role: 'user', content: questionPrompt({ asked, index: this.questions.length, total: this.questionCount }) }],
        maxTokens: 900,
        temperature: 0.8,
      },
      { onDelta }
    );
    const question = text.trim();
    if (!question) throw new Error('The model returned an empty question');
    this.questions.push({
      index: this.questions.length,
      text: question,
      hints: [],
      answer: null,
      evaluation: null,
      skipped: false,
      askedAt: this.clock(),
      answeredAt: null,
    });
    this.status = 'awaiting_answer';
    return this.current;
  }

  start({ onDelta } = {}) {
    return this._exclusive(async () => {
      this._expect('ready');
      const q = await this._ask(onDelta);
      this.startedAt = this.clock();
      return q;
    });
  }

  next({ onDelta } = {}) {
    return this._exclusive(async () => {
      this._expect('evaluated');
      if (!this.hasNext) throw new Error('That was the last question: finish the interview');
      return this._ask(onDelta);
    });
  }

  /** Score an answer. `input` is `{ text, images }` as produced by normalizeInput. */
  submitAnswer(input) {
    return this._exclusive(async () => {
      this._expect('awaiting_answer');
      const text = (input?.text || '').trim();
      const images = input?.images || [];
      if (!text && images.length === 0) throw new Error('Type or attach an answer first');

      const q = this.current;
      const content = [{ type: 'text', text: `${evaluationPrompt({ question: q.text })}\n\nCandidate answer:\n${text || '(see attached image)'}` }];
      for (const img of images) content.push({ type: 'image', mimeType: img.mimeType, data: img.data });
      const evaluation = await this._evaluate(content);

      q.answer = { text, imageCount: images.length };
      q.evaluation = evaluation;
      q.answeredAt = this.clock();
      this.status = 'evaluated';
      return evaluation;
    });
  }

  async _evaluate(content) {
    const base = { system: this._system(), maxTokens: 900, temperature: 0.2 };
    const messages = [{ role: 'user', content }];
    const first = await this.llm.generate({ ...base, messages });
    try {
      return normalizeEvaluation(extractJson(first.text));
    } catch {
      const retry = await this.llm.generate({
        ...base,
        messages: [
          ...messages,
          { role: 'assistant', content: first.text || '(empty)' },
          { role: 'user', content: 'That was not valid. Reply with ONLY the JSON object described above, with a numeric "score".' },
        ],
      });
      try {
        return normalizeEvaluation(extractJson(retry.text));
      } catch {
        throw new Error('Could not read the AI feedback. Try submitting again.');
      }
    }
  }

  requestHint({ onDelta } = {}) {
    return this._exclusive(async () => {
      this._expect('awaiting_answer');
      const q = this.current;
      if (q.hints.length >= MAX_HINTS) throw new Error('No more hints for this question');
      const level = q.hints.length + 1;
      const { text } = await this.llm.generate(
        {
          system: this._system(),
          messages: [{ role: 'user', content: hintPrompt({ question: q.text, level, previousHints: q.hints }) }],
          maxTokens: 500,
          temperature: 0.4,
        },
        { onDelta }
      );
      const hint = text.trim();
      if (!hint) throw new Error('The model returned an empty hint');
      q.hints.push(hint);
      return { level, text: hint, remaining: MAX_HINTS - level };
    });
  }

  skip() {
    this._expect('awaiting_answer');
    const q = this.current;
    q.skipped = true;
    q.answeredAt = this.clock();
    this.status = 'evaluated';
    return q;
  }

  finish() {
    return this._exclusive(async () => {
      this._expect('awaiting_answer', 'evaluated');
      if (this.status === 'awaiting_answer') {
        const q = this.current;
        q.skipped = true;
        q.answeredAt = this.clock();
      }
      this.report = await this._buildReport();
      this.status = 'finished';
      this.finishedAt = this.clock();
      return this.report;
    });
  }

  async _buildReport() {
    const scored = this.questions.filter((q) => q.evaluation);
    const scores = scored.map((q) => q.evaluation.score);
    const averageScore = scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : null;
    const byScore = [...scored].sort((a, b) => b.evaluation.score - a.evaluation.score);
    const stats = {
      questionsAsked: this.questions.length,
      questionsAnswered: scored.length,
      questionsSkipped: this.questions.filter((q) => q.skipped).length,
      hintsUsed: this.questions.reduce((n, q) => n + q.hints.length, 0),
      averageScore,
      bestQuestion: byScore.length ? byScore[0].index : null,
      weakestQuestion: byScore.length ? byScore[byScore.length - 1].index : null,
      perQuestion: this.questions.map((q) => ({ index: q.index, score: q.evaluation ? q.evaluation.score : null, hints: q.hints.length, skipped: q.skipped })),
    };

    let narrative = { summary: '', focusAreas: [] };
    if (scored.length) {
      const records = this.questions.map((q) => ({
        question: q.text,
        score: q.evaluation ? q.evaluation.score : null,
        skipped: q.skipped,
        hints: q.hints.length,
        improvements: q.evaluation ? q.evaluation.improvements : [],
      }));
      try {
        const { text } = await this.llm.generate({
          system: this._system(),
          messages: [{ role: 'user', content: summaryPrompt({ records }) }],
          maxTokens: 600,
          temperature: 0.3,
        });
        narrative = normalizeSummary(extractJson(text));
      } catch {
        narrative = { summary: `You answered ${scored.length} of ${this.questions.length} questions with an average score of ${averageScore}/10.`, focusAreas: [] };
      }
    } else {
      narrative = { summary: 'No questions were answered, so there is nothing to score yet.', focusAreas: [] };
    }
    return { ...stats, ...narrative };
  }

  snapshot() {
    return {
      id: this.id,
      mode: this.mode,
      language: this.language,
      difficulty: this.difficulty,
      role: this.role,
      questionCount: this.questionCount,
      status: this.status,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      hasNext: this.hasNext,
      questions: this.questions.map((q) => ({ ...q, hints: [...q.hints] })),
      report: this.report,
    };
  }
}

module.exports = { InterviewSession, MAX_HINTS };
