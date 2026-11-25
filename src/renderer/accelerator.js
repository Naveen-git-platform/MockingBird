/* Turn a keydown event into an Electron accelerator string like "CommandOrControl+Shift+S".
 * Loaded as a classic script in the renderer and as a CommonJS module in tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Accelerator = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const KEY_NAMES = {
    ' ': 'Space', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Escape: 'Esc',
    '+': 'Plus', Enter: 'Enter', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert',
    Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  };
  const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'OS']);

  /**
   * @param {{key: string, ctrlKey: boolean, shiftKey: boolean, altKey: boolean, metaKey: boolean}} event
   * @param {boolean} isMac
   * @returns {string|null} null while only modifiers are held, or when no modifier is held
   */
  function fromEvent(event, isMac = false) {
    if (MODIFIER_KEYS.has(event.key)) return null;
    const mods = [];
    if (isMac) {
      if (event.metaKey) mods.push('Command');
      if (event.ctrlKey) mods.push('Control');
    } else {
      if (event.ctrlKey) mods.push('CommandOrControl');
      if (event.metaKey) mods.push('Super');
    }
    if (event.altKey) mods.push('Alt');
    if (event.shiftKey) mods.push('Shift');
    if (mods.length === 0) return null;
    let key = KEY_NAMES[event.key] || event.key;
    if (key.length === 1) key = key.toUpperCase();
    return `${mods.join('+')}+${key}`;
  }

  /** Friendly label for an accelerator: "CommandOrControl+Shift+S" becomes "Ctrl+Shift+S". */
  function display(accelerator, isMac = false) {
    return String(accelerator)
      .split('+')
      .map((part) => {
        const p = part.toLowerCase();
        if (p === 'commandorcontrol' || p === 'cmdorctrl') return isMac ? 'Cmd' : 'Ctrl';
        if (p === 'command') return 'Cmd';
        if (p === 'control') return 'Ctrl';
        if (p === 'super' || p === 'meta') return isMac ? 'Cmd' : 'Win';
        if (p === 'alt' || p === 'option') return isMac ? 'Option' : 'Alt';
        return part;
      })
      .join('+');
  }

  return { fromEvent, display };
});
