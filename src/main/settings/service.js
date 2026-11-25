'use strict';

const { KEY_PROVIDERS, keySource } = require('./keys');

/** Settings operations used by the IPC layer. Never returns a key value. */
class SettingsService {
  constructor({ config, secrets, userSettings, llm, providerNames, env = process.env, onChange = null }) {
    this.onChange = onChange;
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
    if (this.onChange) this.onChange(key, value);
    return this.get();
  }
}

module.exports = { SettingsService };
