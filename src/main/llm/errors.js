'use strict';

const RETRYABLE_KINDS = new Set(['rate_limit', 'server', 'network', 'timeout']);

class LlmError extends Error {
  /**
   * @param {string} message
   * @param {{kind?: string, status?: number, provider?: string, cause?: Error}} [info]
   * kind: config | auth | rate_limit | bad_request | server | network | timeout | aborted | unknown
   */
  constructor(message, { kind = 'unknown', status, provider, cause } = {}) {
    super(message);
    this.name = 'LlmError';
    this.kind = kind;
    this.status = status;
    this.provider = provider;
    if (cause) this.cause = cause;
  }

  get retryable() {
    return RETRYABLE_KINDS.has(this.kind);
  }
}

function kindFromStatus(status) {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status === 408) return 'timeout';
  if (status >= 500) return 'server';
  if (status >= 400) return 'bad_request';
  return 'unknown';
}

module.exports = { LlmError, kindFromStatus };
