'use strict';

const { INVOKE_CHANNELS } = require('../shared/channels');

/**
 * Register IPC handlers. `ipcMain` is injected so tests can pass a fake.
 */
function registerIpc(ipcMain, { config, appInfo }) {
  ipcMain.handle(INVOKE_CHANNELS.APP_INFO, () => ({ ...appInfo }));
  ipcMain.handle(INVOKE_CHANNELS.CONFIG_GET, (_event, keyPath) => {
    if (typeof keyPath !== 'string' || keyPath.length === 0) return config.toJSON();
    return config.get(keyPath);
  });
}

module.exports = { registerIpc };
