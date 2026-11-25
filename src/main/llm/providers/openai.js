'use strict';

const { LlmError } = require('../errors');
const { postJson, parseSSE, safeJson } = require('../http');
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

/** Works with OpenAI and any OpenAI-compatible server via `baseUrl`. */
function createOpenAIProvider(settings, { fetch: fetchImpl = globalThis.fetch, getApiKey }) {
  const model = settings.model || 'gpt-4o-mini';
  const baseUrl = (settings.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');

  return {
    name: NAME,
    model,
    supportsImages: true,
    isConfigured: () => Boolean(getApiKey(NAME)),
    async *stream(request) {
      const key = getApiKey(NAME);
      if (!key) throw new LlmError('OpenAI API key is not set', { kind: 'config', provider: NAME });
      const response = await postJson(fetchImpl, `${baseUrl}/chat/completions`, {
        headers: { authorization: `Bearer ${key}` },
        body: buildBody(request, settings, model),
        timeoutMs: settings.timeoutMs ?? 30000,
        signal: request.signal,
        provider: NAME,
      });
      for await (const evt of parseSSE(response.body)) {
        if (evt.data === '[DONE]') return;
        const payload = safeJson(evt.data, NAME);
        if (payload.error) {
          throw new LlmError(payload.error.message || 'OpenAI stream error', { kind: 'server', provider: NAME });
        }
        const delta = payload.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      }
    },
  };
}

module.exports = { createOpenAIProvider, buildBody };
