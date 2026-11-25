'use strict';

const fs = require('node:fs');
const path = require('node:path');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

function formatLine(level, scope, message, meta, now) {
  const base = `${now.toISOString()} ${level.toUpperCase()} [${scope}] ${message}`;
  if (meta === undefined) return base;
  let extra;
  try {
    extra = typeof meta === 'string' ? meta : JSON.stringify(meta);
  } catch {
    extra = '[unserialisable meta]';
  }
  return `${base} ${extra}`;
}

/**
 * Minimal leveled logger. Writes to the console (or a supplied sink) and,
 * optionally, to a per-day file. File write failures never throw.
 */
function createLogger({ scope = 'app', level = 'info', logDir = null, sink = console, clock = () => new Date() } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;

  function emit(lvl, message, meta) {
    if (LEVELS[lvl] < threshold) return;
    const now = clock();
    const line = formatLine(lvl, scope, message, meta, now);
    const method = lvl === 'debug' ? 'log' : lvl;
    if (sink && typeof sink[method] === 'function') sink[method](line);
    if (logDir) {
      try {
        fs.mkdirSync(logDir, { recursive: true });
        const file = path.join(logDir, `mockingbird-${now.toISOString().slice(0, 10)}.log`);
        fs.appendFileSync(file, line + '\n');
      } catch {
        // Logging must never crash the app.
      }
    }
  }

  return {
    debug: (m, meta) => emit('debug', m, meta),
    info: (m, meta) => emit('info', m, meta),
    warn: (m, meta) => emit('warn', m, meta),
    error: (m, meta) => emit('error', m, meta),
    child: (childScope) => createLogger({ scope: `${scope}:${childScope}`, level, logDir, sink, clock }),
  };
}

module.exports = { createLogger, LEVELS };
