'use strict';

const { EVENT_CHANNELS: E } = require('../shared/channels');

const TARGETS = Object.freeze(['chat', 'overlay', 'both']);

/**
 * Sends a streamed answer to the chat window, the overlay, or both, according to the
 * routing setting. Every answer has an id so a window can ignore stale events.
 */
class AnswerSink {
  /**
   * @param {{getChatWindows: () => object[], overlay: object, getTarget: () => string}} deps
   */
  constructor({ getChatWindows, overlay, getTarget }) {
    this.getChatWindows = getChatWindows;
    this.overlay = overlay;
    this.getTarget = getTarget;
    this.seq = 0;
    this.current = null; // { id, routed }
  }

  routed() {
    const target = TARGETS.includes(this.getTarget()) ? this.getTarget() : 'chat';
    return { chat: target !== 'overlay', overlay: target !== 'chat' };
  }

  _toChat(channel, payload) {
    for (const win of this.getChatWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    }
  }

  /** images are data URLs and are only sent to the chat window. */
  begin({ question = '', images = [] } = {}) {
    const routed = this.routed();
    const id = (this.seq += 1);
    this.current = { id, routed };
    if (routed.chat) this._toChat(E.ANSWER_BEGIN, { id, question, images });
    if (routed.overlay) {
      this.overlay.show();
      this.overlay.send(E.ANSWER_BEGIN, { id, question, images: [] });
    }
    return { id, routed };
  }

  delta(text) {
    if (!this.current) return;
    const { id, routed } = this.current;
    if (routed.chat) this._toChat(E.ANSWER_DELTA, { id, text });
    if (routed.overlay) this.overlay.send(E.ANSWER_DELTA, { id, text });
  }

  /** Finish with `{ text }` on success or `{ error }` on failure. */
  end(result) {
    if (!this.current) return;
    const { id, routed } = this.current;
    this.current = null;
    const payload = { id, ...result };
    if (routed.chat) this._toChat(E.ANSWER_END, payload);
    if (routed.overlay) this.overlay.send(E.ANSWER_END, payload);
  }
}

module.exports = { AnswerSink, TARGETS };
