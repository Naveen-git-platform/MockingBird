/* Practice view: free-form questions in a chosen mode, language and answer depth. */
(function () {
  const MB = window.MB;
  const { el } = MB;

  let state = null; // survives view switches: { messages: [{role, text, images, error}], options }

  function ensureState() {
    if (!state) state = { messages: [], options: null, busy: false };
    return state;
  }

  MB.views.practice = {
    unsub: null,
    async mount(host) {
      const s = ensureState();
      if (!s.options) s.options = await MB.call('practice:options');
      const options = s.options || { modes: [], languages: [], styles: [] };
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
        syncLanguage();
      });
      const langSel = MB.select(options.languages, prefs.language, (v) => {
        prefs.language = v;
        MB.prefs.set('practiceLanguage', v);
      });
      const langField = MB.field('Language', langSel);
      const styleSel = MB.select(options.styles, prefs.style, (v) => {
        prefs.style = v;
        MB.prefs.set('practiceStyle', v);
      });
      function syncLanguage() {
        const mode = options.modes.find((m) => m.id === prefs.mode);
        langField.hidden = !(mode && mode.needsLanguage);
      }
      syncLanguage();

      let liveBubble = null;
      let liveText = '';
      const paintLive = MB.frameThrottle(() => {
        if (liveBubble) liveBubble.innerHTML = MB.md(liveText);
      });
      this.unsub = MB.api.on('practice:delta', ({ text }) => {
        liveText += text;
        paintLive();
      });

      function renderMessages() {
        chat.replaceChildren();
        if (s.messages.length === 0) {
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
        for (const m of s.messages) {
          if (m.role === 'user') {
            const bubble = el('div', { class: 'msg user' });
            if (m.images?.length) bubble.append(el('div', { class: 'thumbs' }, m.images.map((src) => el('div', { class: 'thumb' }, el('img', { src, alt: 'Attachment' })))));
            bubble.append(m.text || '');
            chat.append(bubble);
          } else {
            const bubble = el('div', { class: `msg assistant${m.error ? ' error' : ''}` });
            if (m.error) bubble.textContent = m.text;
            else bubble.innerHTML = MB.md(m.text);
            chat.append(bubble);
          }
        }
      }

      const composer = MB.composer({
        placeholder: 'Ask a question, paste a problem, or attach a screenshot…',
        submitLabel: 'Ask',
        onSubmit: async ({ text, images }) => {
          s.messages.push({ role: 'user', text, images });
          liveText = '';
          liveBubble = el('div', { class: 'msg assistant' }, el('span', { class: 'typing', text: 'Thinking…' }));
          renderMessages();
          chat.append(liveBubble);
          liveBubble.scrollIntoView({ block: 'end' });
          const result = await MB.call('practice:ask', { text, images, mode: prefs.mode, language: prefs.language, style: prefs.style });
          liveBubble = null;
          if (result) s.messages.push({ role: 'assistant', text: result.text });
          else s.messages.push({ role: 'assistant', error: true, text: 'That did not work. Check your AI provider settings and try again.' });
          renderMessages();
          chat.lastElementChild?.scrollIntoView({ block: 'end' });
          return result ? undefined : false;
        },
      });
      this.composer = composer;

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
                s.messages = [];
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
      composer.focus();
    },
    unmount() {
      if (this.unsub) this.unsub();
      if (this.composer) this.composer.destroy();
      this.unsub = null;
    },
  };
})();
