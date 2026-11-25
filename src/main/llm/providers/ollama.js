'use strict';

const { LlmError } = require('../errors');
const { postJson, parseNDJSON } = require('../http');
const { textOf, imagesOf } = require('../message');

const NAME = 'ollama';

function buildBody(request, settings, model) {
  const messages = [];
  if (request.system) messages.push({ role: 'system', content: request.system });
  for (const m of request.messages) {
    const images = imagesOf(m.content).map((p) => p.data);
    messages.push({ role: m.role, content: textOf(m.content), ...(images.length ? { images } : {}) });
  }
  return {
    model,
    stream: true,
    messages,
    options: {
      temperature: request.temperature ?? settings.temperature ?? 0.7,
      num_predict: request.maxTokens ?? settings.maxTokens ?? 4096,
    },
  };
}

/** Local models through an Ollama server. No API key needed. */
function createOllamaProvider(settings, { fetch: fetchImpl = globalThis.fetch }) {
  const model = settings.model || 'llama3.2';
  const baseUrl = (settings.baseUrl || 'http://127.0.0.1:11434').replace(/\/$/, '');

  return {
    name: NAME,
    model,
    supportsImages: Boolean(settings.supportsImages),
    isConfigured: () => true,
    async *stream(request) {
      const response = await postJson(fetchImpl, `${baseUrl}/api/chat`, {
        body: buildBody(request, settings, model),
        timeoutMs: settings.timeoutMs ?? 60000,
        signal: request.signal,
        provider: NAME,
      });
      for await (const line of parseNDJSON(response.body)) {
        if (line.error) throw new LlmError(String(line.error), { kind: 'server', provider: NAME });
        if (line.message?.content) yield line.message.content;
        if (line.done) return;
      }
    },
  };
}

module.exports = { createOllamaProvider, buildBody };
