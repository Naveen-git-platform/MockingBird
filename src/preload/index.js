'use strict';

// Sandboxed preload scripts can only require 'electron' (and a few built-ins), not local
// files. The channel allowlist therefore comes from the main process, which owns it.
const { contextBridge, ipcRenderer } = require('electron');

const lists = ipcRenderer.sendSync('mockingbird:channels');
const allowedInvoke = new Set(lists.invoke);
const allowedSend = new Set(lists.send);
const allowedEvents = new Set(lists.events);

contextBridge.exposeInMainWorld('mockingbird', {
  invoke(channel, ...args) {
    if (!allowedInvoke.has(channel)) {
      return Promise.reject(new Error(`Blocked IPC channel: ${channel}`));
    }
    return ipcRenderer.invoke(channel, ...args);
  },
  send(channel, ...args) {
    if (!allowedSend.has(channel)) throw new Error(`Blocked IPC channel: ${channel}`);
    ipcRenderer.send(channel, ...args);
  },
  /** Subscribe to a main-process event. Returns an unsubscribe function. */
  on(channel, callback) {
    if (!allowedEvents.has(channel)) throw new Error(`Blocked IPC channel: ${channel}`);
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
