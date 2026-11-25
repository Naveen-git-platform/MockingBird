'use strict';

const { INVOKE_CHANNELS: C } = require('../shared/channels');
const { normalizeInput } = require('./capture/input');

const toDataUrl = (img) => (img ? `data:${img.mimeType};base64,${img.data}` : null);

/**
 * Register IPC handlers. `ipcMain` is injected so tests can pass a fake.
 * Capture handlers are registered only when a capture service is supplied.
 */
function registerIpc(ipcMain, { config, appInfo, capture }) {
  ipcMain.handle(C.APP_INFO, () => ({ ...appInfo }));
  ipcMain.handle(C.CONFIG_GET, (_event, keyPath) => {
    if (typeof keyPath !== 'string' || keyPath.length === 0) return config.toJSON();
    return config.get(keyPath);
  });
  ipcMain.handle(C.INPUT_VALIDATE, (_event, raw) => normalizeInput(raw));

  if (!capture) return;
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

module.exports = { registerIpc };
