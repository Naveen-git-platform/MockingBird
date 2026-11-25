'use strict';

// Screen capture service for MockingBird.
// The overall approach (desktopCapturer thumbnails, matching a source to a display)
// is adapted from OpenCluely's capture.service.js (Apache-2.0), rewritten with
// window listing, area cropping, injected Electron APIs and validation.

const { clampRect, scaleRect } = require('./image-utils');

function toPng(image) {
  return { mimeType: 'image/png', data: image.toPNG().toString('base64') };
}

class CaptureService {
  /**
   * @param {{desktopCapturer: object, screen: object, clipboard?: object, logger?: object}} deps
   */
  constructor({ desktopCapturer, screen, clipboard = null, logger = null }) {
    this.desktopCapturer = desktopCapturer;
    this.screen = screen;
    this.clipboard = clipboard;
    this.logger = logger;
    this.busy = false;
  }

  /** List capturable screens and windows with small previews for a picker. */
  async listSources({ previewSize = { width: 240, height: 140 } } = {}) {
    const sources = await this.desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: previewSize,
      fetchWindowIcons: false,
    });
    return sources
      .filter((s) => s.thumbnail && !s.thumbnail.isEmpty?.())
      .map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.id.startsWith('screen:') ? 'screen' : 'window',
        displayId: s.display_id || null,
        preview: s.thumbnail.toDataURL(),
      }));
  }

  _display(displayId) {
    const all = this.screen.getAllDisplays();
    return all.find((d) => String(d.id) === String(displayId)) || this.screen.getPrimaryDisplay();
  }

  /** Full-resolution capture of one source id from listSources(). */
  async _fetchSource(sourceId, size) {
    const sources = await this.desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: size,
      fetchWindowIcons: false,
    });
    const source = sources.find((s) => s.id === sourceId);
    if (!source) throw new Error('That window or screen is no longer available');
    if (!source.thumbnail || source.thumbnail.isEmpty?.()) throw new Error('Capture returned an empty image');
    return source;
  }

  async _guarded(fn) {
    // async so a busy service rejects instead of throwing synchronously
    if (this.busy) throw new Error('A capture is already in progress');
    this.busy = true;
    try {
      return await fn();
    } finally {
      this.busy = false;
    }
  }

  /** Capture the primary (or given) display. */
  captureScreen({ displayId } = {}) {
    return this._guarded(async () => {
      const display = this._display(displayId);
      const scale = display.scaleFactor || 1;
      const size = { width: Math.round(display.size.width * scale), height: Math.round(display.size.height * scale) };
      const sources = await this.desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
      if (sources.length === 0) throw new Error('No screen sources available for capture');
      const source = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
      if (!source.thumbnail || source.thumbnail.isEmpty?.()) throw new Error('Capture returned an empty image');
      this.logger?.debug('screen captured', { source: source.name });
      return toPng(source.thumbnail);
    });
  }

  /** Capture a specific screen or window picked from listSources(). */
  captureSource(sourceId, { size = { width: 1920, height: 1080 } } = {}) {
    if (typeof sourceId !== 'string' || !sourceId) throw new Error('sourceId is required');
    return this._guarded(async () => toPng((await this._fetchSource(sourceId, size)).thumbnail));
  }

  /**
   * Capture a sub-rectangle of a source. `rect` is in `viewport` coordinates
   * (what the user dragged on, e.g. CSS pixels) and is scaled to image pixels.
   */
  captureArea(sourceId, rect, viewport, { size = { width: 1920, height: 1080 } } = {}) {
    if (typeof sourceId !== 'string' || !sourceId) throw new Error('sourceId is required');
    if (!viewport || !(viewport.width > 0) || !(viewport.height > 0)) throw new Error('viewport size is required');
    return this._guarded(async () => {
      const { thumbnail } = await this._fetchSource(sourceId, size);
      const imgSize = thumbnail.getSize();
      const crop = clampRect(scaleRect(rect, viewport, imgSize), imgSize);
      if (!crop) throw new Error('Selected area is empty or outside the screen');
      return toPng(thumbnail.crop(crop));
    });
  }

  /** Image currently on the clipboard, or null. */
  readClipboardImage() {
    if (!this.clipboard) return null;
    const image = this.clipboard.readImage();
    if (!image || image.isEmpty()) return null;
    return toPng(image);
  }
}

module.exports = { CaptureService };
