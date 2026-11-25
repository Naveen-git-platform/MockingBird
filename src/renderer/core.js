/* Shared renderer helpers: DOM builder, toasts, prefs, a tiny view router. */
(function () {
  const MB = (window.MB = { views: {}, api: window.mockingbird });

  /** el('div', { class: 'x', onclick: fn, text: '...' }, child, 'text') */
  MB.el = function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'html') node.innerHTML = value; // callers must pass sanitised markup only
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else if (value === true) node.setAttribute(key, '');
      else node.setAttribute(key, String(value));
    }
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return node;
  };

  /** Safe markdown to HTML (see markdown.js). */
  MB.md = (text) => window.Markdown.render(text);

  MB.toast = function toast(message, kind = '') {
    const host = document.getElementById('toasts');
    const node = MB.el('div', { class: `toast ${kind}`, role: 'status', text: message });
    host.append(node);
    setTimeout(() => node.remove(), kind === 'error' ? 7000 : 3500);
  };

  /** Call the main process; surface failures as toasts and resolve to undefined. */
  MB.call = async function call(channel, ...args) {
    try {
      return await MB.api.invoke(channel, ...args);
    } catch (err) {
      MB.toast(MB.cleanError(err), 'error');
      return undefined;
    }
  };

  /** Electron prefixes IPC errors with "Error invoking remote method ...". Strip that. */
  MB.cleanError = function cleanError(err) {
    const msg = String((err && err.message) || err || 'Something went wrong');
    return msg.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '');
  };

  const PREF_KEY = 'mockingbird.prefs';
  MB.prefs = {
    get(key, fallback) {
      try {
        const all = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
        return key in all ? all[key] : fallback;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        const all = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
        all[key] = value;
        localStorage.setItem(PREF_KEY, JSON.stringify(all));
      } catch {
        // preferences are a convenience; ignore storage failures
      }
    },
  };

  MB.select = function select(options, value, onChange, attrs = {}) {
    const node = MB.el('select', attrs, options.map((o) => MB.el('option', { value: o.id, text: o.label })));
    node.value = value;
    if (onChange) node.addEventListener('change', () => onChange(node.value));
    return node;
  };

  MB.field = (label, control) => MB.el('label', { class: 'field' }, MB.el('span', { text: label }), control);

  MB.scoreClass = (score) => (score >= 7.5 ? 'good' : score >= 5 ? 'ok' : 'low');

  MB.formatDate = (ms) =>
    ms ? new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';

  MB.confirm = (message) => window.confirm(message);

  /** Collapse rapid re-renders (streaming) into one per animation frame. */
  MB.frameThrottle = function frameThrottle(fn) {
    let queued = false;
    return () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        fn();
      });
    };
  };

  // Copy buttons inside rendered code blocks.
  document.addEventListener('click', (event) => {
    const btn = event.target.closest && event.target.closest('[data-copy]');
    if (!btn) return;
    const code = btn.closest('pre').querySelector('code');
    navigator.clipboard
      .writeText(code.textContent)
      .then(() => {
        btn.textContent = 'Copied';
        setTimeout(() => (btn.textContent = 'Copy'), 1200);
      })
      .catch(() => MB.toast('Could not copy', 'error'));
  });

  // Router
  let current = null;
  MB.show = function show(name) {
    const view = MB.views[name];
    if (!view) return;
    if (current && MB.views[current].unmount) MB.views[current].unmount();
    current = name;
    const host = document.getElementById('view');
    host.replaceChildren();
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === name));
    view.mount(host);
    host.scrollTop = 0;
  };
  MB.currentView = () => current;
})();
