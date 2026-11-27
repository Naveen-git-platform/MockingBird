'use strict';

// Live end-to-end check against the AI providers you have set up.
//   npm run live-check                         every provider with a key
//   LIVE_ONLY=gemini,openrouter npm run live-check
//
// Runs inside Electron so it can read the same encrypted keys the app saved in Settings
// (environment variables work too). Keys are never printed. Each configured provider gets a
// ping, a streaming check and an image check; then the real practice and interview flows run
// through the same service the app uses. This sends a few small requests to those providers.

const path = require('node:path');
const { app, safeStorage, nativeImage } = require('electron');
const { Config } = require('../src/shared/config');
const { createProvider, listProviderNames } = require('../src/main/llm/registry');
const { createLlmService } = require('../src/main/llm/service');
const { SecretStore } = require('../src/main/settings/secrets');
const { UserSettings } = require('../src/main/settings/user-settings');
const { makeKeyResolver } = require('../src/main/settings/keys');
const { PracticeService } = require('../src/main/practice/service');
const { InterviewSession } = require('../src/main/interview/session');

app.on('window-all-closed', () => {});

const results = [];
const log = (line = '') => process.stdout.write(`${line}\n`);

function record(group, name, status, detail = '', ms = null) {
  results.push({ group, name, status, detail, ms });
  const icon = { pass: 'PASS', fail: 'FAIL', skip: 'SKIP' }[status];
  log(`  ${icon}  ${name}${ms != null ? ` (${ms} ms)` : ''}${detail ? `  - ${detail}` : ''}`);
}

async function timed(fn) {
  const start = Date.now();
  const value = await fn();
  return { value, ms: Date.now() - start };
}

/** A solid red 64x64 PNG made without any file or network access. */
function redSquare() {
  const size = 64;
  const bgra = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i += 1) bgra.set([0, 0, 255, 255], i * 4);
  return { mimeType: 'image/png', data: nativeImage.createFromBitmap(bgra, { width: size, height: size }).toPNG().toString('base64') };
}

async function collect(provider, request) {
  let text = '';
  let chunks = 0;
  let firstMs = null;
  const start = Date.now();
  for await (const delta of provider.stream(request)) {
    if (firstMs === null) firstMs = Date.now() - start;
    chunks += 1;
    text += delta;
  }
  return { text, chunks, firstMs, totalMs: Date.now() - start };
}

const short = (s) => String(s).replace(/\s+/g, ' ').trim().slice(0, 90);

async function checkProvider(provider) {
  log(`\n${provider.name} (${provider.model})`);
  try {
    const r = await collect(provider, { system: 'Follow instructions exactly.', messages: [{ role: 'user', content: 'Reply with exactly one word: pong' }], maxTokens: 50, temperature: 0 });
    if (/pong/i.test(r.text)) record(provider.name, 'ping', 'pass', `first token ${r.firstMs} ms, said "${short(r.text)}"`, r.totalMs);
    else record(provider.name, 'ping', 'fail', `unexpected reply: "${short(r.text)}"`, r.totalMs);
  } catch (err) {
    record(provider.name, 'ping', 'fail', `${err.kind || 'error'}: ${short(err.message)}`);
    return; // no point continuing with a provider that cannot answer
  }

  try {
    const r = await collect(provider, { messages: [{ role: 'user', content: 'Count from 1 to 12, separated by spaces.' }], maxTokens: 120, temperature: 0 });
    if (r.chunks > 1) record(provider.name, 'streams in pieces', 'pass', `${r.chunks} chunks`, r.totalMs);
    else record(provider.name, 'streams in pieces', 'fail', `only ${r.chunks} chunk(s); answers will appear all at once`, r.totalMs);
  } catch (err) {
    record(provider.name, 'streams in pieces', 'fail', `${err.kind || 'error'}: ${short(err.message)}`);
  }

  if (!provider.supportsImages) {
    record(provider.name, 'reads an image', 'skip', 'provider setting says no image support');
    return;
  }
  try {
    const r = await collect(provider, {
      messages: [{ role: 'user', content: [{ type: 'text', text: 'What is the single dominant colour of this image? Answer with one word.' }, { type: 'image', ...redSquare() }] }],
      maxTokens: 20,
      temperature: 0,
    });
    if (/red/i.test(r.text)) record(provider.name, 'reads an image', 'pass', `said "${short(r.text)}"`, r.totalMs);
    else record(provider.name, 'reads an image', 'fail', `expected red, got "${short(r.text)}" (this model may not accept images)`, r.totalMs);
  } catch (err) {
    record(provider.name, 'reads an image', 'fail', `${err.kind || 'error'}: ${short(err.message)}`);
  }
}

