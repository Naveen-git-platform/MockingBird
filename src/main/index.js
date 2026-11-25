'use strict';

const path = require('node:path');
const { app, BrowserWindow, ipcMain, desktopCapturer, screen, clipboard, session } = require('electron');
const { CaptureService } = require('./capture/capture-service');
const { WhisperWorker } = require('./voice/whisper-worker');
const { VoiceController } = require('./voice/voice-controller');
const { resolvePython } = require('./voice/python-env');
const { installMediaHandlers } = require('./media');
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
    registerIpc(ipcMain, {
      config,
      appInfo: { name: app.getName(), version: app.getVersion(), platform: process.platform },
      capture: new CaptureService({ desktopCapturer, screen, clipboard, logger: logger.child('capture') }),
      voice,
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
