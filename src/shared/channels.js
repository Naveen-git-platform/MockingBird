'use strict';

// Every IPC channel the renderer may use. The preload script exposes only these.
const INVOKE_CHANNELS = Object.freeze({
  APP_INFO: 'app:info',
  CONFIG_GET: 'config:get',
  CAPTURE_SOURCES: 'capture:sources',
  CAPTURE_SCREEN: 'capture:screen',
  CAPTURE_SOURCE: 'capture:source',
  CAPTURE_AREA: 'capture:area',
  CLIPBOARD_IMAGE: 'clipboard:image',
  INPUT_VALIDATE: 'input:validate',
  VOICE_START: 'voice:start',
  VOICE_STOP: 'voice:stop',
  VOICE_STATUS: 'voice:status-get',
  INTERVIEW_OPTIONS: 'interview:options',
  INTERVIEW_START: 'interview:start',
  INTERVIEW_ANSWER: 'interview:answer',
  INTERVIEW_HINT: 'interview:hint',
  INTERVIEW_SKIP: 'interview:skip',
  INTERVIEW_NEXT: 'interview:next',
  INTERVIEW_FINISH: 'interview:finish',
  INTERVIEW_STATE: 'interview:state',
  INTERVIEW_DISCARD: 'interview:discard',
  HISTORY_LIST: 'history:list',
  HISTORY_GET: 'history:get',
  HISTORY_DELETE: 'history:delete',
  HISTORY_CLEAR: 'history:clear',
  HISTORY_STATS: 'history:stats',
  HISTORY_EXPORT: 'history:export',
  PRACTICE_ASK: 'practice:ask',
  PRACTICE_RESET: 'practice:reset',
  PRACTICE_OPTIONS: 'practice:options',
  LLM_STATUS: 'llm:status',
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_SET_KEY: 'settings:set-key',
  SETTINGS_DELETE_KEY: 'settings:delete-key',
});

// Fire-and-forget messages from renderer to main.
const SEND_CHANNELS = Object.freeze({
  VOICE_FRAME: 'voice:frame',
});

// Events pushed from main to renderer.
const EVENT_CHANNELS = Object.freeze({
  VOICE_TRANSCRIPT: 'voice:transcript',
  VOICE_STATUS: 'voice:status',
  VOICE_ERROR: 'voice:error',
  INTERVIEW_DELTA: 'interview:delta',
  PRACTICE_DELTA: 'practice:delta',
});

const ALLOWED_INVOKE = new Set(Object.values(INVOKE_CHANNELS));
const ALLOWED_SEND = new Set(Object.values(SEND_CHANNELS));
const ALLOWED_EVENTS = new Set(Object.values(EVENT_CHANNELS));

module.exports = { INVOKE_CHANNELS, SEND_CHANNELS, EVENT_CHANNELS, ALLOWED_INVOKE, ALLOWED_SEND, ALLOWED_EVENTS };
