'use strict';

/** Build a streaming Response from string chunks. */
function streamResponse(chunks, { status = 200 } = {}) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { status });
}

function sse(events) {
  return events.map((e) => (typeof e === 'string' ? `data: ${e}\n\n` : `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`));
}

/** fetch stand-in that records calls and replays queued responses (or functions). */
function fakeFetch(...queue) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: init?.body ? JSON.parse(init.body) : undefined });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    return typeof next === 'function' ? next(url, init) : next;
  };
  fn.calls = calls;
  return fn;
}

async function collect(iterable) {
  let out = '';
  for await (const part of iterable) out += part;
  return out;
}

module.exports = { streamResponse, sse, fakeFetch, collect };
