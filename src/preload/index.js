'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const { ALLOWED_INVOKE } = require('../shared/channels');

contextBridge.exposeInMainWorld('mockingbird', {
  invoke(channel, ...args) {
    if (!ALLOWED_INVOKE.has(channel)) {
      return Promise.reject(new Error(`Blocked IPC channel: ${channel}`));
    }
    return ipcRenderer.invoke(channel, ...args);
  },
});
