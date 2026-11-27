/* Settings view: AI providers and API keys, voice preferences, app info. */
(function () {
  const MB = window.MB;
  const { el } = MB;

  const LABELS = { gemini: 'Google Gemini', openai: 'OpenAI', anthropic: 'Anthropic Claude', ollama: 'Ollama (local)' };
  const KEY_BADGE = {
    stored: { text: 'key saved', cls: 'good' },
    env: { text: 'key from environment', cls: 'good' },
  };

  MB.views.settings = {
    async mount(host) {
      const [settings, info, voiceCfg, appCfg, overlayState] = await Promise.all([
        MB.call('settings:get'),
        MB.call('app:info'),
        MB.call('config:get', 'voice'),
        MB.call('config:get', 'app'),
        MB.call('overlay:state'),
      ]);
      const root = el('section', { class: 'view' });
      host.append(root);

      function providerCard(p) {
        const badge = p.needsKey ? KEY_BADGE[p.keySource] || { text: 'no key', cls: 'bad' } : { text: 'no key needed', cls: 'good' };
        const model = el('input', { type: 'text', value: p.model || '', 'aria-label': `${p.name} model`, maxlength: 100 });
        model.addEventListener('change', async () => {
          const res = await MB.call('settings:set', `llm.providers.${p.name}.model`, model.value.trim());
          if (res) MB.toast('Model saved', 'good');
          else model.value = p.model || '';
        });

        const rows = [el('div', { class: 'row' }, el('b', { text: LABELS[p.name] || p.name }), el('span', { class: `badge ${badge.cls}`, text: badge.text }), el('span', { class: 'grow' }))];
        rows.push(el('div', { class: 'row' }, MB.field('Model', model)));

        if (p.needsKey) {
          const key = el('input', { type: 'password', placeholder: p.keySource === 'stored' ? 'Replace the saved key' : 'Paste your API key', autocomplete: 'off', spellcheck: 'false', 'aria-label': `${p.name} API key` });
          const save = el('button', { class: 'btn primary', type: 'button', text: 'Save key', disabled: !settings.secureStorage });
          save.addEventListener('click', async () => {
            if (!key.value.trim()) return MB.toast('Paste a key first', 'error');
            save.disabled = true;
            const res = await MB.call('settings:set-key', p.name, key.value);
            key.value = '';
            if (res) {
              MB.toast('Key saved securely', 'good');
              return MB.show('settings');
            }
            save.disabled = false;
          });
          rows.push(el('div', { class: 'row' }, el('div', { class: 'field grow' }, el('span', { text: 'API key' }), key), save));
          if (p.keySource === 'stored') {
            rows.push(
              el('div', { class: 'row' }, el('button', {
                class: 'btn danger',
                type: 'button',
                text: 'Remove saved key',
                onclick: async () => {
                  if (!MB.confirm(`Remove the saved ${LABELS[p.name]} key?`)) return;
                  if (await MB.call('settings:delete-key', p.name)) MB.show('settings');
                },
              }))
            );
          }
        } else {
          rows.push(el('p', { class: 'sub', text: 'Runs on your own computer. Start Ollama and pull a model first (for example: ollama pull llama3.2).' }));
        }
        return el('div', { class: 'card' }, ...rows);
      }

      function shortcutsCard() {
        const isMac = /Mac/i.test(navigator.platform);
        const master = el('input', { type: 'checkbox', 'aria-label': 'Enable global shortcuts' });
        master.checked = settings.shortcutsEnabled !== false;
        master.addEventListener('change', async () => {
          if (await MB.call('settings:set', 'shortcuts.enabled', master.checked)) MB.show('settings');
        });
        const rows = settings.shortcuts.map((row) => {
          const input = el('input', { type: 'text', value: window.Accelerator.display(row.accelerator, isMac), readonly: true, 'aria-label': `${row.label} shortcut`, title: 'Click, then press the new key combination' });
          input.addEventListener('keydown', async (e) => {
            if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) return;
            e.preventDefault();
            const accelerator = window.Accelerator.fromEvent(e, isMac);
            if (!accelerator) return;
            if (await MB.call('settings:set', `shortcuts.${row.action}`, accelerator)) MB.show('settings');
          });
          const status = row.ok ? el('span', { class: 'badge good', text: 'active' }) : el('span', { class: 'badge bad', title: row.error || '', text: row.error ? 'not active' : 'off' });
          const reset = el('button', {
            class: 'btn',
            type: 'button',
            text: 'Reset',
            disabled: row.accelerator === row.defaultAccelerator,
            onclick: async () => {
              if (await MB.call('settings:set', `shortcuts.${row.action}`, row.defaultAccelerator)) MB.show('settings');
            },
          });
          return el('div', { class: 'row' }, el('span', { class: 'grow', text: row.label }), input, status, reset, row.error && settings.shortcutsEnabled !== false ? el('p', { class: 'sub', text: row.error }) : null);
        });
        return el('div', { class: 'card' }, el('h3', { text: 'Keyboard shortcuts' }), el('p', { class: 'sub', text: 'Work from anywhere, even when MockingBird is in the background. Click a box and press the new combination.' }), el('label', { class: 'row' }, master, el('span', { text: 'Enable global shortcuts' })), ...rows);
      }

      const modeSel = MB.select(
        [{ id: 'vad', label: 'Automatic (detect pauses)' }, { id: 'manual', label: 'Manual (press to start and stop)' }],
        MB.prefs.get('voiceMode', (voiceCfg && voiceCfg.mode) || 'vad'),
        (v) => MB.prefs.set('voiceMode', v)
      );
      const sourceSel = MB.select(
        [{ id: 'mic', label: 'Microphone' }, { id: 'system', label: 'System audio (Windows)' }],
        MB.prefs.get('voiceSource', 'mic'),
        (v) => MB.prefs.set('voiceSource', v)
      );

      const autoAsk = el('input', { type: 'checkbox', 'aria-label': 'Answer automatically after speech' });
      autoAsk.checked = MB.prefs.get('voiceAutoAsk', false);
      autoAsk.addEventListener('change', () => MB.prefs.set('voiceAutoAsk', autoAsk.checked));

      root.append(el('div', { class: 'view-head' }, el('div', {}, el('h1', { text: 'Settings' }), el('p', { class: 'sub', text: 'AI providers, voice and app details.' }))));

      if (!settings) {
        root.append(el('div', { class: 'card', text: 'Settings are not available.' }));
      } else {
        const primary = MB.select(
          settings.providers.map((p) => ({ id: p.name, label: LABELS[p.name] || p.name })),
          settings.primary,
          async (v) => {
            if (await MB.call('settings:set', 'llm.primary', v)) MB.toast('Primary provider changed', 'good');
          }
        );
        root.append(
          el(
            'div',
            { class: 'card' },
            el('h3', { text: 'AI provider' }),
            el('p', { class: 'sub', text: 'MockingBird uses your primary provider first. If it fails or has no key, it falls back to the others that are set up.' }),
            el('div', { class: 'row' }, MB.field('Primary provider', primary)),
            settings.secureStorage ? null : el('p', { class: 'msg error', text: 'Secure storage is not available on this system, so keys cannot be saved here. Set them as environment variables instead (GEMINI_API_KEY, OPENAI_API_KEY, ANTHROPIC_API_KEY).' })
          ),
          ...settings.providers.map(providerCard)
        );
      }

      if (settings) {
        const routing = MB.select(
          [{ id: 'chat', label: 'Chat window' }, { id: 'overlay', label: 'Floating overlay' }, { id: 'both', label: 'Both' }],
          settings.routing,
          async (v) => {
            if (await MB.call('settings:set', 'routing.target', v)) MB.toast('Answers will go to: ' + v, 'good');
          }
        );
        const opacity = el('input', { type: 'range', min: '0.3', max: '1', step: '0.05', value: String(settings.overlayOpacity), 'aria-label': 'Overlay opacity' });
        opacity.addEventListener('change', () => MB.call('settings:set', 'overlay.opacity', Number(opacity.value)));
        const styles = settings.overlayStyles || [];
        const styleSel = MB.select(
          styles.map((x) => ({ id: x.id, label: x.available ? x.label : `${x.label} (not available here)` })),
          settings.overlayStyle,
          async (v) => {
            if (await MB.call('settings:set', 'overlay.style', v)) MB.toast('Overlay style changed', 'good');
          }
        );
        styles.forEach((x, i) => { if (!x.available) styleSel.options[i].disabled = true; });
        const glass = el('input', { type: 'range', min: '0.05', max: '0.95', step: '0.05', value: String(settings.overlayGlass), 'aria-label': 'Overlay background tint' });
        glass.addEventListener('change', () => MB.call('settings:set', 'overlay.glass', Number(glass.value)));
        const toggle = el('button', { class: 'btn', type: 'button', text: overlayState && overlayState.visible ? 'Hide overlay' : 'Show overlay' });
        toggle.addEventListener('click', async () => {
          const state = await MB.call(overlayState && overlayState.visible ? 'overlay:hide' : 'overlay:show');
          if (state) {
            overlayState.visible = state.visible;
            toggle.textContent = state.visible ? 'Hide overlay' : 'Show overlay';
          }
        });
        const through = el('button', { class: 'btn', type: 'button', text: 'Click-through: off' });
        through.addEventListener('click', async () => {
          const next = through.textContent.endsWith('off');
          const state = await MB.call('overlay:set-click-through', next);
          if (state) through.textContent = `Click-through: ${state.clickThrough ? 'on' : 'off'}`;
        });
        root.append(
          el(
            'div',
            { class: 'card' },
            el('h3', { text: 'Answers and overlay' }),
            el('p', { class: 'sub', text: 'Choose where answers appear. The overlay is a small always-on-top window you can drag and resize. Make it see-through to keep working on the screen behind it, or frosted for a blurred-glass look.' }),
            el('div', { class: 'row' }, MB.field('Show answers in', routing), MB.field('Window style', styleSel)),
            el('div', { class: 'row' }, MB.field('Background tint (left = more see-through)', glass), MB.field('Whole-window opacity', opacity)),
            el('div', { class: 'row' }, toggle, through),
            el('p', { class: 'sub', text: 'With click-through on, mouse clicks pass through the overlay. Hiding the overlay turns it off again.' })
          )
        );
      }

      if (settings && settings.themes) {
        const swatches = el('div', { class: 'themes', role: 'radiogroup', 'aria-label': 'Colour theme' });
        for (const t of settings.themes) {
          const dots = el('span', { class: 'dots' }, t.swatch.map((c) => {
            const dot = el('i');
            dot.style.background = c;
            return dot;
          }));
          const btn = el('button', { class: `theme-btn${t.id === settings.theme ? ' selected' : ''}`, type: 'button', role: 'radio', 'aria-checked': String(t.id === settings.theme), title: t.label }, dots, el('span', { text: t.label }));
          btn.addEventListener('click', async () => {
            if (await MB.call('settings:set', 'ui.theme', t.id)) {
              swatches.querySelectorAll('.theme-btn').forEach((b) => {
                b.classList.remove('selected');
                b.setAttribute('aria-checked', 'false');
              });
              btn.classList.add('selected');
              btn.setAttribute('aria-checked', 'true');
            }
          });
          swatches.append(btn);
        }
        root.append(el('div', { class: 'card' }, el('h3', { text: 'Appearance' }), el('p', { class: 'sub', text: 'Pick a colour theme. It applies to the app and the overlay immediately.' }), swatches));
      }

      if (settings && settings.shortcuts) root.append(shortcutsCard());

      root.append(
        el('div', { class: 'card' }, el('h3', { text: 'Voice input' }), el('p', { class: 'sub', text: voiceCfg && voiceCfg.enabled ? `Speech is transcribed on your computer with Whisper (${voiceCfg.model} model). It needs Python with the openai-whisper package.` : 'Voice input is turned off in the configuration.' }), el('div', { class: 'row' }, MB.field('Capture mode', modeSel), MB.field('Audio source', sourceSel)), el('label', { class: 'row' }, autoAsk, el('span', { text: 'Answer automatically when I finish speaking (automatic mode only)' }))),
        el('div', { class: 'card' }, el('h3', { text: 'About' }), el('p', { class: 'sub', text: info ? `${info.name} ${info.version} on ${info.platform}` : '' }), el('p', { class: 'sub', text: appCfg ? `Data folder: ${appCfg.dataDir}` : '' }))
      );
    },
  };
})();
