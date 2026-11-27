const test = require('node:test');
const assert = require('node:assert/strict');
const { createProvider, listProviderNames } = require('../src/main/llm/registry');
const { LlmError } = require('../src/main/llm/errors');
const { streamResponse, sse, fakeFetch, collect } = require('./helpers/fake-fetch');

const keys = { gemini: 'g-key', openai: 'o-key', anthropic: 'a-key', openrouter: 'r-key' };
const getApiKey = (n) => keys[n] || '';
const IMG = { type: 'image', mimeType: 'image/png', data: 'QUJD' };
const base = { system: 'be brief', messages: [{ role: 'user', content: 'hi' }] };

test('registry lists the five providers and rejects unknown ones', () => {
  assert.deepEqual(listProviderNames().sort(), ['anthropic', 'gemini', 'ollama', 'openai', 'openrouter']);
  assert.throws(() => createProvider('nope'), /Unknown LLM provider/);
});

test('gemini: builds request and streams text, skipping thought parts', async () => {
  const f = fakeFetch(
    streamResponse(
      sse([
        JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Hel' }] } }] }),
        JSON.stringify({ candidates: [{ content: { parts: [{ text: 'secret', thought: true }, { text: 'lo' }] } }] }),
      ])
    )
  );
  const p = createProvider('gemini', { model: 'gemini-x' }, { fetch: f, getApiKey });
  const out = await collect(p.stream({ ...base, messages: [{ role: 'user', content: ['q', IMG].map((x) => (x === 'q' ? { type: 'text', text: 'q' } : x)) }] }));
  assert.equal(out, 'Hello');
  const call = f.calls[0];
  assert.match(call.url, /models\/gemini-x:streamGenerateContent\?alt=sse$/);
  assert.equal(call.init.headers['x-goog-api-key'], 'g-key');
  assert.equal(call.body.systemInstruction.parts[0].text, 'be brief');
  assert.deepEqual(call.body.contents[0].parts[1], { inlineData: { mimeType: 'image/png', data: 'QUJD' } });
});

test('gemini: assistant role becomes model', async () => {
  const f = fakeFetch(streamResponse(sse([])));
  const p = createProvider('gemini', {}, { fetch: f, getApiKey });
  await collect(p.stream({ messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] }));
  assert.equal(f.calls[0].body.contents[1].role, 'model');
});

test('openai: streams deltas until [DONE] and sends bearer auth', async () => {
  const f = fakeFetch(
    streamResponse(
      sse([
        JSON.stringify({ choices: [{ delta: { content: 'A' } }] }),
        JSON.stringify({ choices: [{ delta: {} }] }),
        JSON.stringify({ choices: [{ delta: { content: 'B' } }] }),
        '[DONE]',
        JSON.stringify({ choices: [{ delta: { content: 'ignored' } }] }),
      ])
    )
  );
  const p = createProvider('openai', {}, { fetch: f, getApiKey });
  assert.equal(await collect(p.stream(base)), 'AB');
  const call = f.calls[0];
  assert.equal(call.init.headers.authorization, 'Bearer o-key');
  assert.equal(call.body.messages[0].role, 'system');
  assert.equal(call.body.stream, true);
});

test('openai: images become data-URL image_url parts; text-only stays a string', async () => {
  const f = fakeFetch(streamResponse(sse(['[DONE]'])));
  const p = createProvider('openai', {}, { fetch: f, getApiKey });
  await collect(p.stream({ messages: [{ role: 'user', content: [{ type: 'text', text: 't' }, IMG] }, { role: 'user', content: 'plain' }] }));
  const [withImg, plain] = f.calls[0].body.messages;
  assert.equal(withImg.content[1].image_url.url, 'data:image/png;base64,QUJD');
  assert.equal(plain.content, 'plain');
});

test('openai: honours a custom baseUrl for compatible servers', async () => {
  const f = fakeFetch(streamResponse(sse(['[DONE]'])));
  const p = createProvider('openai', { baseUrl: 'http://localhost:1234/v1/' }, { fetch: f, getApiKey });
  await collect(p.stream(base));
  assert.equal(f.calls[0].url, 'http://localhost:1234/v1/chat/completions');
});

test('anthropic: streams text_delta events and stops at message_stop', async () => {
  const f = fakeFetch(
    streamResponse(
      sse([
        { event: 'message_start', data: { type: 'message_start' } },
        { event: 'content_block_delta', data: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } } },
        { event: 'content_block_delta', data: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{}' } } },
        { event: 'content_block_delta', data: { type: 'content_block_delta', delta: { type: 'text_delta', text: '!' } } },
        { event: 'message_stop', data: { type: 'message_stop' } },
      ])
    )
  );
  const p = createProvider('anthropic', {}, { fetch: f, getApiKey });
  assert.equal(await collect(p.stream({ ...base, messages: [{ role: 'user', content: [IMG] }] })), 'Hi!');
  const call = f.calls[0];
  assert.equal(call.init.headers['x-api-key'], 'a-key');
  assert.equal(call.init.headers['anthropic-version'], '2023-06-01');
  assert.equal(call.body.system, 'be brief');
  assert.deepEqual(call.body.messages[0].content[0].source, { type: 'base64', media_type: 'image/png', data: 'QUJD' });
});

