/* Development-only stand-in for the Electron preload bridge, so the UI can be previewed in a
 * plain browser (open tools/ui-preview/preview.html). It is never loaded by the app. */
(function () {
  const listeners = {};
  const emit = (ch, p) => (listeners[ch] || []).forEach((f) => f(p));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const DAY = 86400000;

  async function stream(channel, text, kind) {
    for (const part of text.match(/[\s\S]{1,14}/g) || []) {
      emit(channel, kind ? { kind, text: part } : { text: part });
      await sleep(12);
    }
  }

  function png(label, color) {
    const c = document.createElement('canvas');
    c.width = 640;
    c.height = 360;
    const g = c.getContext('2d');
    g.fillStyle = color;
    g.fillRect(0, 0, 640, 360);
    g.fillStyle = 'rgba(255,255,255,.85)';
    g.font = '28px sans-serif';
    g.fillText(label, 24, 60);
    g.fillRect(24, 90, 420, 14);
    g.fillRect(24, 120, 300, 14);
    return c.toDataURL('image/png');
  }

  const ANSWER = `## Approach\n\nUse a **hash map** from value to index.\n\n1. Walk the array once.\n2. For each \`x\`, check whether \`target - x\` is already stored.\n3. Otherwise store \`x\`.\n\n\`\`\`python\ndef two_sum(nums, target):\n    seen = {}\n    for i, x in enumerate(nums):\n        if target - x in seen:\n            return [seen[target - x], i]\n        seen[x] = i\n\`\`\`\n\n| Approach | Time | Space |\n|---|---|---|\n| Brute force | O(n²) | O(1) |\n| Hash map | O(n) | O(n) |\n\n> Try an input with duplicates next.`;

  const QUESTIONS = [
    'Given an array of integers `nums` and an integer `target`, return the indices of the two numbers that add up to `target`.\n\nYou may assume exactly one solution exists.',
    'Design an LRU cache with `get` and `put` in O(1) time.',
    'Merge `k` sorted linked lists into one sorted list.',
  ];

  let snap = null;
  const interview = {
    start(opts) {
      snap = { id: 'preview-0001', mode: opts.mode || 'dsa', language: opts.language || 'python', difficulty: opts.difficulty || 'medium', role: opts.role || '', questionCount: Math.min(opts.questionCount || 3, 3), status: 'awaiting_answer', startedAt: Date.now(), finishedAt: null, hasNext: true, questions: [], report: null };
      return interview.ask();
    },
    async ask() {
      const text = QUESTIONS[snap.questions.length];
      await stream('interview:delta', text, 'question');
      snap.questions.push({ index: snap.questions.length, text, hints: [], answer: null, evaluation: null, skipped: false });
      snap.status = 'awaiting_answer';
      snap.hasNext = snap.questions.length < snap.questionCount;
      return JSON.parse(JSON.stringify(snap));
    },
  };

  const sessions = [
    { id: 'hist-0001', mode: 'dsa', language: 'python', difficulty: 'medium', role: 'Backend engineer', startedAt: Date.now() - 3 * DAY, finishedAt: Date.now() - 3 * DAY, questionsAsked: 5, questionsAnswered: 5, averageScore: 5.8, hintsUsed: 4 },
    { id: 'hist-0002', mode: 'behavioral', language: null, difficulty: 'easy', role: '', startedAt: Date.now() - 2 * DAY, finishedAt: Date.now() - 2 * DAY, questionsAsked: 4, questionsAnswered: 4, averageScore: 6.9, hintsUsed: 1 },
    { id: 'hist-0003', mode: 'dsa', language: 'python', difficulty: 'hard', role: 'Backend engineer', startedAt: Date.now() - 1 * DAY, finishedAt: Date.now() - 1 * DAY, questionsAsked: 5, questionsAnswered: 4, averageScore: 7.4, hintsUsed: 2 },
    { id: 'hist-0004', mode: 'system-design', language: null, difficulty: 'medium', role: '', startedAt: Date.now(), finishedAt: Date.now(), questionsAsked: 3, questionsAnswered: 3, averageScore: 8.1, hintsUsed: 0 },
  ];

  const THEME_LIST = [['system', 'Match my system', '#0e1014', '#161a21', '#7c9cff'], ['dark', 'Midnight', '#0e1014', '#161a21', '#7c9cff'], ['light', 'Daylight', '#f5f6f9', '#ffffff', '#3b5bdb'], ['ocean', 'Ocean', '#0a1620', '#0f2231', '#38bdf8'], ['forest', 'Forest', '#0c130f', '#121c16', '#4ade80'], ['sunset', 'Sunset', '#150f12', '#1f1519', '#fb923c'], ['paper', 'Paper', '#f6f1e7', '#fffdf8', '#b45309']].map(([id, label, a, b, c]) => ({ id, label, scheme: 'dark', swatch: [a, b, c] }));
  const prefs = { theme: 'system', primary: 'gemini', keys: { gemini: 'env' }, routing: 'chat', opacity: 0.95, shortcutsEnabled: true, shortcuts: { captureAsk: 'CommandOrControl+Shift+S', toggleVoice: 'Alt+Shift+V', toggleOverlay: 'CommandOrControl+Shift+O', toggleClickThrough: 'CommandOrControl+Shift+I', showWindow: 'CommandOrControl+Shift+M' } };
  const DEFAULTS = { captureAsk: 'CommandOrControl+Shift+S', toggleVoice: 'Alt+Shift+V', toggleOverlay: 'CommandOrControl+Shift+O', toggleClickThrough: 'CommandOrControl+Shift+I', showWindow: 'CommandOrControl+Shift+M' };
  const LABELS = { captureAsk: 'Capture the screen and answer', toggleVoice: 'Start or stop voice input', toggleOverlay: 'Show or hide the overlay', toggleClickThrough: 'Overlay click-through on or off', showWindow: 'Show the MockingBird window' };
  const shortcutRows = () => Object.keys(DEFAULTS).map((action) => ({ action, label: LABELS[action], accelerator: prefs.shortcuts[action], defaultAccelerator: DEFAULTS[action], ok: prefs.shortcutsEnabled && action !== 'toggleVoice', error: prefs.shortcutsEnabled ? (action === 'toggleVoice' ? 'Another app is already using this shortcut' : null) : 'Shortcuts are turned off' }));
  const overlay = { visible: false, opacity: 0.95, clickThrough: false };
  let answerSeq = 0;
  const settingsState = () => ({
    primary: prefs.primary,
    theme: prefs.theme,
    themes: THEME_LIST,
    routing: prefs.routing,
    practice: { mode: 'dsa', language: 'python', style: 'guided' },
    shortcutsEnabled: prefs.shortcutsEnabled,
    shortcuts: shortcutRows(),
    overlayOpacity: prefs.opacity,
    secureStorage: true,
    providers: ['gemini', 'openai', 'anthropic', 'ollama'].map((name) => ({
      name,
      model: { gemini: 'gemini-2.5-flash', openai: 'gpt-4o-mini', anthropic: 'claude-sonnet-5-5', ollama: 'llama3.2' }[name],
      needsKey: name !== 'ollama',
      keySource: prefs.keys[name] || null,
      configured: name === 'ollama' || Boolean(prefs.keys[name]),
    })),
  });

  const handlers = {
    'app:info': () => ({ name: 'MockingBird', version: '0.1.0', platform: 'preview' }),
    'config:get': (_k, key) => ({ 'ui.theme': prefs.theme, practice: { mode: 'dsa', language: 'python', style: 'guided' }, interview: { difficulty: 'medium', questionCount: 3, role: '' }, voice: { enabled: true, model: 'small', mode: 'vad' }, app: { dataDir: '~/.MockingBird' } }[key]),
    'settings:get': () => settingsState(),
    'settings:set': (_k, key, value) => { if (key === 'llm.primary') prefs.primary = value; if (key === 'routing.target') prefs.routing = value; if (key === 'ui.theme') { prefs.theme = value; emit('theme:changed', { theme: value }); } if (key === 'overlay.opacity') prefs.opacity = value; if (key === 'shortcuts.enabled') prefs.shortcutsEnabled = value; if (key.startsWith('shortcuts.') && key !== 'shortcuts.enabled') prefs.shortcuts[key.slice(10)] = value; return settingsState(); },
    'settings:set-key': (_k, name) => { prefs.keys[name] = 'stored'; return settingsState(); },
    'settings:delete-key': (_k, name) => { delete prefs.keys[name]; return settingsState(); },
    'llm:status': () => [{ name: 'gemini', model: 'gemini-2.5-flash', configured: true }, { name: 'openai', model: 'gpt-4o-mini', configured: false }],
    'practice:options': () => ({
      modes: [{ id: 'dsa', label: 'Data structures & algorithms', needsLanguage: true }, { id: 'system-design', label: 'System design', needsLanguage: false }, { id: 'behavioral', label: 'Behavioral', needsLanguage: false }, { id: 'sql', label: 'SQL & databases', needsLanguage: false }, { id: 'explain', label: 'Explain a concept', needsLanguage: false }],
      languages: [{ id: 'python', label: 'Python' }, { id: 'javascript', label: 'JavaScript' }, { id: 'java', label: 'Java' }, { id: 'cpp', label: 'C++' }],
      styles: [{ id: 'hints', label: 'Hints only' }, { id: 'guided', label: 'Guided approach' }, { id: 'full', label: 'Full solution' }],
    }),
    'practice:ask': async (_k, raw) => {
      const toChat = prefs.routing !== 'overlay';
      const id = ++answerSeq;
      if (toChat) emit('answer:begin', { id, question: raw.text, images: raw.images || [] });
      for (const part of ANSWER.match(/[\s\S]{1,14}/g)) {
        if (toChat) emit('answer:delta', { id, text: part });
        window.__overlayLog = (window.__overlayLog || []).concat(prefs.routing !== 'chat' ? [part] : []);
        await sleep(12);
      }
      if (toChat) emit('answer:end', { id, text: ANSWER });
      return { text: ANSWER, provider: 'preview', model: 'mock', routed: { chat: toChat, overlay: prefs.routing !== 'chat' } };
    },
    'overlay:state': () => ({ ...overlay }),
    'overlay:show': () => { overlay.visible = true; return { ...overlay }; },
    'overlay:hide': () => { overlay.visible = false; return { ...overlay }; },
    'overlay:set-click-through': (_k, on) => { overlay.clickThrough = on; return { ...overlay }; },
    'practice:reset': () => null,
    'interview:options': () => ({
      modes: [{ id: 'dsa', label: 'Data structures & algorithms', needsLanguage: true }, { id: 'system-design', label: 'System design', needsLanguage: false }, { id: 'behavioral', label: 'Behavioral', needsLanguage: false }, { id: 'sql', label: 'SQL & databases', needsLanguage: false }],
      difficulties: ['easy', 'medium', 'hard'],
      languages: [{ id: 'python', label: 'Python' }, { id: 'javascript', label: 'JavaScript' }],
      questionCount: { min: 1, max: 20 },
    }),
    'interview:state': () => (snap ? JSON.parse(JSON.stringify(snap)) : null),
    'interview:start': (_k, opts) => interview.start(opts || {}),
    'interview:answer': async () => {
      await sleep(400);
      const evaluation = { score: 7.5, summary: 'A correct single-pass solution. You explained the trade-off clearly.', strengths: ['Optimal O(n) approach', 'Clear explanation'], improvements: ['Mention the duplicate-value case', 'State the space complexity'], followUp: 'How would you adapt this if the array were sorted?' };
      const q = snap.questions[snap.questions.length - 1];
      q.answer = { text: 'hash map', imageCount: 0 };
      q.evaluation = evaluation;
      snap.status = 'evaluated';
      return { evaluation, state: JSON.parse(JSON.stringify(snap)) };
    },
    'interview:hint': async () => {
      const q = snap.questions[snap.questions.length - 1];
      const text = ['Think about what you need to remember while you scan the array.', 'A dictionary lookup is O(1): what could you store in it?', 'Store each value with its index, and look up the complement.'][q.hints.length];
      await stream('interview:delta', text, 'hint');
      q.hints.push(text);
      return { hint: { level: q.hints.length, text, remaining: 3 - q.hints.length }, state: JSON.parse(JSON.stringify(snap)) };
    },
    'interview:skip': () => {
      const q = snap.questions[snap.questions.length - 1];
      q.skipped = true;
      snap.status = 'evaluated';
      return JSON.parse(JSON.stringify(snap));
    },
    'interview:next': () => interview.ask(),
    'interview:finish': async () => {
      await sleep(300);
      const answered = snap.questions.filter((q) => q.evaluation).length;
      snap.report = { questionsAsked: snap.questions.length, questionsAnswered: answered, questionsSkipped: snap.questions.length - answered, hintsUsed: snap.questions.reduce((n, q) => n + q.hints.length, 0), averageScore: answered ? 7.5 : null, summary: 'Solid fundamentals. Work on stating complexity up front and covering edge cases.', focusAreas: ['Edge cases', 'Complexity analysis'], perQuestion: [] };
      snap.status = 'finished';
      snap.finishedAt = Date.now();
      return JSON.parse(JSON.stringify(snap));
    },
    'interview:discard': () => { snap = null; return null; },
    'history:stats': () => ({ sessions: 4, totalQuestions: 17, totalHints: 7, hintsPerQuestion: 0.4, overallAverage: 7.1, bestScore: 8.1, streakDays: 4, improvement: 1.9, byMode: { dsa: { sessions: 2, questions: 10, averageScore: 6.6 }, behavioral: { sessions: 1, questions: 4, averageScore: 6.9 }, 'system-design': { sessions: 1, questions: 3, averageScore: 8.1 } }, trend: sessions.map((s) => ({ id: s.id, finishedAt: s.finishedAt, averageScore: s.averageScore })) }),
    'history:list': () => [...sessions].reverse(),
    'history:get': (_k, id) => {
      const s = sessions.find((x) => x.id === id);
      return { ...s, status: 'finished', questions: [{ index: 0, text: QUESTIONS[0], hints: [], skipped: false, evaluation: { score: s.averageScore, summary: 'Good.', strengths: [], improvements: [], followUp: null } }], report: { summary: 'Nice progress.', averageScore: s.averageScore } };
    },
    'history:delete': () => true,
    'history:clear': () => 4,
    'history:export': () => ({ path: '/tmp/report.md' }),
    'capture:sources': () => [{ id: 'screen:1', name: 'Entire screen', kind: 'screen', preview: png('Screen 1', '#243b6b') }, { id: 'window:2', name: 'Code editor', kind: 'window', preview: png('Editor', '#35523d') }],
    'capture:source': () => png('Captured problem statement', '#4a3566'),
    'voice:start': () => ({ state: 'listening' }),
    'voice:stop': () => ({ state: 'idle' }),
  };

  window.mockingbird = {
    async invoke(channel, ...args) {
      const fn = handlers[channel];
      if (!fn) throw new Error(`No mock for ${channel}`);
      return fn(null, ...args);
    },
    send() {},
    __emit: emit,
    on(channel, cb) {
      (listeners[channel] ||= []).push(cb);
      return () => { listeners[channel] = listeners[channel].filter((f) => f !== cb); };
    },
  };
})();
