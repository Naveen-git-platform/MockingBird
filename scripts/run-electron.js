'use strict';

// Launch Electron with a clean environment. ELECTRON_RUN_AS_NODE (set by some
// tools) would make Electron behave like plain Node, so it is removed here.
const { spawn } = require('node:child_process');
const electronPath = require('electron');

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
if (process.argv.includes('--smoke')) env.MOCKINGBIRD_SMOKE = '1';

const args = ['.', ...process.argv.slice(2).filter((a) => a !== '--smoke')];
if (process.platform === 'linux' && process.env.CI) args.push('--no-sandbox');

const child = spawn(electronPath, args, { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
