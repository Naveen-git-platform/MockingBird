'use strict';

const { InterviewSession } = require('./session');

/** Holds the single active interview and exposes the operations the UI calls. */
class InterviewManager {
  constructor({ llm, defaults = {}, onFinished = null, clock = Date.now }) {
    this.llm = llm;
    this.defaults = defaults;
    this.onFinished = onFinished;
    this.clock = clock;
    this.session = null;
  }

  _require() {
    if (!this.session) throw new Error('No interview in progress');
    return this.session;
  }

  async start(options = {}, hooks = {}) {
    if (this.session && this.session.status !== 'finished') {
      throw new Error('An interview is already in progress: finish it first');
    }
    const session = new InterviewSession({ ...this.defaults, ...options, llm: this.llm, clock: this.clock });
    await session.start(hooks);
    this.session = session;
    return session.snapshot();
  }

  async answer(input) {
    const session = this._require();
    const evaluation = await session.submitAnswer(input);
    return { evaluation, state: session.snapshot() };
  }

  async hint(hooks = {}) {
    const session = this._require();
    const hint = await session.requestHint(hooks);
    return { hint, state: session.snapshot() };
  }

  skip() {
    const session = this._require();
    session.skip();
    return session.snapshot();
  }

  async next(hooks = {}) {
    const session = this._require();
    await session.next(hooks);
    return session.snapshot();
  }

  async finish() {
    const session = this._require();
    await session.finish();
    const snapshot = session.snapshot();
    if (this.onFinished) {
      try {
        await this.onFinished(snapshot);
      } catch {
        // saving history must never block showing the report
      }
    }
    return snapshot;
  }

  state() {
    return this.session ? this.session.snapshot() : null;
  }

  /** Abandon the current interview without a report. */
  discard() {
    this.session = null;
  }
}

module.exports = { InterviewManager };
