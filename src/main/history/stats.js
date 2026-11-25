'use strict';

const DAY_MS = 24 * 60 * 60 * 1000;

const round1 = (n) => Math.round(n * 10) / 10;

function dayKey(ms, offsetMinutes) {
  return Math.floor((ms - offsetMinutes * 60 * 1000) / DAY_MS);
}

/**
 * Practice stats over session summaries (as returned by HistoryStore.list()).
 * `tzOffsetMinutes` is minutes behind UTC (Date#getTimezoneOffset), so days follow local time.
 */
function computeProgress(summaries, { now = Date.now(), tzOffsetMinutes = 0, trendLength = 10 } = {}) {
  const scored = summaries.filter((s) => typeof s.averageScore === 'number');
  const chronological = [...scored].sort((a, b) => (a.finishedAt || 0) - (b.finishedAt || 0));

  const byMode = {};
  for (const s of summaries) {
    const m = (byMode[s.mode] ||= { sessions: 0, questions: 0, scoreSum: 0, scored: 0 });
    m.sessions += 1;
    m.questions += s.questionsAsked || 0;
    if (typeof s.averageScore === 'number') {
      m.scoreSum += s.averageScore;
      m.scored += 1;
    }
  }
  for (const [mode, m] of Object.entries(byMode)) {
    byMode[mode] = {
      sessions: m.sessions,
      questions: m.questions,
      averageScore: m.scored ? round1(m.scoreSum / m.scored) : null,
    };
  }

  const totalQuestions = summaries.reduce((n, s) => n + (s.questionsAsked || 0), 0);
  const totalHints = summaries.reduce((n, s) => n + (s.hintsUsed || 0), 0);

  // Consecutive practice days ending today (or yesterday, so the streak survives until tonight).
  const days = new Set(summaries.filter((s) => s.finishedAt).map((s) => dayKey(s.finishedAt, tzOffsetMinutes)));
  const today = dayKey(now, tzOffsetMinutes);
  let cursor = days.has(today) ? today : today - 1;
  let streakDays = 0;
  while (days.has(cursor)) {
    streakDays += 1;
    cursor -= 1;
  }

  const trend = chronological.slice(-trendLength).map((s) => ({ id: s.id, finishedAt: s.finishedAt, averageScore: s.averageScore }));
  let change = null;
  if (chronological.length >= 2) {
    const half = Math.floor(chronological.length / 2);
    const avg = (arr) => arr.reduce((a, s) => a + s.averageScore, 0) / arr.length;
    change = round1(avg(chronological.slice(half)) - avg(chronological.slice(0, half)));
  }

  return {
    sessions: summaries.length,
    totalQuestions,
    totalHints,
    hintsPerQuestion: totalQuestions ? round1(totalHints / totalQuestions) : 0,
    overallAverage: scored.length ? round1(scored.reduce((a, s) => a + s.averageScore, 0) / scored.length) : null,
    bestScore: scored.length ? Math.max(...scored.map((s) => s.averageScore)) : null,
    streakDays,
    byMode,
    trend,
    improvement: change,
  };
}

module.exports = { computeProgress };
