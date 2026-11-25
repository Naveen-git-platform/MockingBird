'use strict';

/**
 * Provider-neutral message shape:
 *   { role: 'user' | 'assistant', content: string | Part[] }
 *   Part = { type: 'text', text } | { type: 'image', mimeType, data }   (data is base64)
 */
function toParts(content) {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  if (Array.isArray(content)) return content;
  return [];
}

function textOf(content) {
  return toParts(content)
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join('\n');
}

function imagesOf(content) {
  return toParts(content).filter((p) => p.type === 'image');
}

module.exports = { toParts, textOf, imagesOf };
