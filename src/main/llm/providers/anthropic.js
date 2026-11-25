'use strict';

const { LlmError } = require('../errors');
const { postJson, parseSSE, safeJson } = require('../http');
const { toParts } = require('../message');

const NAME = 'anthropic';

function buildBody(request, settings, model) {
  const body = {
    model,
    stream: true,
    max_tokens: request.maxTokens ?? settings.maxTokens ?? 4096,
    temperature: request.temperature ?? settings.temperature ?? 0.7,
    messages: request.messages.map((m) => ({
      role: m.role,
      content: toParts(m.content).map((p) =>
        p.type === 'image'
          ? { type: 'image', source: { type: 'base64', media_type: p.mimeType, data: p.data } }
          : { type: 'text', text: p.text }
      ),
    })),
  };
  if (request.system) body.system = request.system;
  return body;
}

function createAnthropicProvider(settings, { fetch: fetchImpl = globalThis.fetch, getApiKey }) {
  const model = settings.model || 'claude-sonnet-5-5';
  const baseUrl = (settings.baseUrl || 'https://api.anthropic.com/v1').replace(/\/$/, '');

  return {
    name: NAME,
    model,
    supportsImages: true,
    isConfigured: () => Boolean(getApiKey(NAME)),
    async *stream(request) {
      const key = getApiKey(NAME);
      if (!key) throw new LlmError('Anthropic API key is not set', { kind: 'config', provider: NAME });
      const response = await postJson(fetchImpl, `${baseUrl}/messages`, {
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
        body: buildBody(request, settings, model),
        timeoutMs: settings.timeoutMs ?? 30000,
        signal: request.signal,
        provider: NAME,
      });
      for await (const evt of parseSSE(response.body)) {
        const payload = safeJson(evt.data, NAME);
        if (evt.event === 'error' || payload.type === 'error') {
          const kind = payload.error?.type === 'overloaded_error' ? 'server' : 'unknown';
          throw new LlmError(payload.error?.message || 'Anthropic stream error', { kind, provider: NAME });
        }
        if (payload.type === 'content_block_delta' && payload.delta?.type === 'text_delta') {
          yield payload.delta.text;
        }
        if (payload.type === 'message_stop') return;
      }
    },
  };
}

module.exports = { createAnthropicProvider, buildBody };
