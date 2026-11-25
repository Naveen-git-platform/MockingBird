'use strict';

const { buildRequest, DEFAULT_HISTORY } = require('../modes/prompt-builder');
const { resolveMode } = require('../modes/modes');
const { resolveStyle } = require('../modes/styles');
const { resolveLanguage } = require('../modes/languages');

const MAX_STORED_MESSAGES = 60;

function textOfInput(input) {
  const note = input.images.length ? ` [${input.images.length} image${input.images.length > 1 ? 's' : ''} attached]` : '';
  return `${input.text || '(see attached image)'}${note}`;
}

/**
 * Free-form practice chat: ask anything, get an answer in the chosen mode, language
 * and depth. Conversation memory is kept in memory (images are not stored) so
 * follow-up questions keep their context.
 */
class PracticeService {
  constructor({ llm, defaults = {} }) {
    this.llm = llm;
    this.defaults = { mode: 'dsa', language: 'python', style: 'guided', maxHistory: DEFAULT_HISTORY, ...defaults };
    this.history = [];
    this.busy = false;
  }

  _resolve(options = {}) {
    const mode = options.mode ?? this.defaults.mode;
    const style = options.style ?? this.defaults.style;
    const language = options.language ?? this.defaults.language;
    if (!resolveMode(mode)) throw new Error(`Unknown mode: ${mode}`);
    if (!resolveStyle(style)) throw new Error(`Unknown style: ${style}`);
    if (resolveMode(mode).needsLanguage && !resolveLanguage(language)) throw new Error(`Unknown language: ${language}`);
    return { mode, style, language };
  }

  /**
   * @param {{text: string, images: {mimeType: string, data: string}[]}} input - normalised input
   * @param {{mode?, style?, language?}} options
   */
  async ask(input, options = {}, { onDelta, signal } = {}) {
    if (this.busy) throw new Error('Still answering the previous question');
    const settings = this._resolve(options);
    const request = buildRequest({ ...settings, history: this.history, input, maxHistory: this.defaults.maxHistory });
    this.busy = true;
    try {
      const { text, provider, model } = await this.llm.generate(request, { onDelta, signal });
      this.history.push({ role: 'user', content: textOfInput(input) }, { role: 'assistant', content: text });
      if (this.history.length > MAX_STORED_MESSAGES) this.history.splice(0, this.history.length - MAX_STORED_MESSAGES);
      return { text, provider, model };
    } finally {
      this.busy = false;
    }
  }

  reset() {
    this.history = [];
  }

  get turns() {
    return this.history.length / 2;
  }
}

module.exports = { PracticeService };
