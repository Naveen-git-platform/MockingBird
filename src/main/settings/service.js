'use strict';

const { KEY_PROVIDERS, keySource } = require('./keys');
const { ACTIONS } = require('../shortcuts');
const { themeList } = require('../../shared/themes');

/** Settings operations used by the IPC layer. Never returns a key value. */
class SettingsService {
  constructor({ config, secrets, userSettings, llm, providerNames, env = process.env, onChange = null, shortcuts = null, extras = null }) {
    this.extras = extras;
    this.onChange = onChange;
    this.shortcuts = shortcuts;
    this.config = config;
    this.secrets = secrets;
    this.userSettings = userSettings;
    this.llm = llm;
    this.providerNames = providerNames;
    this.env = env;
  }

  get() {
    return {
      primary: this.config.get('llm.primary'),
      routing: this.config.get('routing.target'),
      theme: this.config.get('ui.theme'),
      themes: themeList(),
      practice: {
        mode: this.config.get('practice.mode'),
        language: this.config.get('practice.language'),
        style: this.config.get('practice.style'),
      },
      shortcutsEnabled: this.config.get('shortcuts.enabled'),
      shortcuts: this.shortcutRows(),
      overlayOpacity: this.config.get('overlay.opacity'),
      overlayStyle: this.config.get('overlay.style'),
      overlayGlass: this.config.get('overlay.glass'),
      ...(this.extras ? this.extras() : {}),
      secureStorage: this.secrets.available,
      providers: this.providerNames.map((name) => {
        const needsKey = KEY_PROVIDERS.includes(name);
        const source = needsKey ? keySource(name, { secrets: this.secrets, env: this.env }) : null;
        return {
          name,
          model: this.config.get(`llm.providers.${name}.model`),
          needsKey,
          keySource: source,
          configured: needsKey ? Boolean(source) : true,
        };
      }),
    };
  }

  shortcutRows() {
    const status = this.shortcuts ? this.shortcuts.status() : {};
    return Object.entries(ACTIONS).map(([action, meta]) => {
      const accelerator = this.config.get(`shortcuts.${action}`);
      const st = status[action] || { ok: false };
      return { action, label: meta.label, accelerator, defaultAccelerator: meta.accelerator, ok: Boolean(st.ok), error: st.error || null };
    });
  }

  /** Re-register every global shortcut from the current configuration. */
  applyShortcuts() {
    if (!this.shortcuts) return;
    const map = {};
    for (const action of Object.keys(ACTIONS)) map[action] = this.config.get(`shortcuts.${action}`);
    this.shortcuts.apply(map, { enabled: this.config.get('shortcuts.enabled') !== false });
  }

  /**
   * Send one tiny request to a provider and report what happened, including the provider's own
   * error text. On failure it also tries to list the models the key can use.
   */
  async testProvider(name) {
    const provider = this.llm.providers.find((p) => p.name === name);
    if (!provider) throw new Error(`Unknown provider: ${name}`);
    if (!provider.isConfigured()) return { ok: false, kind: 'config', error: 'No API key is saved for this provider.' };
    const started = Date.now();
    try {
      let text = '';
      for await (const delta of provider.stream({ messages: [{ role: 'user', content: 'Reply with exactly one word: pong' }], maxTokens: 30, temperature: 0 })) text += delta;
      return { ok: true, ms: Date.now() - started, reply: text.trim().slice(0, 60), model: provider.model };
    } catch (err) {
      const result = { ok: false, ms: Date.now() - started, kind: err.kind || 'unknown', status: err.status, error: String(err.message).slice(0, 400), model: provider.model };
      if (typeof provider.listModels === 'function' && (err.kind === 'bad_request' || err.kind === 'server')) {
        try {
          result.models = (await provider.listModels()).slice(0, 300);
        } catch (listErr) {
          result.modelsError = String(listErr.message).slice(0, 200);
        }
      }
      return result;
    }
  }

  _provider(name) {
    if (!KEY_PROVIDERS.includes(name)) throw new Error(`${name} does not use an API key`);
  }

  setKey(name, value) {
    this._provider(name);
    this.secrets.set(name, value);
    return this.get();
  }

  deleteKey(name) {
    this._provider(name);
    this.secrets.delete(name);
    return this.get();
  }

  /** Persist an allowlisted setting, apply it live, and rebuild the provider chain. */
  setSetting(key, value) {
    this.userSettings.set(key, value);
    this.config.set(key, value);
    this.llm.rebuild();
    if (key.startsWith('shortcuts.')) this.applyShortcuts();
    if (this.onChange) this.onChange(key, value);
    return this.get();
  }
}

module.exports = { SettingsService };
