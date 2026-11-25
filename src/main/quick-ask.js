'use strict';

const DEFAULT_PROMPT =
  'Here is a screenshot of my screen. If it shows an interview question or a coding problem, answer it. Otherwise briefly describe what you see.';

/**
 * Capture the screen and ask about it in one step (used by the capture shortcut).
 * The answer is delivered through the AnswerSink like any other answer.
 */
class QuickAsk {
  constructor({ capture, practice, answers, logger = null, prompt = DEFAULT_PROMPT }) {
    this.capture = capture;
    this.practice = practice;
    this.answers = answers;
    this.logger = logger;
    this.prompt = prompt;
    this.busy = false;
  }

  /** Never throws: failures are shown to the user as the answer. */
  async run() {
    if (this.busy) return { skipped: 'busy' };
    this.busy = true;
    try {
      let image;
      try {
        image = await this.capture.captureScreen();
      } catch (err) {
        this.answers.begin({ question: 'Screen capture' });
        this.answers.end({ error: `Could not capture the screen: ${err.message}` });
        return { error: err.message };
      }
      const { routed } = this.answers.begin({
        question: this.prompt,
        images: [`data:${image.mimeType};base64,${image.data}`],
      });
      try {
        const result = await this.practice.ask({ text: this.prompt, images: [image] }, {}, { onDelta: (t) => this.answers.delta(t) });
        this.answers.end({ text: result.text });
        return { text: result.text, routed };
      } catch (err) {
        this.logger?.warn('quick ask failed', { error: err.message });
        this.answers.end({ error: err.message });
        return { error: err.message, routed };
      }
    } finally {
      this.busy = false;
    }
  }
}

module.exports = { QuickAsk, DEFAULT_PROMPT };
