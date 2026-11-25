'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Find the Python interpreter for the Whisper worker.
 * Order: explicit config, WHISPER_PYTHON, a venv under the data dir, then the system default.
 */
function resolvePython({ configured = '', env = process.env, dataDir, platform = process.platform, exists = fs.existsSync } = {}) {
  if (configured) return { path: configured, source: 'config' };
  if (env.WHISPER_PYTHON) return { path: env.WHISPER_PYTHON, source: 'env' };
  if (dataDir) {
    const venvPython =
      platform === 'win32'
        ? path.join(dataDir, '.venv-whisper', 'Scripts', 'python.exe')
        : path.join(dataDir, '.venv-whisper', 'bin', 'python');
    if (exists(venvPython)) return { path: venvPython, source: 'venv' };
  }
  return { path: platform === 'win32' ? 'python' : 'python3', source: 'system' };
}

/**
 * Path to the Whisper worker script. Python cannot read inside an asar archive, so a
 * packaged app uses the copy unpacked next to it.
 */
function resolveWorkerScript({ isPackaged, resourcesPath, appRoot }) {
  if (isPackaged) return path.join(resourcesPath, 'app.asar.unpacked', 'scripts', 'whisper_worker.py');
  return path.join(appRoot, 'scripts', 'whisper_worker.py');
}

module.exports = { resolvePython, resolveWorkerScript };
