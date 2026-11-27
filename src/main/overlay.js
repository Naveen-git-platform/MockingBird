'use strict';

const path = require('node:path');

const MIN_OPACITY = 0.3;
const MIN_GLASS = 0.05;
const MAX_GLASS = 0.95;
const MIN_SIZE = { width: 300, height: 180 };
const STYLES = Object.freeze(['solid', 'glass', 'acrylic']);

const clamp = (v, lo, hi, fallback) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback);
const clampOpacity = (v) => clamp(v, MIN_OPACITY, 1, 1);
const clampGlass = (v) => clamp(v, MIN_GLASS, MAX_GLASS, 0.35);

/**
 * Windows 11 22H2 (build 22621) and later can draw the blurred acrylic material behind a
 * window. macOS has its own vibrancy. Elsewhere only plain see-through glass is available.
 */
function supportsAcrylic({ platform = process.platform, release = '' } = {}) {
  if (platform === 'darwin') return true;
  if (platform !== 'win32') return false;
  const build = Number(String(release).split('.')[2]);
  return Number.isFinite(build) && build >= 22621;
}

/** An unavailable or unknown style falls back to see-through glass. */
function resolveStyle(style, acrylicOk) {
  if (style === 'solid') return 'solid';
  if (style === 'acrylic' && acrylicOk) return 'acrylic';
  return 'glass';
}

/**
 * Options for the floating answer window. It is an ordinary, visible window: always on
 * top and draggable, shown in the taskbar, with no capture exclusion of any kind.
 *   solid   - an opaque window
 *   glass   - a see-through window: the desktop shows through behind the text
 *   acrylic - frosted glass (Windows 11 material or macOS vibrancy)
 */
