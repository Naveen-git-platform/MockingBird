const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('package metadata is MockingBird and Apache-2.0', () => {
  assert.equal(pkg.name, 'mockingbird');
  assert.equal(pkg.license, 'Apache-2.0');
});

test('license and attribution files exist', () => {
  const license = fs.readFileSync(path.join(root, 'LICENSE'), 'utf8');
  assert.match(license, /Apache License/);
  const notice = fs.readFileSync(path.join(root, 'NOTICE'), 'utf8');
  assert.match(notice, /OpenCluely/);
});
