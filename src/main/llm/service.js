'use strict';

const { LlmError } = require('./errors');
const { imagesOf } = require('./message');

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs a request against an ordered chain of providers. Retries transient failures
 * with exponential backoff, then falls back to the next provider. Once any text has
 * been streamed, failures are surfaced instead of retried, so output is never duplicated.
 */
class LlmService {
  constructor({ providers, maxRetries = 2, baseDelayMs = 400, sleep = defaultSleep, logger = null }) {
    if (!Array.isArray(providers) || providers.length === 0) {
      throw new Error('LlmService needs at least one provider');
    }
    this.providers = providers;
    this.maxRetries = maxRetries;
    this.baseDelayMs = baseDelayMs;
    this.sleep = sleep;
    this.logger = logger;
  }

  describe() {
    return this.providers.map((p) => ({ name: p.name, model: p.model, configured: p.isConfigured(), supportsImages: p.supportsImages }));
  }

  async generate(request, { onDelta, signal } = {}) {
    const needsImages = request.messages.some((m) => imagesOf(m.content).length > 0);
    const candidates = this.providers.filter((p) => !needsImages || p.supportsImages);
    if (candidates.length === 0) {
      throw new LlmError('No configured provider can read images', { kind: 'config' });
    }

    let lastError = null;
    for (const provider of candidates) {
      if (!provider.isConfigured()) {
        lastError = new LlmError(`${provider.name} is not configured`, { kind: 'config', provider: provider.name });
        continue;
      }
      for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
        let text = '';
        try {
          for await (const delta of provider.stream({ ...request, signal })) {
            text += delta;
            if (onDelta) onDelta(delta);
          }
          return { text, provider: provider.name, model: provider.model };
        } catch (err) {
          const error = err instanceof LlmError ? err : new LlmError(err.message, { kind: 'unknown', provider: provider.name, cause: err });
          lastError = error;
          this.logger?.warn('llm attempt failed', { provider: provider.name, attempt, kind: error.kind });
          if (error.kind === 'aborted') throw error;
          if (text.length > 0) throw error;
          if (!error.retryable) break;
          if (attempt < this.maxRetries) await this.sleep(this.baseDelayMs * 2 ** attempt);
        }
      }
    }
    throw lastError || new LlmError('No provider available', { kind: 'config' });
  }
}

/**
 * Build a service from config. The provider order is `llm.chain` when set, otherwise
 * `llm.primary` first followed by every other provider; unconfigured ones are skipped at
 * request time, so the extras only act as fallbacks.
 * `service.rebuild()` re-reads the config (call it after settings change).
 */
function createLlmService(config, { createProvider, logger, sleep, fetch, getApiKey, providerNames } = {}) {
  const names = providerNames || ['gemini', 'openai', 'anthropic', 'ollama'];
  const deps = {};
  if (fetch) deps.fetch = fetch;
  if (getApiKey) deps.getApiKey = getApiKey;

  const build = () => {
    const explicit = config.get('llm.chain');
    const primary = config.get('llm.primary', names[0]);
    const chain = Array.isArray(explicit) && explicit.length ? explicit : [primary, ...names.filter((n) => n !== primary)];
    return chain.map((name) => createProvider(name, config.get(`llm.providers.${name}`, {}), deps));
  };

  const service = new LlmService({
    providers: build(),
    maxRetries: config.get('llm.maxRetries', 2),
    baseDelayMs: config.get('llm.baseDelayMs', 400),
    sleep,
    logger,
  });
  service.rebuild = () => {
    service.providers = build();
  };
  return service;
}

module.exports = { LlmService, createLlmService };
