/* Settings view: AI provider status, voice preferences, app info. */
(function () {
  const MB = window.MB;
  const { el } = MB;

  const KEY_HINTS = { gemini: 'GEMINI_API_KEY', openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY' };

  MB.views.settings = {
    async mount(host) {
      const [providers, info, voiceCfg, appCfg] = await Promise.all([
        MB.call('llm:status'),
        MB.call('app:info'),
        MB.call('config:get', 'voice'),
        MB.call('config:get', 'app'),
      ]);

      const providerRows = (providers || []).map((p) =>
        el(
          'div',
          { class: 'row' },
          el('b', { text: p.name }),
          el('span', { class: 'sub grow', text: p.model }),
          el('span', { class: `badge ${p.configured ? 'good' : 'bad'}`, text: p.configured ? 'ready' : KEY_HINTS[p.name] ? `set ${KEY_HINTS[p.name]}` : 'not configured' })
        )
      );

      const mode = MB.select(
        [{ id: 'vad', label: 'Automatic (detect pauses)' }, { id: 'manual', label: 'Manual (press to start and stop)' }],
        MB.prefs.get('voiceMode', (voiceCfg && voiceCfg.mode) || 'vad'),
        (v) => MB.prefs.set('voiceMode', v)
      );
      const source = MB.select(
        [{ id: 'mic', label: 'Microphone' }, { id: 'system', label: 'System audio (Windows)' }],
        MB.prefs.get('voiceSource', 'mic'),
        (v) => MB.prefs.set('voiceSource', v)
      );

      host.append(
        el(
          'section',
          { class: 'view' },
          el('div', { class: 'view-head' }, el('div', {}, el('h1', { text: 'Settings' }), el('p', { class: 'sub', text: 'AI providers, voice and app details.' }))),
          el(
            'div',
            { class: 'card' },
            el('h3', { text: 'AI providers' }),
            el('p', { class: 'sub', text: 'Providers are tried in this order. Add an API key through the environment variable shown, then restart MockingBird.' }),
            ...(providerRows.length ? providerRows : [el('p', { class: 'sub', text: 'No providers loaded.' })])
          ),
          el(
            'div',
            { class: 'card' },
            el('h3', { text: 'Voice input' }),
            el('p', { class: 'sub', text: voiceCfg && voiceCfg.enabled ? `Speech is transcribed locally with Whisper (${voiceCfg.model} model).` : 'Voice input is turned off in the configuration.' }),
            el('div', { class: 'row' }, MB.field('Capture mode', mode), MB.field('Audio source', source))
          ),
          el('div', { class: 'card' }, el('h3', { text: 'About' }), el('p', { class: 'sub', text: info ? `${info.name} ${info.version} on ${info.platform}` : '' }), el('p', { class: 'sub', text: appCfg ? `Data folder: ${appCfg.dataDir}` : '' }))
        )
      );
    },
  };
})();
