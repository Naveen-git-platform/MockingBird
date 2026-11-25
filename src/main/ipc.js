'use strict';

const { INVOKE_CHANNELS: C, SEND_CHANNELS: S, EVENT_CHANNELS: E } = require('../shared/channels');
const { normalizeInput } = require('./capture/input');

const toDataUrl = (img) => (img ? `data:${img.mimeType};base64,${img.data}` : null);

/**
 * Register IPC handlers. `ipcMain` is injected so tests can pass a fake.
 * Capture and voice handlers are registered only when their service is supplied.
 */
function registerIpc(ipcMain, { config, appInfo, capture, voice, interview, interviewOptions, history, practice, practiceOptions, llm }) {
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

  if (interview) registerInterviewIpc(ipcMain, interview, interviewOptions);

  if (llm) ipcMain.handle(C.LLM_STATUS, () => llm.describe());

  if (practice) {
    ipcMain.handle(C.PRACTICE_OPTIONS, () => (practiceOptions ? practiceOptions() : {}));
    ipcMain.handle(C.PRACTICE_RESET, () => {
      practice.reset();
      return null;
    });
    ipcMain.handle(C.PRACTICE_ASK, async (event, raw) => {
      const input = normalizeInput(raw);
      const options = {};
      for (const key of ['mode', 'style', 'language']) {
        if (raw && typeof raw[key] === 'string') options[key] = raw[key];
      }
      return practice.ask(input, options, {
        onDelta: (text) => {
          if (!event.sender.isDestroyed?.()) event.sender.send(E.PRACTICE_DELTA, { text });
        },
      });
    });
  }

  if (history) {
    ipcMain.handle(C.HISTORY_LIST, (_event, opts) => history.list({ limit: opts && Number.isInteger(opts.limit) ? opts.limit : undefined }));
    ipcMain.handle(C.HISTORY_GET, (_event, id) => history.get(id));
    ipcMain.handle(C.HISTORY_DELETE, (_event, id) => history.delete(id));
    ipcMain.handle(C.HISTORY_CLEAR, () => history.clear());
    ipcMain.handle(C.HISTORY_STATS, () => history.stats());
    ipcMain.handle(C.HISTORY_EXPORT, (_event, id) => history.exportSession(id));
  }
}

function registerInterviewIpc(ipcMain, interview, interviewOptions) {
  const stream = (event, kind) => ({
    onDelta: (text) => {
      if (!event.sender.isDestroyed?.()) event.sender.send(E.INTERVIEW_DELTA, { kind, text });
    },
  });
  ipcMain.handle(C.INTERVIEW_OPTIONS, () => (interviewOptions ? interviewOptions() : {}));
  ipcMain.handle(C.INTERVIEW_START, (event, options) =>
    interview.start(options && typeof options === 'object' ? options : {}, stream(event, 'question'))
  );
  ipcMain.handle(C.INTERVIEW_ANSWER, (_event, raw) => interview.answer(normalizeInput(raw)));
  ipcMain.handle(C.INTERVIEW_HINT, (event) => interview.hint(stream(event, 'hint')));
  ipcMain.handle(C.INTERVIEW_SKIP, () => interview.skip());
  ipcMain.handle(C.INTERVIEW_NEXT, (event) => interview.next(stream(event, 'question')));
  ipcMain.handle(C.INTERVIEW_FINISH, () => interview.finish());
  ipcMain.handle(C.INTERVIEW_STATE, () => interview.state());
  ipcMain.handle(C.INTERVIEW_DISCARD, () => {
    interview.discard();
    return null;
  });
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
