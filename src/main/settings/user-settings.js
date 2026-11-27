'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ACTIONS, isValidAccelerator } = require('../shortcuts');
const { resolveMode } = require('../modes/modes');
const { resolveStyle } = require('../modes/styles');
const { resolveLanguage } = require('../modes/languages');
const { isTheme } = require('../../shared/themes');

/**
 * User-chosen settings that persist between runs (a small JSON file). Only an allowlist of
 * keys is accepted so the renderer cannot write arbitrary configuration.
 */
const ALLOWED = ({
  'llm.primary': (v, ctx) => ctx.providers.includes(v),
  'llm.providers.gemini.model': (v) => modelOk(v),
  'llm.providers.openai.model': (v) => modelOk(v),
  'llm.providers.openrouter.model': (v) => modelOk(v),
  'llm.providers.anthropic.model': (v) => modelOk(v),
  'llm.providers.ollama.model': (v) => modelOk(v),
  'routing.target': (v) => ['chat', 'overlay', 'both'].includes(v),
  'overlay.opacity': (v) => typeof v === 'number' && v >= 0.3 && v <= 1,
  'overlay.style': (v) => ['solid', 'glass', 'acrylic'].includes(v),
  'overlay.glass': (v) => typeof v === 'number' && v >= 0.05 && v <= 0.95,
  'llm.providers.ollama.baseUrl': (v) => /^https?:\/\/[^\s]+$/.test(v) && v.length < 200,
});

for (const action of Object.keys(ACTIONS)) ALLOWED[`shortcuts.${action}`] = (v) => isValidAccelerator(v);
Object.assign(ALLOWED, {
  'ui.theme': (v) => isTheme(v),
  'shortcuts.enabled': (v) => typeof v === 'boolean',
  'practice.mode': (v) => typeof v === 'string' && resolveMode(v) !== null,
  'practice.style': (v) => typeof v === 'string' && resolveStyle(v) !== null,
  'practice.language': (v) => typeof v === 'string' && Boolean(resolveLanguage(v)) && resolveLanguage(v).id === v,
});

function modelOk(v) {
  return typeof v === 'string' && /^[\w./:@-]{1,100}$/.test(v);
}

class UserSettings {
  constructor({ file, providers, fsImpl = fs }) {
    this.file = file;
    this.providers = providers;
    this.fs = fsImpl;
  }

  load() {
    try {
      const data = JSON.parse(this.fs.readFileSync(this.file, 'utf8'));
      return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch {
      return {};
    }
  }

  /** Flat `{ 'llm.primary': 'openai', ... }` to nested overrides for Config. */
  overrides() {
    const out = {};
    for (const [key, value] of Object.entries(this.load())) {
      const check = ALLOWED[key];
      if (!check || !check(value, { providers: this.providers })) continue;
      const parts = key.split('.');
      let node = out;
      for (const part of parts.slice(0, -1)) node = node[part] ||= {};
      node[parts[parts.length - 1]] = value;
    }
    return out;
  }

  set(key, value) {
    const check = ALLOWED[key];
    if (!check) throw new Error(`Setting not allowed: ${key}`);
    if (!check(value, { providers: this.providers })) throw new Error(`Invalid value for ${key}`);
    const data = this.load();
    data[key] = value;
    this.fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    this.fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    this.fs.renameSync(tmp, this.file);
  }
}

Object.freeze(ALLOWED);

module.exports = { UserSettings, ALLOWED };
