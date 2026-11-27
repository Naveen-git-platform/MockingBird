'use strict';

const { createGeminiProvider } = require('./providers/gemini');
const { createOpenAIProvider, createOpenRouterProvider } = require('./providers/openai');
const { createAnthropicProvider } = require('./providers/anthropic');
const { createOllamaProvider } = require('./providers/ollama');

const FACTORIES = {
  gemini: createGeminiProvider,
  openrouter: createOpenRouterProvider,
  openai: createOpenAIProvider,
  anthropic: createAnthropicProvider,
  ollama: createOllamaProvider,
};

const ENV_KEYS = {
  gemini: 'GEMINI_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
};

function listProviderNames() {
  return Object.keys(FACTORIES);
}

/** Default key lookup: environment variables. Later branches swap in encrypted storage. */
function envKeyResolver(env = process.env) {
  return (name) => env[ENV_KEYS[name]] || '';
}

function createProvider(name, settings = {}, deps = {}) {
  const factory = FACTORIES[name];
  if (!factory) throw new Error(`Unknown LLM provider: ${name}`);
  return factory(settings, { getApiKey: envKeyResolver(), ...deps });
}

module.exports = { createProvider, listProviderNames, envKeyResolver };
