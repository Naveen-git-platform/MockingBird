'use strict';

const KEY_PROVIDERS = Object.freeze(['gemini', 'openrouter', 'openai', 'anthropic']);
const ENV_KEYS = Object.freeze({ gemini: 'GEMINI_API_KEY', openrouter: 'OPENROUTER_API_KEY', openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY' });

/** Look up an API key: the encrypted store first, then the environment variable. */
function makeKeyResolver({ secrets, env = process.env }) {
  return (name) => {
    if (!KEY_PROVIDERS.includes(name)) return '';
    let stored = '';
    try {
      stored = secrets.get(name);
    } catch {
      stored = '';
    }
    return stored || env[ENV_KEYS[name]] || '';
  };
}

/** Where each provider's key comes from, without ever exposing the key itself. */
function keySource(name, { secrets, env = process.env }) {
  if (!KEY_PROVIDERS.includes(name)) return null;
  if (secrets.has(name) && secrets.get(name)) return 'stored';
  if (env[ENV_KEYS[name]]) return 'env';
  return null;
}

module.exports = { KEY_PROVIDERS, ENV_KEYS, makeKeyResolver, keySource };
