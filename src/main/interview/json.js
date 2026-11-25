'use strict';

/**
 * Pull a JSON object out of model output. Handles raw JSON, ```json fences,
 * and JSON surrounded by prose. Throws if nothing parseable is found.
 */
function extractJson(text) {
  if (typeof text !== 'string' || !text.trim()) throw new Error('Empty model response');
  const attempts = [text.trim()];

  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence) attempts.push(fence[1].trim());

  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) attempts.push(text.slice(start, end + 1));

  for (const candidate of attempts) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch {
      // try the next strategy
    }
  }
  throw new Error('Model response did not contain valid JSON');
}

module.exports = { extractJson };
