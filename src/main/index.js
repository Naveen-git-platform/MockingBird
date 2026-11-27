'use strict';

const path = require('node:path');
const { app, BrowserWindow, ipcMain, desktopCapturer, screen, clipboard, session, dialog, safeStorage, shell, globalShortcut } = require('electron');
const { CaptureService } = require('./capture/capture-service');
const { WhisperWorker } = require('./voice/whisper-worker');
const { VoiceController } = require('./voice/voice-controller');
const { resolvePython, resolveWorkerScript } = require('./voice/python-env');
const { hardenWebContents } = require('./security');
const { SecretStore } = require('./settings/secrets');
const { UserSettings } = require('./settings/user-settings');
const { SettingsService } = require('./settings/service');
const { makeKeyResolver } = require('./settings/keys');
const { installMediaHandlers } = require('./media');
const { createLlmService } = require('./llm/service');
const { createProvider, listProviderNames } = require('./llm/registry');
const { InterviewManager } = require('./interview/manager');
const { interviewOptions } = require('./interview/options');
const { PracticeService } = require('./practice/service');
const { practiceOptions } = require('./practice/options');
const { HistoryStore } = require('./history/store');
const { HistoryService } = require('./history/service');
const { OverlayManager } = require('./overlay');
const { AnswerSink } = require('./answers');
const { ShortcutManager } = require('./shortcuts');
const { QuickAsk } = require('./quick-ask');
const { Config } = require('../shared/config');
const { createLogger } = require('../shared/logger');
const { buildWindowOptions } = require('./window-options');
const { registerIpc, registerChannelList, bindVoiceEvents } = require('./ipc');

const baseConfig = new Config();
const userSettings = new UserSettings({
  file: path.join(baseConfig.get('app.dataDir'), 'settings.json'),
  providers: listProviderNames(),
});
const config = new Config({ overrides: userSettings.overrides() });
const logger = createLogger({
  scope: 'main',
  level: config.get('logging.level'),
  logDir: config.get('logging.toFile') ? path.join(config.get('app.dataDir'), 'logs') : null,
});

const smokeMode = process.env.MOCKINGBIRD_SMOKE === '1';
let overlayManager = null;
let mainWindow = null;

function createMainWindow() {
  const options = buildWindowOptions(config);
  // Packaged builds embed the icon in the executable; in development use the source PNG.
  if (!app.isPackaged) options.icon = path.join(__dirname, '..', '..', 'build', 'icon.png');
  const win = new BrowserWindow(options);
  win.removeMenu();
  hardenWebContents(win.webContents, { shell });
  win.once('ready-to-show', () => win.show());
  const rendererErrors = [];
  win.webContents.on('console-message', (event, ...legacy) => {
    // Electron 45 passes one details object; older versions pass (event, level, message).
    const details = legacy.length ? { level: legacy[0], message: legacy[1] } : event;
    if (details.level === 'error' || details.level === 3) rendererErrors.push(String(details.message));
  });
  win.webContents.on('did-finish-load', async () => {
    logger.info('renderer loaded');
    if (!smokeMode) return;
    // Smoke test: both windows must finish booting without console errors.
    const waitReady = async (contents, selector) => {
      for (let i = 0; i < 30; i += 1) {
        const ok = await contents
          .executeJavaScript(`document.documentElement.dataset.ready === '1' && !!document.querySelector('${selector}')`)
          .catch(() => false);
        if (ok) return true;
        await new Promise((r) => setTimeout(r, 100));
      }
      return false;
    };
    const ready = await waitReady(win.webContents, '#view .view');
    let overlayReady = false;
    const overlayErrors = [];
    if (overlayManager) {
      overlayManager.show();
      const overlayWin = overlayManager.window;
      overlayWin.webContents.on('console-message', (event, ...legacy) => {
        const details = legacy.length ? { level: legacy[0], message: legacy[1] } : event;
        if (details.level === 'error' || details.level === 3) overlayErrors.push(String(details.message));
      });
      overlayReady = await waitReady(overlayWin.webContents, '#answer');
    }
    logger.info('smoke result', { ready, overlayReady, rendererErrors, overlayErrors });
    app.exit(ready && overlayReady && rendererErrors.length === 0 && overlayErrors.length === 0 ? 0 : 1);
  });
  win.webContents.on('did-fail-load', (_e, code, desc) => {
    logger.error('renderer failed to load', { code, desc });
    if (smokeMode) app.exit(1);
  });
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
    if (overlayManager) overlayManager.destroy();
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  mainWindow = win;
  return win;
}

