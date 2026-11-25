'use strict';

const { BASE_RULES, DEFAULT_MODE, resolveMode } = require('./modes');
const { DEFAULT_STYLE, resolveStyle } = require('./styles');
const { resolveLanguage } = require('./languages');

const DEFAULT_LANGUAGE = 'python';
const DEFAULT_HISTORY = 15;

function pick(value, resolver, fallbackId, label) {
  const resolved = resolver(value ?? fallbackId);
  if (!resolved) throw new Error(`Unknown ${label}: ${value}`);
  return resolved;
}

function buildSystemPrompt({ mode = DEFAULT_MODE, language = DEFAULT_LANGUAGE, style = DEFAULT_STYLE } = {}) {
  const m = pick(mode, resolveMode, DEFAULT_MODE, 'mode');
  const s = pick(style, resolveStyle, DEFAULT_STYLE, 'style');
  const sections = [BASE_RULES, m.prompt];
  if (m.needsLanguage) {
    const lang = pick(language, resolveLanguage, DEFAULT_LANGUAGE, 'language');
    sections.push(
      `Answer in ${lang.label} only. Tag every code block with \`\`\`${lang.fence}. Do not offer other languages unless asked.`
    );
  }
  sections.push(`Answer depth: ${s.label}. ${s.instruction}`);
  return sections.join('\n\n');
}

/** Keep the most recent messages, and never start with an assistant turn. */
function trimHistory(history = [], limit = DEFAULT_HISTORY) {
  const recent = limit > 0 ? history.slice(-limit) : [];
  while (recent.length && recent[0].role !== 'user') recent.shift();
  return recent;
}

function userContent({ text, images }) {
  const parts = [];
  if (text && text.trim()) parts.push({ type: 'text', text: text.trim() });
  for (const img of images || []) parts.push({ type: 'image', mimeType: img.mimeType, data: img.data });
  return parts;
}

/**
 * Build an LlmService request for one learner turn.
 * input: { text?, images?: [{mimeType, data}] }
 */
function buildRequest({ mode, language, style, history = [], input, maxHistory = DEFAULT_HISTORY } = {}) {
  const content = userContent(input || {});
  if (content.length === 0) throw new Error('Nothing to send: provide text or an image');
  const s = pick(style, resolveStyle, DEFAULT_STYLE, 'style');
  const onlyText = content.length === 1 && content[0].type === 'text';
  return {
    system: buildSystemPrompt({ mode, language, style }),
    messages: [...trimHistory(history, maxHistory), { role: 'user', content: onlyText ? content[0].text : content }],
    maxTokens: s.maxTokens,
  };
}

module.exports = { buildSystemPrompt, buildRequest, trimHistory, DEFAULT_LANGUAGE, DEFAULT_HISTORY };
