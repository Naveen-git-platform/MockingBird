'use strict';

// Every IPC channel the renderer may invoke. The preload script exposes only these.
const INVOKE_CHANNELS = Object.freeze({
  APP_INFO: 'app:info',
  CONFIG_GET: 'config:get',
});

const ALLOWED_INVOKE = new Set(Object.values(INVOKE_CHANNELS));

module.exports = { INVOKE_CHANNELS, ALLOWED_INVOKE };
