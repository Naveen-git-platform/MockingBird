'use strict';

const LANGUAGES = Object.freeze([
  { id: 'python', label: 'Python', fence: 'python', aliases: ['py', 'python3'] },
  { id: 'javascript', label: 'JavaScript', fence: 'javascript', aliases: ['js', 'node', 'nodejs'] },
  { id: 'typescript', label: 'TypeScript', fence: 'typescript', aliases: ['ts'] },
  { id: 'java', label: 'Java', fence: 'java', aliases: [] },
  { id: 'cpp', label: 'C++', fence: 'cpp', aliases: ['c++', 'cplusplus'] },
  { id: 'c', label: 'C', fence: 'c', aliases: [] },
  { id: 'csharp', label: 'C#', fence: 'csharp', aliases: ['c#', 'cs'] },
  { id: 'go', label: 'Go', fence: 'go', aliases: ['golang'] },
  { id: 'rust', label: 'Rust', fence: 'rust', aliases: ['rs'] },
  { id: 'kotlin', label: 'Kotlin', fence: 'kotlin', aliases: ['kt'] },
  { id: 'swift', label: 'Swift', fence: 'swift', aliases: [] },
  { id: 'sql', label: 'SQL', fence: 'sql', aliases: [] },
]);

const BY_KEY = new Map();
for (const lang of LANGUAGES) {
  BY_KEY.set(lang.id, lang);
  for (const alias of lang.aliases) BY_KEY.set(alias, lang);
}

/** Resolve an id, alias or label (case-insensitive) to a language, or null. */
function resolveLanguage(input) {
  if (typeof input !== 'string') return null;
  return BY_KEY.get(input.trim().toLowerCase()) || null;
}

module.exports = { LANGUAGES, resolveLanguage };
