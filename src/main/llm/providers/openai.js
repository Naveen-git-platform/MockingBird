'use strict';

const { LlmError } = require('../errors');
const { postJson, getJson, parseSSE, safeJson } = require('../http');
const { toParts } = require('../message');

const NAME = 'openai';

function buildBody(request, settings, model) {
  const messages = [];
  if (request.system) messages.push({ role: 'system', content: request.system });
  for (const m of request.messages) {
    const parts = toParts(m.content);
    const hasImage = parts.some((p) => p.type === 'image');
    messages.push({
      role: m.role,
      content: hasImage
        ? parts.map((p) =>
            p.type === 'image'
              ? { type: 'image_url', image_url: { url: `data:${p.mimeType};base64,${p.data}` } }
              : { type: 'text', text: p.text }
          )
        : parts.map((p) => p.text).join('\n'),
    });
  }
  return {
    model,
    stream: true,
    messages,
    temperature: request.temperature ?? settings.temperature ?? 0.7,
    max_tokens: request.maxTokens ?? settings.maxTokens ?? 4096,
  };
}

/**
 * Build a provider for any OpenAI-compatible chat API. Used for OpenAI itself and for
 * gateways such as OpenRouter, which only differ by name, default model, URL and headers.
 */
function createCompatibleProvider({ name, label, defaultModel, defaultBaseUrl, extraHeaders = {}, publicModelList = false }) {
  return function create(settings, { fetch: fetchImpl = globalThis.fetch, getApiKey }) {
    const model = settings.model || defaultModel;
    const baseUrl = (settings.baseUrl || defaultBaseUrl).replace(/\/$/, '');

    return {
      name,
      model,
      supportsImages: true,
      isConfigured: () => Boolean(getApiKey(name)),
      /** Model ids the service offers. OpenRouter's list is public; OpenAI's needs the key. */
      async listModels() {
        const key = getApiKey(name);
        if (!publicModelList && !key) throw new LlmError(`${label} API key is not set`, { kind: 'config', provider: name });
        const headers = key ? { authorization: `Bearer ${key}`, ...extraHeaders } : { ...extraHeaders };
        const data = await getJson(fetchImpl, `${baseUrl}/models`, { headers, provider: name });
        return (data.data || []).map((m) => String(m.id)).sort();
      },
      async *stream(request) {
        const key = getApiKey(name);
        if (!key) throw new LlmError(`${label} API key is not set`, { kind: 'config', provider: name });
        const response = await postJson(fetchImpl, `${baseUrl}/chat/completions`, {
          headers: { authorization: `Bearer ${key}`, ...extraHeaders },
          body: buildBody(request, settings, model),
          timeoutMs: settings.timeoutMs ?? 30000,
          signal: request.signal,
          provider: name,
        });
        for await (const evt of parseSSE(response.body)) {
          if (evt.data === '[DONE]') return;
          const payload = safeJson(evt.data, name);
          if (payload.error) {
            throw new LlmError(payload.error.message || `${label} stream error`, { kind: 'server', provider: name });
          }
          const delta = payload.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        }
      },
    };
  };
}

const createOpenAIProvider = createCompatibleProvider({
  name: NAME,
  label: 'OpenAI',
  defaultModel: 'gpt-4o-mini',
  defaultBaseUrl: 'https://api.openai.com/v1',
});

/** OpenRouter: one key, many models (for example `google/gemini-2.5-flash`). */
const createOpenRouterProvider = createCompatibleProvider({
  name: 'openrouter',
  label: 'OpenRouter',
  defaultModel: 'google/gemini-2.5-flash',
  defaultBaseUrl: 'https://openrouter.ai/api/v1',
  publicModelList: true,
  extraHeaders: { 'HTTP-Referer': 'https://github.com/Naveen-git-platform/MockingBird', 'X-Title': 'MockingBird' },
});

module.exports = { createOpenAIProvider, createOpenRouterProvider, createCompatibleProvider, buildBody };
