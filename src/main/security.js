'use strict';

const EXTERNAL = /^(https?:\/\/|mailto:)/i;

/**
 * Lock down a window's web contents: links open in the system browser (http, https and
 * mailto only), the window can never navigate away from the app's own files, and
 * <webview> tags are refused.
 */
function hardenWebContents(webContents, { shell, isOwnUrl = (u) => u.startsWith('file://') }) {
  webContents.setWindowOpenHandler(({ url }) => {
    if (EXTERNAL.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  webContents.on('will-navigate', (event, url) => {
    if (!isOwnUrl(url)) event.preventDefault();
  });
  webContents.on('will-attach-webview', (event) => event.preventDefault());
}

module.exports = { hardenWebContents };
