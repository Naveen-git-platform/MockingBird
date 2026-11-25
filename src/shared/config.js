'use strict';

const os = require('node:os');
const path = require('node:path');

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, override) {
  const out = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    out[key] = isPlainObject(value) && isPlainObject(base[key]) ? deepMerge(base[key], value) : value;
  }
  return out;
}

function defaults(homeDir) {
  return {
    app: {
      name: 'MockingBird',
      dataDir: path.join(homeDir, '.MockingBird'),
    },
    window: {
      width: 980,
      height: 700,
      minWidth: 640,
      minHeight: 480,
      backgroundColor: '#0f1115',
    },
    logging: {
      level: 'info',
      toFile: true,
    },
    practice: {
      mode: 'dsa',
      language: 'python',
      style: 'guided',
      maxHistory: 15,
    },
    history: {
      enabled: true,
    },
    interview: {
      difficulty: 'medium',
      questionCount: 5,
      role: '',
    },
    voice: {
      enabled: true,
      model: 'small',
      language: 'auto',
      device: 'auto',
      mode: 'vad',
      source: 'mic',
      pythonPath: '',
      modelDir: '',
      manualMaxMs: 90000,
      idleUnloadMs: 60000,
      vad: {
        silenceHangoverMs: 700,
        minUtteranceMs: 350,
        maxUtteranceMs: 15000,
        preRollMs: 300,
        energyFloor: 0.008,
      },
    },
    llm: {
      chain: ['gemini'],
      maxRetries: 2,
      baseDelayMs: 400,
      providers: {
        gemini: { model: 'gemini-2.5-flash' },
        openai: { model: 'gpt-4o-mini' },
        anthropic: { model: 'claude-sonnet-5-5' },
        ollama: { model: 'llama3.2', baseUrl: 'http://127.0.0.1:11434' },
      },
    },
  };
}

/**
 * Small, dependency-free configuration store.
 * `get('window.width')` reads a dotted path; `set` writes one.
 */
class Config {
  constructor({ env = process.env, homeDir = os.homedir(), overrides = {} } = {}) {
    let data = deepMerge(defaults(homeDir), overrides);
    if (env.MOCKINGBIRD_DATA_DIR) {
      data = deepMerge(data, { app: { dataDir: env.MOCKINGBIRD_DATA_DIR } });
    }
    if (env.MOCKINGBIRD_LOG_LEVEL) {
      data = deepMerge(data, { logging: { level: env.MOCKINGBIRD_LOG_LEVEL } });
    }
    this.data = data;
  }

  get(keyPath, fallback) {
    const value = String(keyPath)
      .split('.')
      .reduce((node, key) => (node == null ? undefined : node[key]), this.data);
    return value === undefined ? fallback : value;
  }

  set(keyPath, value) {
    const keys = String(keyPath).split('.');
    const last = keys.pop();
    let node = this.data;
    for (const key of keys) {
      if (!isPlainObject(node[key])) node[key] = {};
      node = node[key];
    }
    node[last] = value;
  }

  toJSON() {
    return JSON.parse(JSON.stringify(this.data));
  }
}

module.exports = { Config, deepMerge };
