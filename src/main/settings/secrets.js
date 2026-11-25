'use strict';

const fs = require('node:fs');
const path = require('node:path');

const NAME_PATTERN = /^[a-z][a-z0-9_-]{1,31}$/;
const MAX_SECRET_LENGTH = 512;

/**
 * API keys encrypted with the operating system's credential store (Electron safeStorage:
 * DPAPI on Windows, Keychain on macOS, libsecret on Linux). Values are never written in
 * plain text: if encryption is unavailable, saving is refused rather than downgraded.
 */
class SecretStore {
  constructor({ file, safeStorage, fsImpl = fs }) {
    this.file = file;
    this.safe = safeStorage;
    this.fs = fsImpl;
  }

  get available() {
    try {
      return Boolean(this.safe && this.safe.isEncryptionAvailable());
    } catch {
      return false;
    }
  }

  _read() {
    try {
      const data = JSON.parse(this.fs.readFileSync(this.file, 'utf8'));
      return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch {
      return {};
    }
  }

  _write(data) {
    this.fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    this.fs.writeFileSync(tmp, JSON.stringify(data), { encoding: 'utf8', mode: 0o600 });
    this.fs.renameSync(tmp, this.file);
  }

  _check(name) {
    if (typeof name !== 'string' || !NAME_PATTERN.test(name)) throw new Error('Invalid secret name');
  }

  set(name, value) {
    this._check(name);
    if (typeof value !== 'string' || !value.trim()) throw new Error('The key cannot be empty');
    const clean = value.trim();
    if (clean.length > MAX_SECRET_LENGTH) throw new Error('That key is too long');
    if (/\s/.test(clean)) throw new Error('A key cannot contain spaces or line breaks');
    if (!this.available) throw new Error('Secure storage is not available on this system, so the key was not saved');
    const data = this._read();
    data[name] = this.safe.encryptString(clean).toString('base64');
    this._write(data);
  }

  /** Decrypted value, or '' when missing or unreadable. */
  get(name) {
    this._check(name);
    const encoded = this._read()[name];
    if (!encoded || !this.available) return '';
    try {
      return this.safe.decryptString(Buffer.from(encoded, 'base64'));
    } catch {
      return '';
    }
  }

  has(name) {
    this._check(name);
    return typeof this._read()[name] === 'string';
  }

  delete(name) {
    this._check(name);
    const data = this._read();
    if (!(name in data)) return false;
    delete data[name];
    this._write(data);
    return true;
  }
}

module.exports = { SecretStore, NAME_PATTERN };
