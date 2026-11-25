'use strict';

const { DIFFICULTIES, INTERVIEW_MODES } = require('./prompts');
const { MODES } = require('../modes/modes');
const { LANGUAGES } = require('../modes/languages');

/** What the UI needs to build the "new interview" form. */
function interviewOptions() {
  return {
    modes: INTERVIEW_MODES.map((id) => ({ id, label: MODES[id].label, needsLanguage: MODES[id].needsLanguage })),
    difficulties: [...DIFFICULTIES],
    languages: LANGUAGES.filter((l) => l.id !== 'sql').map(({ id, label }) => ({ id, label })),
    questionCount: { min: 1, max: 20 },
  };
}

module.exports = { interviewOptions };
