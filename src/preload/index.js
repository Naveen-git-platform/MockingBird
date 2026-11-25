'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const { ALLOWED_INVOKE, ALLOWED_SEND, ALLOWED_EVENTS } = require('../shared/channels');

contextBridge.exposeInMainWorld('mockingbird', {
  invoke(channel, ...args) {
    if (!ALLOWED_INVOKE.has(channel)) {
      return Promise.reject(new Error(`Blocked IPC channel: ${channel}`));
    }
    return ipcRenderer.invoke(channel, ...args);
  },
  send(channel, ...args) {
    if (!ALLOWED_SEND.has(channel)) throw new Error(`Blocked IPC channel: ${channel}`);
    ipcRenderer.send(channel, ...args);
  },
  /** Subscribe to a main-process event. Returns an unsubscribe function. */
  on(channel, callback) {
    if (!ALLOWED_EVENTS.has(channel)) throw new Error(`Blocked IPC channel: ${channel}`);
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
