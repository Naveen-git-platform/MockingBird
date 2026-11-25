'use strict';

const { LlmError } = require('../errors');
const { postJson, parseSSE, safeJson } = require('../http');
const { toParts } = require('../message');

const NAME = 'gemini';

function buildBody(request, settings) {
  const body = {
    contents: request.messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: toParts(m.content).map((p) =>
        p.type === 'image' ? { inlineData: { mimeType: p.mimeType, data: p.data } } : { text: p.text }
      ),
    })),
    generationConfig: {
      temperature: request.temperature ?? settings.temperature ?? 0.7,
      maxOutputTokens: request.maxTokens ?? settings.maxTokens ?? 4096,
    },
  };
  if (request.system) body.systemInstruction = { parts: [{ text: request.system }] };
  return body;
}

function createGeminiProvider(settings, { fetch: fetchImpl = globalThis.fetch, getApiKey }) {
  const model = settings.model || 'gemini-2.5-flash';
  const baseUrl = (settings.baseUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/$/, '');

  return {
    name: NAME,
    model,
    supportsImages: true,
    isConfigured: () => Boolean(getApiKey(NAME)),
    async *stream(request) {
      const key = getApiKey(NAME);
      if (!key) throw new LlmError('Gemini API key is not set', { kind: 'config', provider: NAME });
      const response = await postJson(fetchImpl, `${baseUrl}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
        headers: { 'x-goog-api-key': key },
        body: buildBody(request, settings),
        timeoutMs: settings.timeoutMs ?? 30000,
        signal: request.signal,
        provider: NAME,
      });
      for await (const evt of parseSSE(response.body)) {
        const payload = safeJson(evt.data, NAME);
        if (payload.error) {
          throw new LlmError(payload.error.message || 'Gemini stream error', { kind: 'server', provider: NAME });
        }
        const parts = payload.candidates?.[0]?.content?.parts || [];
        for (const part of parts) {
          if (part.text && !part.thought) yield part.text;
        }
      }
    },
  };
}

module.exports = { createGeminiProvider, buildBody };
