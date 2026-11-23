'use strict';
/**
 * Petit stockage persistant en JSON dans le dossier de données de l'application.
 * Le jeton Moodle est chiffré avec le trousseau du système (safeStorage) quand c'est possible.
 */
const fs = require('fs');
const path = require('path');

class Store {
  constructor(dir, { encrypt, decrypt } = {}) {
    this.dir = dir;
    this.file = path.join(dir, 'moodle-plus.json');
    this.encrypt = encrypt;
    this.decrypt = decrypt;
    this.data = {};
    try {
      this.data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      this.data = {};
    }
  }

  get(key, fallback) {
    return key in this.data ? this.data[key] : fallback;
  }

  set(key, value) {
    this.data[key] = value;
    this._save();
  }

  delete(key) {
    delete this.data[key];
    this._save();
  }

  setSecret(key, value) {
    if (this.encrypt) {
      try {
        this.set(key, { enc: true, v: this.encrypt(value) });
        return;
      } catch { /* on retombe sur le stockage simple */ }
    }
    this.set(key, { enc: false, v: value });
  }

  getSecret(key) {
    const raw = this.get(key);
    if (!raw) return null;
    if (raw.enc) {
      try { return this.decrypt(raw.v); } catch { return null; }
    }
    return raw.v;
  }

  _save() {
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { Store };