function createOverlayWindow(options) {
  const win = new BrowserWindow(options);
  win.removeMenu();
  hardenWebContents(win.webContents, { shell });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'overlay.html'));
  return win;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows();
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  let whisperWorker = null;

  function createVoice() {
    if (!config.get('voice.enabled')) return null;
    const python = resolvePython({ configured: config.get('voice.pythonPath'), dataDir: config.get('app.dataDir') });
    whisperWorker = new WhisperWorker({
      pythonPath: python.path,
      scriptPath: resolveWorkerScript({ isPackaged: app.isPackaged, resourcesPath: process.resourcesPath, appRoot: path.join(__dirname, '..', '..') }),
      idleUnloadMs: config.get('voice.idleUnloadMs'),
      logger: logger.child('whisper'),
    });
    return new VoiceController({
      worker: whisperWorker,
      settings: {
        model: config.get('voice.model'),
        language: config.get('voice.language'),
        device: config.get('voice.device'),
        modelDir: config.get('voice.modelDir') || null,
        manualMaxMs: config.get('voice.manualMaxMs'),
        vad: config.get('voice.vad'),
      },
      logger: logger.child('voice'),
    });
  }

  app.on('before-quit', () => {
    if (overlayManager) overlayManager.destroy();
    globalShortcut.unregisterAll();
    whisperWorker?.close();
  });

  app.whenReady().then(() => {
    installMediaHandlers(session.defaultSession, { desktopCapturer });
    const voice = createVoice();
    overlayManager = new OverlayManager({
      createWindow: createOverlayWindow,
      opacity: config.get('overlay.opacity'),
      style: config.get('overlay.style'),
      glass: config.get('overlay.glass'),
      release: process.getSystemVersion(),
      getWorkArea: () => screen.getPrimaryDisplay().workArea,
      logger: logger.child('overlay'),
    });
    const chatWindows = () => BrowserWindow.getAllWindows().filter((w) => w !== overlayManager.window);
    const answers = new AnswerSink({ overlay: overlayManager, getChatWindows: chatWindows, getTarget: () => config.get('routing.target') });
    if (voice) bindVoiceEvents(voice, chatWindows);
    const secrets = new SecretStore({ file: path.join(config.get('app.dataDir'), 'secrets.json'), safeStorage });
    const llm = createLlmService(config, {
      createProvider,
      logger: logger.child('llm'),
      getApiKey: makeKeyResolver({ secrets }),
      providerNames: listProviderNames(),
    });
    const capture = new CaptureService({ desktopCapturer, screen, clipboard, logger: logger.child('capture') });
    let quickAsk = null;
    const showMainWindow = ({ focus }) => {
      const win = mainWindow;
      if (!win || win.isDestroyed()) return;
      if (win.isMinimized()) win.restore();
      if (focus) {
        win.show();
        win.focus();
      } else if (!win.isVisible()) {
        win.showInactive();
      }
    };
    const shortcuts = new ShortcutManager({
      globalShortcut,
      logger: logger.child('shortcuts'),
      handlers: {
        captureAsk: async () => {
          const result = await quickAsk.run();
          if (result.routed && result.routed.chat) showMainWindow({ focus: false });
        },
        toggleVoice: () => {
          showMainWindow({ focus: false });
          for (const win of chatWindows()) if (!win.isDestroyed()) win.webContents.send('shortcut:toggle-voice', {});
        },
        toggleOverlay: () => overlayManager.toggle(),
        toggleClickThrough: () => {
          if (!overlayManager.isVisible()) overlayManager.show();
          overlayManager.setClickThrough(!overlayManager.clickThrough);
        },
        showWindow: () => showMainWindow({ focus: true }),
      },
    });
    const settings = new SettingsService({
      shortcuts,
      extras: () => ({ overlayStyles: overlayManager.availableStyles() }),
      config,
      secrets,
      userSettings,
      llm,
      providerNames: listProviderNames(),
      onChange: (key, value) => {
        if (key === 'overlay.opacity') overlayManager.setOpacity(value);
        if (key === 'overlay.style') overlayManager.setStyle(value);
        if (key === 'overlay.glass') overlayManager.setGlass(value);
        if (key === 'ui.theme') {
          for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send('theme:changed', { theme: value });
        }
        if (key.startsWith('practice.')) practice.defaults[key.slice('practice.'.length)] = value;
      },
    });
    const history = config.get('history.enabled')
      ? new HistoryService({
          store: new HistoryStore({ dir: path.join(config.get('app.dataDir'), 'history'), logger: logger.child('history') }),
          showSaveDialog: (opts) => {
            const win = BrowserWindow.getFocusedWindow();
            return win ? dialog.showSaveDialog(win, opts) : dialog.showSaveDialog(opts);
          },
        })
      : null;
    const interview = new InterviewManager({
      llm,
      onFinished: history ? (snapshot) => history.save(snapshot) : null,
      defaults: {
        language: config.get('practice.language'),
        difficulty: config.get('interview.difficulty'),
        questionCount: config.get('interview.questionCount'),
        role: config.get('interview.role'),
      },
    });
    const practice = new PracticeService({
      llm,
      defaults: {
        mode: config.get('practice.mode'),
        language: config.get('practice.language'),
        style: config.get('practice.style'),
        maxHistory: config.get('practice.maxHistory'),
      },
    });
    quickAsk = new QuickAsk({ capture, practice, answers, logger: logger.child('quick-ask') });
    settings.applyShortcuts();
    logger.info('shortcuts registered', Object.fromEntries(Object.entries(shortcuts.status()).map(([k, v]) => [k, v.ok])));
    registerChannelList(ipcMain);
    registerIpc(ipcMain, {
      config,
      appInfo: { name: app.getName(), version: app.getVersion(), platform: process.platform },
      capture,
      voice,
      interview,
      interviewOptions,
      history,
      practice,
      practiceOptions,
      llm,
      settings,
      answers,
      overlay: overlayManager,
    });
    createMainWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
