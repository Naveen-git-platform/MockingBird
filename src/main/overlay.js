'use strict';

const path = require('node:path');

const MIN_OPACITY = 0.3;
const clampOpacity = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(MIN_OPACITY, v)) : 1);

/**
 * Options for the floating answer window. It is an ordinary, visible window: always on
 * top and draggable, shown in the taskbar, with no capture exclusion of any kind.
 */
function buildOverlayOptions({ preloadPath, opacity = 0.95, workArea } = {}) {
  const width = 440;
  const height = 340;
  const options = {
    width,
    height,
    minWidth: 300,
    minHeight: 180,
    frame: false,
    resizable: true,
    alwaysOnTop: true,
    show: false,
    title: 'MockingBird overlay',
    backgroundColor: '#0e1014',
    opacity: clampOpacity(opacity),
    webPreferences: {
      preload: preloadPath || path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  };
  if (workArea) {
    options.x = workArea.x + workArea.width - width - 24;
    options.y = workArea.y + workArea.height - height - 24;
  }
  return options;
}

/** Owns the overlay window. `createWindow(options)` is injected so tests need no Electron. */
class OverlayManager {
  constructor({ createWindow, opacity = 0.95, getWorkArea = () => undefined, logger = null }) {
    this.createWindow = createWindow;
    this.getWorkArea = getWorkArea;
    this.logger = logger;
    this.opacity = clampOpacity(opacity);
    this.clickThrough = false;
    this.win = null;
    this.quitting = false;
  }

  _ensure() {
    if (this.win && !this.win.isDestroyed()) return this.win;
    const win = this.createWindow(buildOverlayOptions({ opacity: this.opacity, workArea: this.getWorkArea() }));
    win.setAlwaysOnTop(true, 'floating');
    win.on('close', (event) => {
      // closing the overlay only hides it so its content survives
      if (this.quitting) return;
      event.preventDefault();
      this.hide();
    });
    win.on('closed', () => {
      this.win = null;
    });
    this.win = win;
    return win;
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

  state() {
    return { visible: this.isVisible(), opacity: this.opacity, clickThrough: this.clickThrough };
  }

  send(channel, payload) {
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

module.exports = { OverlayManager, buildOverlayOptions, clampOpacity, MIN_OPACITY };
