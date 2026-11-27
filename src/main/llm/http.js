'use strict';

const { LlmError, kindFromStatus } = require('./errors');

/**
 * POST JSON and return the Response once headers arrive. The timeout only covers
 * the wait for headers so long streamed answers are not cut off.
 */
async function postJson(fetchImpl, url, { headers = {}, body, timeoutMs = 30000, signal, provider }) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onExternalAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  let response;
  try {
    response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (timedOut) throw new LlmError(`Request timed out after ${timeoutMs}ms`, { kind: 'timeout', provider, cause: err });
    if (signal?.aborted) throw new LlmError('Request aborted', { kind: 'aborted', provider, cause: err });
    throw new LlmError(`Network error: ${err.message}`, { kind: 'network', provider, cause: err });
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onExternalAbort);
  }

  if (!response.ok) {
    let detail = '';
    try {
      detail = (await response.text()).slice(0, 300);
    } catch {
      // ignore body read failures
    }
    throw new LlmError(`${provider || 'provider'} returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`, {
      kind: kindFromStatus(response.status),
      status: response.status,
      provider,
    });
  }
  return response;
}

/** GET JSON with a timeout; errors are mapped exactly like postJson. */
async function getJson(fetchImpl, url, { headers = {}, timeoutMs = 15000, signal, provider } = {}) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onExternalAbort = () => controller.abort();
  if (signal) signal.addEventListener('abort', onExternalAbort, { once: true });
  try {
    const response = await fetchImpl(url, { method: 'GET', headers, signal: controller.signal });
    if (!response.ok) {
      let detail = '';
      try {
        detail = (await response.text()).slice(0, 300);
      } catch {
        // ignore body read failures
      }
      throw new LlmError(`${provider || 'provider'} returned HTTP ${response.status}${detail ? `: ${detail}` : ''}`, {
        kind: kindFromStatus(response.status),
        status: response.status,
        provider,
      });
    }
    return await response.json();
  } catch (err) {
    if (err instanceof LlmError) throw err;
    if (timedOut) throw new LlmError(`Request timed out after ${timeoutMs}ms`, { kind: 'timeout', provider, cause: err });
    throw new LlmError(`Network error: ${err.message}`, { kind: 'network', provider, cause: err });
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onExternalAbort);
  }
}

async function* decodeLines(body) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body) {
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).replace(/\r$/, '');
      buffer = buffer.slice(idx + 1);
      yield line;
    }
  }
  buffer += decoder.decode();
  if (buffer.length) yield buffer.replace(/\r$/, '');
}

/** Parse a Server-Sent Events body into `{event, data}` objects. */
async function* parseSSE(body) {
  let event = null;
  let data = [];
  for await (const line of decodeLines(body)) {
    if (line === '') {
      if (data.length) yield { event, data: data.join('\n') };
      event = null;
      data = [];
    } else if (line.startsWith(':')) {
      continue;
    } else if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      data.push(line.slice(5).replace(/^ /, ''));
    }
  }
  if (data.length) yield { event, data: data.join('\n') };
}

/** Parse newline-delimited JSON (Ollama). */
async function* parseNDJSON(body) {
  for await (const line of decodeLines(body)) {
    if (!line.trim()) continue;
    yield JSON.parse(line);
  }
}

function safeJson(text, provider) {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new LlmError(`Malformed stream payload from ${provider}`, { kind: 'server', provider, cause: err });
  }
}

module.exports = { postJson, getJson, parseSSE, parseNDJSON, safeJson };
