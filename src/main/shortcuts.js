'use strict';

/** Actions a global shortcut can trigger, with their default accelerators. */
const ACTIONS = Object.freeze({
  captureAsk: { label: 'Capture the screen and answer', accelerator: 'CommandOrControl+Shift+S' },
  toggleVoice: { label: 'Start or stop voice input', accelerator: 'Alt+Shift+V' },
  toggleOverlay: { label: 'Show or hide the overlay', accelerator: 'CommandOrControl+Shift+O' },
  toggleClickThrough: { label: 'Overlay click-through on or off', accelerator: 'CommandOrControl+Shift+I' },
  showWindow: { label: 'Show the MockingBird window', accelerator: 'CommandOrControl+Shift+M' },
});

const DEFAULT_SHORTCUTS = Object.freeze(Object.fromEntries(Object.entries(ACTIONS).map(([k, v]) => [k, v.accelerator])));

const MODIFIERS = new Set(['command', 'cmd', 'control', 'ctrl', 'commandorcontrol', 'cmdorctrl', 'alt', 'option', 'altgr', 'shift', 'super', 'meta']);
const NAMED_KEYS = new Set([
  'space', 'tab', 'capslock', 'numlock', 'scrolllock', 'backspace', 'delete', 'insert', 'return', 'enter', 'up', 'down', 'left', 'right',
  'home', 'end', 'pageup', 'pagedown', 'escape', 'esc', 'plus', 'printscreen', 'volumeup', 'volumedown', 'volumemute',
]);

function isKey(part) {
  const p = part.toLowerCase();
  return /^[a-z0-9]$/.test(p) || /^f([1-9]|1[0-9]|2[0-4])$/.test(p) || NAMED_KEYS.has(p) || /^num(\d|add|sub|mult|div|dec)$/.test(p) || /^[`\-=[\];',./\\]$/.test(p);
}

/**
 * Accept an Electron accelerator only if it has at least one modifier plus exactly one key.
 * A bare key would take that key away from every other app.
 */
function isValidAccelerator(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 60) return false;
  const parts = value.split('+');
  if (parts.length < 2 || parts.some((p) => p.length === 0)) return false;
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  if (!mods.every((m) => MODIFIERS.has(m.toLowerCase()))) return false;
  if (new Set(mods.map((m) => m.toLowerCase())).size !== mods.length) return false;
  return isKey(key);
}

/** Normalise for comparing two accelerators that mean the same thing. */
function canonical(accelerator) {
  const parts = accelerator.toLowerCase().split('+');
  const key = parts.pop();
  const alias = { cmd: 'commandorcontrol', ctrl: 'commandorcontrol', control: 'commandorcontrol', command: 'commandorcontrol', cmdorctrl: 'commandorcontrol', option: 'alt' };
  return [...new Set(parts.map((m) => alias[m] || m))].sort().concat(key).join('+');
}

/**
 * Registers global shortcuts and reports, per action, whether each one is active.
 * `globalShortcut` and the handlers are injected so this is testable without Electron.
 */
class ShortcutManager {
  constructor({ globalShortcut, handlers, logger = null }) {
    this.globalShortcut = globalShortcut;
    this.handlers = handlers;
    this.logger = logger;
    this.registered = [];
    this.statusMap = {};
  }

  _run(action) {
    const handler = this.handlers[action];
    try {
      const out = handler();
      if (out && typeof out.catch === 'function') out.catch((err) => this.logger?.error('shortcut handler failed', { action, error: err.message }));
    } catch (err) {
      this.logger?.error('shortcut handler failed', { action, error: err.message });
    }
  }

  /** `map` is `{ action: accelerator }`; `enabled: false` unregisters everything. */
  apply(map, { enabled = true } = {}) {
    this.unregisterAll();
    const status = {};
    const seen = new Map();
    for (const action of Object.keys(ACTIONS)) {
      const accelerator = map[action];
      if (!enabled) {
        status[action] = { accelerator, ok: false, error: 'Shortcuts are turned off' };
        continue;
      }
      if (!isValidAccelerator(accelerator)) {
        status[action] = { accelerator, ok: false, error: 'Not a valid shortcut. Use a modifier plus a key, like Ctrl+Shift+S.' };
        continue;
      }
      const key = canonical(accelerator);
      if (seen.has(key)) {
        status[action] = { accelerator, ok: false, error: `Already used for "${ACTIONS[seen.get(key)].label}"` };
        continue;
      }
      seen.set(key, action);
      let ok = false;
      try {
        ok = Boolean(this.globalShortcut.register(accelerator, () => this._run(action)));
      } catch (err) {
        this.logger?.warn('shortcut registration threw', { action, error: err.message });
      }
      if (ok) this.registered.push(accelerator);
      status[action] = ok ? { accelerator, ok: true } : { accelerator, ok: false, error: 'Another app is already using this shortcut' };
    }
    this.statusMap = status;
    return status;
  }

  status() {
    return this.statusMap;
  }

  unregisterAll() {
    for (const accelerator of this.registered) {
      try {
        this.globalShortcut.unregister(accelerator);
      } catch {
        // already gone
      }
    }
    this.registered = [];
  }
}

module.exports = { ACTIONS, DEFAULT_SHORTCUTS, ShortcutManager, isValidAccelerator, canonical };
