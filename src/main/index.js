'use strict';

const path = require('node:path');
const { app, BrowserWindow, ipcMain, desktopCapturer, screen, clipboard, session, dialog } = require('electron');
const { CaptureService } = require('./capture/capture-service');
const { WhisperWorker } = require('./voice/whisper-worker');
const { VoiceController } = require('./voice/voice-controller');
const { resolvePython } = require('./voice/python-env');
const { installMediaHandlers } = require('./media');
const { createLlmService } = require('./llm/service');
const { createProvider } = require('./llm/registry');
const { InterviewManager } = require('./interview/manager');
const { interviewOptions } = require('./interview/options');
const { PracticeService } = require('./practice/service');
const { practiceOptions } = require('./practice/options');
const { HistoryStore } = require('./history/store');
const { HistoryService } = require('./history/service');
const { Config } = require('../shared/config');
const { createLogger } = require('../shared/logger');
const { buildWindowOptions } = require('./window-options');
const { registerIpc, bindVoiceEvents } = require('./ipc');

const config = new Config();
const logger = createLogger({
  scope: 'main',
  level: config.get('logging.level'),
  logDir: config.get('logging.toFile') ? path.join(config.get('app.dataDir'), 'logs') : null,
});

const smokeMode = process.env.MOCKINGBIRD_SMOKE === '1';

function createMainWindow() {
  const win = new BrowserWindow(buildWindowOptions(config));
  win.removeMenu();
  win.once('ready-to-show', () => win.show());
  win.webContents.on('did-finish-load', () => {
    logger.info('renderer loaded');
    if (smokeMode) setTimeout(() => app.quit(), 300);
  });
  win.webContents.on('did-fail-load', (_e, code, desc) => {
    logger.error('renderer failed to load', { code, desc });
    if (smokeMode) app.exit(1);
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
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
      scriptPath: path.join(__dirname, '..', '..', 'scripts', 'whisper_worker.py'),
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
    whisperWorker?.close();
  });

  app.whenReady().then(() => {
    installMediaHandlers(session.defaultSession, { desktopCapturer });
    const voice = createVoice();
    if (voice) bindVoiceEvents(voice, () => BrowserWindow.getAllWindows());
    const llm = createLlmService(config, { createProvider, logger: logger.child('llm') });
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
    registerIpc(ipcMain, {
      config,
      appInfo: { name: app.getName(), version: app.getVersion(), platform: process.platform },
      capture: new CaptureService({ desktopCapturer, screen, clipboard, logger: logger.child('capture') }),
      voice,
      interview,
      interviewOptions,
      history,
      practice,
      practiceOptions,
      llm,
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
