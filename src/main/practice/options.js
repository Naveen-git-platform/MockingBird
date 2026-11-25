'use strict';

const { listModes } = require('../modes/modes');
const { LANGUAGES } = require('../modes/languages');
const { STYLES } = require('../modes/styles');

/** Choices for the practice view selectors. */
function practiceOptions() {
  return {
    modes: listModes(),
    languages: LANGUAGES.map(({ id, label }) => ({ id, label })),
    styles: Object.values(STYLES).map(({ id, label }) => ({ id, label })),
  };
}

module.exports = { practiceOptions };
