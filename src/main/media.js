'use strict';

/**
 * Microphone and system-audio permissions.
 *  - Only the app's own pages may use the microphone.
 *  - System audio ("loopback") is offered on Windows through getDisplayMedia.
 */
function installMediaHandlers(session, { desktopCapturer, platform = process.platform, isOwnUrl = (u) => u.startsWith('file://') }) {
  session.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const url = details?.requestingUrl || webContents?.getURL?.() || '';
    callback(permission === 'media' && isOwnUrl(url));
  });
  session.setPermissionCheckHandler((_wc, permission, requestingOrigin) => permission === 'media' && isOwnUrl(requestingOrigin || 'file://'));

  if (platform === 'win32' && typeof session.setDisplayMediaRequestHandler === 'function') {
    session.setDisplayMediaRequestHandler(async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen'] });
        if (sources.length === 0) return callback({});
        callback({ video: sources[0], audio: 'loopback' });
      } catch {
        callback({});
      }
    });
  }
}

module.exports = { installMediaHandlers };