async function checkFlows(service) {
  const primary = service.providers.find((p) => p.isConfigured());
  log(`\napp flows through the provider chain (first configured: ${primary.name})`);

  try {
    const practice = new PracticeService({ llm: service });
    const { value, ms } = await timed(() => practice.ask({ text: 'Two Sum: given an array and a target, return indices of two numbers that add to the target.', images: [] }, { mode: 'dsa', language: 'python', style: 'hints' }));
    const hasCode = /```/.test(value.text);
    if (value.text.length > 40 && !hasCode) record('flow', 'practice answer (hints only, so no code)', 'pass', `${value.text.length} chars from ${value.provider}`, ms);
    else if (value.text.length > 40) record('flow', 'practice answer (hints only, so no code)', 'fail', 'the answer contains a code block even though hints-only was requested', ms);
    else record('flow', 'practice answer (hints only, so no code)', 'fail', `answer too short: "${short(value.text)}"`, ms);

    const follow = await timed(() => practice.ask({ text: 'And what is the time complexity of the optimal approach?', images: [] }, { mode: 'dsa', language: 'python', style: 'guided' }));
    if (/O\(\s*n\s*\)|linear/i.test(follow.value.text)) record('flow', 'follow-up keeps context', 'pass', 'mentioned O(n)', follow.ms);
    else record('flow', 'follow-up keeps context', 'fail', `did not mention O(n): "${short(follow.value.text)}"`, follow.ms);
  } catch (err) {
    record('flow', 'practice answer', 'fail', `${err.kind || 'error'}: ${short(err.message)}`);
  }

  try {
    const session = new InterviewSession({ llm: service, mode: 'dsa', language: 'python', difficulty: 'easy', questionCount: 1 });
    const q = await timed(() => session.start());
    if (q.value.text.length > 30) record('flow', 'interview asks a question', 'pass', short(q.value.text), q.ms);
    else record('flow', 'interview asks a question', 'fail', `question too short: "${short(q.value.text)}"`, q.ms);

    const hint = await timed(() => session.requestHint());
    record('flow', 'interview hint', hint.value.text.length > 10 ? 'pass' : 'fail', short(hint.value.text), hint.ms);

    const ev = await timed(() => session.submitAnswer({ text: 'I would use a hash map to store values I have seen and check for the complement in one pass, so O(n) time and O(n) space.', images: [] }));
    const e = ev.value;
    if (typeof e.score === 'number' && e.score >= 0 && e.score <= 10) record('flow', 'interview scores an answer (valid JSON)', 'pass', `score ${e.score}/10, ${e.strengths.length} strengths, ${e.improvements.length} improvements`, ev.ms);
    else record('flow', 'interview scores an answer (valid JSON)', 'fail', 'no usable score', ev.ms);

    const rep = await timed(() => session.finish());
    record('flow', 'interview final report', rep.value.summary && rep.value.averageScore != null ? 'pass' : 'fail', short(rep.value.summary), rep.ms);
  } catch (err) {
    record('flow', 'interview', 'fail', `${err.kind || 'error'}: ${short(err.message)}`);
  }
}

app.whenReady().then(async () => {
  let code = 0;
  try {
    const baseConfig = new Config();
    const userSettings = new UserSettings({ file: path.join(baseConfig.get('app.dataDir'), 'settings.json'), providers: listProviderNames() });
    const config = new Config({ overrides: userSettings.overrides() });
    const secrets = new SecretStore({ file: path.join(config.get('app.dataDir'), 'secrets.json'), safeStorage });
    const getApiKey = makeKeyResolver({ secrets });

    log('MockingBird live check');
    log(`secure storage: ${secrets.available ? 'available' : 'NOT available (environment variables only)'}`);

    const only = process.env.LIVE_ONLY ? process.env.LIVE_ONLY.split(',').map((s) => s.trim()) : null;
    const providers = listProviderNames()
      .filter((n) => !only || only.includes(n))
      .map((n) => createProvider(n, config.get(`llm.providers.${n}`, {}), { getApiKey }));
    const ready = providers.filter((p) => p.isConfigured());
    log(`providers with a key or local server: ${ready.map((p) => p.name).join(', ') || 'none'}`);
    for (const p of providers.filter((x) => !x.isConfigured())) record(p.name, 'all checks', 'skip', 'no API key set');

    // A local Ollama server is only "configured" in the sense that it needs no key; skip it unless asked.
    const toTest = ready.filter((p) => p.name !== 'ollama' || (only && only.includes('ollama')));
    for (const p of toTest) await checkProvider(p);

    const usable = toTest.filter((p) => results.some((r) => r.group === p.name && r.name === 'ping' && r.status === 'pass'));
    if (usable.length) {
      const service = createLlmService(config, { createProvider, getApiKey, providerNames: usable.map((p) => p.name) });
      await checkFlows(service);
    } else {
      log('\nNo provider answered, so the app flows were not run.');
    }
  } catch (err) {
    record('setup', 'live check', 'fail', short(err.message));
  }

  const failed = results.filter((r) => r.status === 'fail').length;
  const passed = results.filter((r) => r.status === 'pass').length;
  const skipped = results.filter((r) => r.status === 'skip').length;
  log(`\n${passed} passed, ${failed} failed, ${skipped} skipped`);
  if (failed > 0) code = 1;
  app.exit(code);
});
