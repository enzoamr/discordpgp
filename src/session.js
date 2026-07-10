'use strict';

// Garde en mémoire la clé privée déverrouillée, avec verrouillage
// automatique après un délai configurable. La clé n'est JAMAIS écrite sur
// disque en clair.

class Session {
  constructor() {
    this.key = null; // objet clé privée openpgp déverrouillée
    this.timer = null;
    this.onLock = null; // callback optionnel quand la session se verrouille
  }

  isUnlocked() {
    return this.key !== null;
  }

  setKey(key, timeoutMinutes) {
    this.key = key;
    this._resetTimer(timeoutMinutes);
  }

  getKey() {
    return this.key;
  }

  lock() {
    this.key = null;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (typeof this.onLock === 'function') {
      try {
        this.onLock();
      } catch (e) {
        /* noop */
      }
    }
  }

  _resetTimer(timeoutMinutes) {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const minutes = Number(timeoutMinutes);
    if (minutes > 0) {
      this.timer = setTimeout(() => this.lock(), minutes * 60 * 1000);
    }
  }
}

module.exports = { Session };
