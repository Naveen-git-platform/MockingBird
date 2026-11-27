/* Floating answer window. Renders streamed answers from the main process. */
(function () {
  const api = window.mockingbird;
  const answerEl = document.getElementById('answer');
  const questionEl = document.getElementById('question');
  const throughBtn = document.getElementById('through');
  let currentId = null;
  let text = '';
  let rafQueued = false;

  const paint = () => {
    if (rafQueued) return;
    rafQueued = true;
    requestAnimationFrame(() => {
      rafQueued = false;
      answerEl.innerHTML = text ? window.Markdown.render(text) : '<p class="hint">Thinking…</p>';
    });
  };

  api.on('answer:begin', ({ id, question }) => {
    currentId = id;
    text = '';
    questionEl.textContent = question || '';
    answerEl.innerHTML = '<p class="hint">Thinking…</p>';
  });
  api.on('answer:delta', ({ id, text: delta }) => {
    if (id !== currentId) return;
    text += delta;
    paint();
  });
  api.on('answer:end', ({ id, text: final, error }) => {
    if (id !== currentId) return;
    if (error) {
      const p = document.createElement('p');
      p.className = 'error';
      p.textContent = error;
      answerEl.replaceChildren(p);
    } else if (typeof final === 'string') {
      text = final;
      answerEl.innerHTML = window.Markdown.render(text);
    }
  });

  document.getElementById('close').addEventListener('click', () => api.invoke('overlay:hide'));
  document.getElementById('copy').addEventListener('click', () => {
    if (text) navigator.clipboard.writeText(text).catch(() => {});
  });
  throughBtn.addEventListener('click', () => {
    const on = !throughBtn.classList.contains('on');
    api.invoke('overlay:set-click-through', on);
  });
  document.addEventListener('click', (event) => {
    const btn = event.target.closest && event.target.closest('[data-copy]');
    if (btn) navigator.clipboard.writeText(btn.closest('pre').querySelector('code').textContent).catch(() => {});
  });

  // ----- look: style (solid, glass, acrylic) and background tint -----
  const tint = document.getElementById('tint');
  const applyState = (state) => {
    if (!state) return;
    document.documentElement.dataset.surface = state.style;
    document.body.style.setProperty('--glass', String(state.glass));
    tint.value = String(state.glass);
    throughBtn.classList.toggle('on', state.clickThrough);
    tint.hidden = state.style === 'solid';
  };
  api.invoke('overlay:state').then(applyState).catch(() => {});
  api.on('overlay:state-changed', applyState);
  tint.addEventListener('input', () => document.body.style.setProperty('--glass', tint.value));
  tint.addEventListener('change', () => api.invoke('settings:set', 'overlay.glass', Number(tint.value)).catch(() => {}));

  // ----- resize grip (transparent windows have no native resize border) -----
  const grip = document.getElementById('grip');
  let drag = null;
  grip.addEventListener('pointerdown', (e) => {
    grip.setPointerCapture(e.pointerId);
    drag = { x: e.screenX, y: e.screenY, w: window.innerWidth, h: window.innerHeight };
  });
  grip.addEventListener('pointermove', (e) => {
    if (!drag) return;
    api.invoke('overlay:resize', { width: drag.w + (e.screenX - drag.x), height: drag.h + (e.screenY - drag.y) }).catch(() => {});
  });
  const endDrag = () => { drag = null; };
  grip.addEventListener('pointerup', endDrag);
  grip.addEventListener('pointercancel', endDrag);

  document.documentElement.dataset.ready = '1';
})();
