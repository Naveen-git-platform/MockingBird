'use strict';

// Regenerates src/renderer/tokens.css from src/shared/themes.js.
const fs = require('node:fs');
const path = require('node:path');
const { buildTokensCss } = require('../src/shared/themes');

const target = path.join(__dirname, '..', 'src', 'renderer', 'tokens.css');
fs.writeFileSync(target, buildTokensCss(), 'utf8');
console.log(`wrote ${path.relative(process.cwd(), target)}`);
