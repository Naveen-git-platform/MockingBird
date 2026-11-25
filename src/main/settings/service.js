'use strict';

const { KEY_PROVIDERS, keySource } = require('./keys');
const { ACTIONS } = require('../shortcuts');

/** Settings operations used by the IPC layer. Never returns a key value. */
class SettingsService {
  constructor({ config, secrets, userSettings, llm, providerNames, env = process.env, onChange = null, shortcuts = null }) {
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
      practice: {
        mode: this.config.get('practice.mode'),
        language: this.config.get('practice.language'),
        style: this.config.get('practice.style'),
      },
      shortcutsEnabled: this.config.get('shortcuts.enabled'),
      shortcuts: this.shortcutRows(),
      overlayOpacity: this.config.get('overlay.opacity'),
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
