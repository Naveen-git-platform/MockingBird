'use strict';

const { INVOKE_CHANNELS: C, SEND_CHANNELS: S, EVENT_CHANNELS: E } = require('../shared/channels');
const { normalizeInput } = require('./capture/input');

const toDataUrl = (img) => (img ? `data:${img.mimeType};base64,${img.data}` : null);

/**
 * Register IPC handlers. `ipcMain` is injected so tests can pass a fake.
 * Capture and voice handlers are registered only when their service is supplied.
 */
function registerIpc(ipcMain, { config, appInfo, capture, voice }) {
  ipcMain.handle(C.APP_INFO, () => ({ ...appInfo }));
  ipcMain.handle(C.CONFIG_GET, (_event, keyPath) => {
    if (typeof keyPath !== 'string' || keyPath.length === 0) return config.toJSON();
    return config.get(keyPath);
  });
  ipcMain.handle(C.INPUT_VALIDATE, (_event, raw) => normalizeInput(raw));

  if (capture) {
    ipcMain.handle(C.CAPTURE_SOURCES, () => capture.listSources());
    ipcMain.handle(C.CAPTURE_SCREEN, async (_event, opts) =>
      toDataUrl(await capture.captureScreen(opts && typeof opts === 'object' ? { displayId: opts.displayId } : {}))
    );
    ipcMain.handle(C.CAPTURE_SOURCE, async (_event, sourceId) => toDataUrl(await capture.captureSource(sourceId)));
    ipcMain.handle(C.CAPTURE_AREA, async (_event, sourceId, rect, viewport) =>
      toDataUrl(await capture.captureArea(sourceId, rect, viewport))
    );
    ipcMain.handle(C.CLIPBOARD_IMAGE, () => toDataUrl(capture.readClipboardImage()));
  }

  if (voice) {
    ipcMain.handle(C.VOICE_START, (_event, opts) => {
      voice.start({ mode: opts && typeof opts === 'object' ? opts.mode : undefined });
      return { state: voice.state, mode: voice.mode };
    });
    ipcMain.handle(C.VOICE_STOP, async () => {
      await voice.stop();
      return { state: voice.state, mode: voice.mode };
    });
    ipcMain.handle(C.VOICE_STATUS, () => ({ state: voice.state, mode: voice.mode }));
    ipcMain.on(S.VOICE_FRAME, (_event, data) => {
      if (data instanceof ArrayBuffer) voice.pushFrame(Buffer.from(data));
      else if (ArrayBuffer.isView(data)) voice.pushFrame(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    });
  }
}

/** Forward voice controller events to every open window. */
function bindVoiceEvents(voice, getWindows) {
  const send = (channel) => (payload) => {
    for (const win of getWindows()) {
      if (!win.isDestroyed()) win.webContents.send(channel, payload);
    }
  };
  voice.on('transcript', send(E.VOICE_TRANSCRIPT));
  voice.on('status', send(E.VOICE_STATUS));
  voice.on('error', (err) => send(E.VOICE_ERROR)({ message: err.message }));
}

module.exports = { registerIpc, bindVoiceEvents };
