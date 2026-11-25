/* Practice view: free-form questions in a chosen mode, language and answer depth.
 * Messages come from `answer:*` events, so answers started anywhere (the composer, a
 * shortcut) appear in the chat when routing includes it, even while another view is open. */
(function () {
  const MB = window.MB;
  const { el } = MB;

  // ----- conversation store (lives for the whole session) -----
  const store = {
    messages: [], // { role, text, images?, error? }
    liveId: null, // id of the answer currently streaming
    options: null,
    listeners: new Set(),
    changed() {
      this.listeners.forEach((fn) => fn());
    },
  };
  MB.practiceStore = store;

  function liveMessage() {
    const last = store.messages[store.messages.length - 1];
    return last && last.live ? last : null;
  }

  MB.api.on('answer:begin', ({ id, question, images }) => {
    store.liveId = id;
    store.messages.push({ role: 'user', text: question, images: images || [] });
    store.messages.push({ role: 'assistant', text: '', live: true });
    store.changed();
  });
  MB.api.on('answer:delta', ({ id, text }) => {
    const m = liveMessage();
    if (!m || id !== store.liveId) return;
    m.text += text;
    store.changed();
  });
  MB.api.on('answer:end', ({ id, text, error }) => {
    const m = liveMessage();
    if (!m || id !== store.liveId) return;
    m.live = false;
    if (error) {
      m.error = true;
      m.text = error;
    } else if (typeof text === 'string') {
      m.text = text;
    }
    store.liveId = null;
    store.changed();
  });

  MB.views.practice = {
    listener: null,
    composer: null,
    async mount(host) {
      if (!store.options) store.options = await MB.call('practice:options');
      const options = store.options || { modes: [], languages: [], styles: [] };
      const defaults = (await MB.call('config:get', 'practice')) || {};

      const prefs = {
        mode: MB.prefs.get('practiceMode', defaults.mode || 'dsa'),
        language: MB.prefs.get('practiceLanguage', defaults.language || 'python'),
        style: MB.prefs.get('practiceStyle', defaults.style || 'guided'),
      };

      const chat = el('div', { class: 'chat', 'aria-live': 'polite' });
      const modeSel = MB.select(options.modes, prefs.mode, (v) => {
        prefs.mode = v;
        MB.prefs.set('practiceMode', v);
        MB.call('settings:set', 'practice.mode', v);
        syncLanguage();
      });
      const langSel = MB.select(options.languages, prefs.language, (v) => {
        prefs.language = v;
        MB.prefs.set('practiceLanguage', v);
        MB.call('settings:set', 'practice.language', v);
      });
      const langField = MB.field('Language', langSel);
      const styleSel = MB.select(options.styles, prefs.style, (v) => {
        prefs.style = v;
        MB.prefs.set('practiceStyle', v);
        MB.call('settings:set', 'practice.style', v);
      });
      function syncLanguage() {
        const mode = options.modes.find((m) => m.id === prefs.mode);
        langField.hidden = !(mode && mode.needsLanguage);
      }
      syncLanguage();

      let routedNote = null; // shown when the last answer went only to the overlay

      function renderMessages() {
        chat.replaceChildren();
        if (store.messages.length === 0 && !routedNote) {
          chat.append(
            el(
              'div',
              { class: 'empty' },
              el('h2', { text: 'Practice anything' }),
              el('p', {
                text: 'Ask an interview question, paste a screenshot of a problem, or speak it. Pick how much help you want: hints only, a guided approach, or the full solution.',
              })
            )
          );
          return;
        }
        for (const m of store.messages) {
          if (m.role === 'user') {
            const bubble = el('div', { class: 'msg user' });
            if (m.images && m.images.length) {
              bubble.append(el('div', { class: 'thumbs' }, m.images.map((src) => el('div', { class: 'thumb' }, el('img', { src, alt: 'Attachment' })))));
            }
            bubble.append(m.text || '');
            chat.append(bubble);
          } else {
            const bubble = el('div', { class: `msg assistant${m.error ? ' error' : ''}` });
            if (m.error) bubble.textContent = m.text;
            else if (!m.text) bubble.append(el('span', { class: 'typing', text: 'Thinking…' }));
            else bubble.innerHTML = MB.md(m.text);
            chat.append(bubble);
          }
        }
        if (routedNote) chat.append(el('p', { class: 'sub', text: routedNote }));
      }
      const paint = MB.frameThrottle(() => {
        renderMessages();
        chat.lastElementChild?.scrollIntoView({ block: 'end' });
      });
      this.listener = () => paint();
      store.listeners.add(this.listener);

      const composer = MB.composer({
        placeholder: 'Ask a question, paste a problem, or attach a screenshot…',
        submitLabel: 'Ask',
        autoAsk: true,
        onSubmit: async ({ text, images }) => {
          routedNote = null;
          let result;
          try {
            result = await MB.api.invoke('practice:ask', { text, images, mode: prefs.mode, language: prefs.language, style: prefs.style });
          } catch (err) {
            MB.toast(MB.cleanError(err), 'error');
            return false;
          }
          if (result && result.routed && !result.routed.chat) {
            routedNote = 'The answer was sent to the overlay window.';
            renderMessages();
          }
          return undefined;
        },
      });
      this.composer = composer;
      MB.activeComposer = composer;

      host.append(
        el(
          'section',
          { class: 'view' },
          el(
            'div',
            { class: 'view-head' },
            el('div', {}, el('h1', { text: 'Practice' }), el('p', { class: 'sub', text: 'Ask, get coached, ask a follow-up.' })),
            el('button', {
              class: 'btn',
              type: 'button',
              text: 'New chat',
              onclick: async () => {
                await MB.call('practice:reset');
                store.messages = [];
                routedNote = null;
                renderMessages();
              },
            })
          ),
          el('div', { class: 'card row' }, MB.field('Type', modeSel), langField, MB.field('Help level', styleSel)),
          chat,
          composer.el
        )
      );
      renderMessages();
      chat.lastElementChild?.scrollIntoView({ block: 'end' });
      composer.focus();
    },
    unmount() {
      if (this.listener) store.listeners.delete(this.listener);
      if (this.composer) this.composer.destroy();
      this.listener = null;
      this.composer = null;
    },
  };
})();
