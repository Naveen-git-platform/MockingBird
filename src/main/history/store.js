'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

function assertId(id) {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw new Error('Invalid session id');
}

function summarise(snapshot) {
  const report = snapshot.report || {};
  return {
    id: snapshot.id,
    mode: snapshot.mode,
    language: snapshot.language,
    difficulty: snapshot.difficulty,
    role: snapshot.role || '',
    startedAt: snapshot.startedAt,
    finishedAt: snapshot.finishedAt,
    questionsAsked: report.questionsAsked ?? snapshot.questions?.length ?? 0,
    questionsAnswered: report.questionsAnswered ?? 0,
    averageScore: report.averageScore ?? null,
    hintsUsed: report.hintsUsed ?? 0,
  };
}

/** One JSON file per finished interview, written atomically. */
class HistoryStore {
  constructor({ dir, fsImpl = fs, logger = null }) {
    this.dir = dir;
    this.fs = fsImpl;
    this.logger = logger;
  }

  _file(id) {
    assertId(id);
    return path.join(this.dir, `${id}.json`);
  }

  save(snapshot) {
    if (!snapshot || snapshot.status !== 'finished') throw new Error('Only finished interviews can be saved');
    const file = this._file(snapshot.id);
    this.fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    this.fs.writeFileSync(tmp, JSON.stringify(snapshot, null, 2), 'utf8');
    this.fs.renameSync(tmp, file);
    return summarise(snapshot);
  }

  get(id) {
    const file = this._file(id);
    try {
      return JSON.parse(this.fs.readFileSync(file, 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw new Error(`Could not read session ${id}: ${err.message}`);
    }
  }

  /** Newest first. Unreadable files are skipped, never fatal. */
  list({ limit } = {}) {
    let names;
    try {
      names = this.fs.readdirSync(this.dir);
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
    const out = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      try {
        const snapshot = JSON.parse(this.fs.readFileSync(path.join(this.dir, name), 'utf8'));
        if (snapshot && snapshot.id && snapshot.status === 'finished') out.push(summarise(snapshot));
      } catch (err) {
        this.logger?.warn('skipping unreadable history file', { name, error: err.message });
      }
    }
    out.sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
    return Number.isInteger(limit) && limit > 0 ? out.slice(0, limit) : out;
  }

  delete(id) {
    const file = this._file(id);
    try {
      this.fs.unlinkSync(file);
      return true;
    } catch (err) {
      if (err.code === 'ENOENT') return false;
      throw err;
    }
  }

  clear() {
    let removed = 0;
    for (const s of this.list()) {
      if (this.delete(s.id)) removed += 1;
    }
    return removed;
  }
}

module.exports = { HistoryStore, summarise };