function buildOverlayOptions({ preloadPath, opacity = 0.95, workArea, style = 'solid', platform = process.platform, bounds } = {}) {
  const width = 440;
  const height = 340;
  const options = {
    width,
    height,
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    show: false,
    title: 'MockingBird overlay',
    opacity: clampOpacity(opacity),
    webPreferences: {
      preload: preloadPath || path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  };
  if (style === 'solid') {
    options.backgroundColor = '#0e1014';
  } else {
    options.backgroundColor = '#00000000';
    if (style === 'glass') {
      options.transparent = true;
    } else if (platform === 'darwin') {
      options.vibrancy = 'under-window';
    } else {
      options.backgroundMaterial = 'acrylic';
    }
  }
  if (bounds) {
    Object.assign(options, { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height });
  } else if (workArea) {
    options.x = workArea.x + workArea.width - width - 24;
    options.y = workArea.y + workArea.height - height - 24;
  }
  return options;
}

/** Owns the overlay window. `createWindow(options)` is injected so tests need no Electron. */
class OverlayManager {
  constructor({ createWindow, opacity = 0.95, style = 'solid', glass = 0.35, getWorkArea = () => undefined, platform = process.platform, release = '', logger = null }) {
    this.createWindow = createWindow;
    this.getWorkArea = getWorkArea;
    this.platform = platform;
    this.logger = logger;
    this.acrylicOk = supportsAcrylic({ platform, release });
    this.opacity = clampOpacity(opacity);
    this.style = STYLES.includes(style) ? style : 'glass';
    this.glass = clampGlass(glass);
    this.clickThrough = false;
    this.win = null;
    this.quitting = false;
    this.replay = []; // answer events for the current answer, re-sent when the window is rebuilt
  }

  /** The style actually in use (acrylic falls back to glass where unsupported). */
  get effectiveStyle() {
    return resolveStyle(this.style, this.acrylicOk);
  }

  availableStyles() {
    return [
      { id: 'solid', label: 'Solid', available: true },
      { id: 'glass', label: 'Glass (see-through)', available: true },
      { id: 'acrylic', label: 'Frosted (acrylic)', available: this.acrylicOk },
    ];
  }

  _create(bounds) {
    const win = this.createWindow(
      buildOverlayOptions({ opacity: this.opacity, workArea: this.getWorkArea(), style: this.effectiveStyle, platform: this.platform, bounds })
    );
    win.setAlwaysOnTop(true, 'floating');
    win.on('close', (event) => {
      // closing the overlay only hides it so its content survives
      if (this.quitting) return;
      event.preventDefault();
      this.hide();
    });
    win.on('closed', () => {
      if (this.win === win) this.win = null;
    });
    this.win = win;
    return win;
  }

  _ensure() {
    if (this.win && !this.win.isDestroyed()) return this.win;
    return this._create();
  }

  get window() {
    return this.win && !this.win.isDestroyed() ? this.win : null;
  }

  isVisible() {
    return Boolean(this.window && this.window.isVisible());
  }

  /** Show without taking keyboard focus from the app the user is working in. */
  show({ focus = false } = {}) {
    const win = this._ensure();
    if (focus) win.show();
    else win.showInactive();
    this._notify();
  }

  hide() {
    const win = this.window;
    if (!win) return;
    // never leave the user with a hidden, un-clickable window
    if (this.clickThrough) this.setClickThrough(false);
    win.hide();
    this._notify();
  }

  toggle() {
    if (this.isVisible()) this.hide();
    else this.show();
  }

  setOpacity(value) {
    this.opacity = clampOpacity(value);
    if (this.window) this.window.setOpacity(this.opacity);
    this._notify();
    return this.opacity;
  }

  /** Let mouse clicks pass through the overlay to whatever is underneath. */
  setClickThrough(enabled) {
    this.clickThrough = Boolean(enabled);
    if (this.window) this.window.setIgnoreMouseEvents(this.clickThrough, { forward: true });
    this._notify();
    return this.clickThrough;
  }

  /** How much of the window background is tinted (0.05 nearly clear to 0.95 nearly solid). */
  setGlass(value) {
    this.glass = clampGlass(value);
    this._notify();
    return this.glass;
  }

  /**
   * Change the window style. Transparency cannot change on a live window, so the window is
   * rebuilt in the same place and the current answer is shown again.
   */
  setStyle(style) {
    if (!STYLES.includes(style)) throw new Error(`Unknown overlay style: ${style}`);
    const before = this.effectiveStyle;
    this.style = style;
    if (this.effectiveStyle !== before && this.window) this._rebuild();
    this._notify();
    return this.effectiveStyle;
  }

  _rebuild() {
    const old = this.window;
    const bounds = old.getBounds();
    const wasVisible = old.isVisible();
    const clickThrough = this.clickThrough;
    old.destroy();
    this.win = null;
    const win = this._create(bounds);
    const restore = () => {
      for (const [channel, payload] of this.replay) win.webContents.send(channel, payload);
      if (clickThrough) win.setIgnoreMouseEvents(true, { forward: true });
    };
    if (win.webContents.once) win.webContents.once('did-finish-load', restore);
    else restore();
    if (wasVisible) win.showInactive();
  }

  /** Resize from the in-window grip (transparent windows have no native resize border). */
  resize(width, height) {
    const win = this.window;
    if (!win) return null;
    const area = this.getWorkArea();
    const w = clamp(Math.round(width), MIN_SIZE.width, area ? area.width : 4000, MIN_SIZE.width);
    const h = clamp(Math.round(height), MIN_SIZE.height, area ? area.height : 4000, MIN_SIZE.height);
    win.setSize(w, h);
    return { width: w, height: h };
  }

  state() {
    return {
      visible: this.isVisible(),
      opacity: this.opacity,
      clickThrough: this.clickThrough,
      style: this.effectiveStyle,
      glass: this.glass,
    };
  }

  send(channel, payload) {
    if (channel === 'answer:begin') this.replay = [];
    if (channel.startsWith('answer:')) this.replay.push([channel, payload]);
    const win = this.window;
    if (win) win.webContents.send(channel, payload);
  }

  _notify() {
    this.send('overlay:state-changed', this.state());
  }

  destroy() {
    this.quitting = true;
    if (this.window) this.window.destroy();
    this.win = null;
  }
}

module.exports = { OverlayManager, buildOverlayOptions, clampOpacity, clampGlass, supportsAcrylic, resolveStyle, MIN_OPACITY, MIN_GLASS, MAX_GLASS, STYLES };