test('anthropic: stream error events become LlmErrors (overloaded is retryable)', async () => {
  const f = fakeFetch(streamResponse(sse([{ event: 'error', data: { type: 'error', error: { type: 'overloaded_error', message: 'busy' } } }])));
  const p = createProvider('anthropic', {}, { fetch: f, getApiKey });
  await assert.rejects(collect(p.stream(base)), (e) => e instanceof LlmError && e.retryable && /busy/.test(e.message));
});

test('ollama: needs no key, streams NDJSON and attaches images', async () => {
  const f = fakeFetch(
    streamResponse([
      JSON.stringify({ message: { content: 'x' }, done: false }) + '\n',
      JSON.stringify({ message: { content: 'y' }, done: false }) + '\n' + JSON.stringify({ done: true }) + '\n',
    ])
  );
  const p = createProvider('ollama', { supportsImages: true }, { fetch: f, getApiKey });
  assert.equal(p.isConfigured(), true);
  assert.equal(await collect(p.stream({ ...base, messages: [{ role: 'user', content: [{ type: 'text', text: 'look' }, IMG] }] })), 'xy');
  assert.equal(f.calls[0].url, 'http://127.0.0.1:11434/api/chat');
  assert.deepEqual(f.calls[0].body.messages[1].images, ['QUJD']);
});

test('ollama: error lines throw', async () => {
  const f = fakeFetch(streamResponse([JSON.stringify({ error: 'model not found' }) + '\n']));
  const p = createProvider('ollama', {}, { fetch: f, getApiKey });
  await assert.rejects(collect(p.stream(base)), /model not found/);
});

test('missing API key raises a non-retryable config error before any request', async () => {
  const f = fakeFetch(streamResponse([]));
  const p = createProvider('openai', {}, { fetch: f, getApiKey: () => '' });
  assert.equal(p.isConfigured(), false);
  await assert.rejects(collect(p.stream(base)), (e) => e.kind === 'config' && !e.retryable);
  assert.equal(f.calls.length, 0);
});

test('malformed stream payloads surface as server errors', async () => {
  const f = fakeFetch(streamResponse(['data: {not json\n\n']));
  const p = createProvider('openai', {}, { fetch: f, getApiKey });
  await assert.rejects(collect(p.stream(base)), (e) => e.kind === 'server');
});

test('openrouter: uses its own key, URL, default model and attribution headers', async () => {
  const f = fakeFetch(streamResponse(sse([JSON.stringify({ choices: [{ delta: { content: 'pong' } }] }), '[DONE]'])));
  const p = createProvider('openrouter', {}, { fetch: f, getApiKey });
  assert.equal(p.name, 'openrouter');
  assert.equal(p.model, 'google/gemini-2.5-flash');
  assert.equal(await collect(p.stream(base)), 'pong');
  const call = f.calls[0];
  assert.equal(call.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(call.init.headers.authorization, 'Bearer r-key');
  assert.equal(call.init.headers['X-Title'], 'MockingBird');
  assert.match(call.init.headers['HTTP-Referer'], /^https:\/\/github\.com\//);
  assert.equal(call.body.model, 'google/gemini-2.5-flash');
});

test('openrouter: a configured model overrides the default, and the OpenAI key is not used', async () => {
  const f = fakeFetch(streamResponse(sse(['[DONE]'])));
  const p = createProvider('openrouter', { model: 'anthropic/claude-3.5-sonnet' }, { fetch: f, getApiKey: (n) => (n === 'openai' ? 'wrong' : '') });
  assert.equal(p.isConfigured(), false);
  await assert.rejects(collect(p.stream(base)), (e) => e.kind === 'config' && /OpenRouter API key is not set/.test(e.message));
  const q = createProvider('openrouter', { model: 'anthropic/claude-3.5-sonnet' }, { fetch: f, getApiKey });
  await collect(q.stream(base));
  assert.equal(f.calls[0].body.model, 'anthropic/claude-3.5-sonnet');
});

test('openrouter: images, stream errors and HTTP errors behave like OpenAI', async () => {
  const f = fakeFetch(streamResponse(sse([JSON.stringify({ error: { message: 'No endpoints found for model' } })])));
  const p = createProvider('openrouter', {}, { fetch: f, getApiKey });
  await assert.rejects(collect(p.stream({ messages: [{ role: 'user', content: [{ type: 'text', text: 't' }, IMG] }] })), (e) => e.kind === 'server' && e.provider === 'openrouter' && /No endpoints/.test(e.message));
  assert.equal(f.calls[0].body.messages[0].content[1].image_url.url, 'data:image/png;base64,QUJD');
  const denied = createProvider('openrouter', {}, { fetch: fakeFetch(new Response('bad key', { status: 401 })), getApiKey });
  await assert.rejects(collect(denied.stream(base)), (e) => e.kind === 'auth' && e.provider === 'openrouter');
});

test('openrouter comment lines in the stream are ignored', async () => {
  const f = fakeFetch(streamResponse([': OPENROUTER PROCESSING\n\n', `data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\n`, 'data: [DONE]\n\n']));
  assert.equal(await collect(createProvider('openrouter', {}, { fetch: f, getApiKey }).stream(base)), 'ok');
});
