'use strict';

const MODE_LABELS = {
  dsa: 'Data structures & algorithms',
  'system-design': 'System design',
  behavioral: 'Behavioral',
  sql: 'SQL & databases',
};

/** A fence longer than any backtick run inside, so user text cannot break out of the block. */
function fenced(text, lang = '') {
  const longest = Math.max(2, ...(text.match(/`+/g) || []).map((m) => m.length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}${lang}\n${text}\n${fence}`;
}

function formatDate(ms) {
  return ms ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'unknown';
}

function list(items) {
  return items.map((i) => `- ${i}`).join('\n');
}

/** Render a finished interview snapshot as a Markdown report. */
function sessionToMarkdown(snapshot) {
  if (!snapshot || snapshot.status !== 'finished') throw new Error('Only finished interviews can be exported');
  const r = snapshot.report || {};
  const lines = [];
  lines.push(`# MockingBird interview report`);
  lines.push('');
  lines.push(`- **Type:** ${MODE_LABELS[snapshot.mode] || snapshot.mode}`);
  if (snapshot.language) lines.push(`- **Language:** ${snapshot.language}`);
  lines.push(`- **Difficulty:** ${snapshot.difficulty}`);
  if (snapshot.role) lines.push(`- **Role:** ${snapshot.role}`);
  lines.push(`- **Date:** ${formatDate(snapshot.finishedAt)}`);
  lines.push(`- **Average score:** ${r.averageScore == null ? 'n/a' : `${r.averageScore}/10`}`);
  lines.push(`- **Answered:** ${r.questionsAnswered ?? 0} of ${r.questionsAsked ?? snapshot.questions.length}, hints used: ${r.hintsUsed ?? 0}`);
  lines.push('');
  if (r.summary) {
    lines.push('## Summary', '', r.summary, '');
    if (r.focusAreas?.length) lines.push('**Focus next on:**', '', list(r.focusAreas), '');
  }

  for (const q of snapshot.questions) {
    lines.push(`## Question ${q.index + 1}${q.evaluation ? ` (${q.evaluation.score}/10)` : q.skipped ? ' (skipped)' : ''}`, '');
    lines.push(q.text, '');
    if (q.hints.length) lines.push('**Hints used:**', '', list(q.hints), '');
    if (q.answer) {
      lines.push('**Your answer:**', '');
      lines.push(q.answer.text ? fenced(q.answer.text) : `_(${q.answer.imageCount} image attachment)_`, '');
    }
    if (q.evaluation) {
      const e = q.evaluation;
      if (e.summary) lines.push(e.summary, '');
      if (e.strengths.length) lines.push('**Strengths:**', '', list(e.strengths), '');
      if (e.improvements.length) lines.push('**To improve:**', '', list(e.improvements), '');
      if (e.followUp) lines.push(`**Follow-up question:** ${e.followUp}`, '');
    }
  }
  return `${lines.join('\n').trimEnd()}\n`;
}

function defaultExportName(snapshot) {
  const date = snapshot.finishedAt ? new Date(snapshot.finishedAt).toISOString().slice(0, 10) : 'interview';
  return `mockingbird-${date}-${snapshot.mode}.md`;
}

module.exports = { sessionToMarkdown, defaultExportName, fenced };
