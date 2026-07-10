'use strict';

// Trousseau : identité, contacts (clés publiques), configuration par salon
// et réglages. La persistance passe par un adaptateur injecté pour rester
// testable hors de BetterDiscord.

const { DEFAULT_SETTINGS } = require('./constants');

class Keyring {
  /**
   * @param {{load(key: string): any, save(key: string, value: any): void}} storage
   */
  constructor(storage) {
    this.storage = storage;
    this.identity = storage.load('identity') || null;
    // contacts : { [fingerprint]: { publicKeyArmored, fingerprint, label, discordUserId, addedAt } }
    this.contacts = storage.load('contacts') || {};
    // channels : { [channelId]: { enabled, extraRecipients: [fingerprint] } }
    this.channels = storage.load('channels') || {};
    this.settings = Object.assign({}, DEFAULT_SETTINGS, storage.load('settings') || {});
  }

  // ---- Identité -----------------------------------------------------------

  getIdentity() {
    return this.identity;
  }

  setIdentity(identity) {
    this.identity = identity;
    this.storage.save('identity', identity);
  }

  clearIdentity() {
    this.identity = null;
    this.storage.save('identity', null);
  }

  // ---- Contacts -----------------------------------------------------------

  addContact({ publicKeyArmored, fingerprint, label, discordUserId }) {
    const fp = fingerprint.toUpperCase();
    this.contacts[fp] = {
      publicKeyArmored,
      fingerprint: fp,
      label: label || fp.slice(-8),
      discordUserId: discordUserId || null,
      addedAt: Date.now(),
    };
    this.storage.save('contacts', this.contacts);
    return this.contacts[fp];
  }

  removeContact(fingerprint) {
    const fp = String(fingerprint).toUpperCase();
    delete this.contacts[fp];
    // Nettoie les références dans les salons.
    for (const cfg of Object.values(this.channels)) {
      if (Array.isArray(cfg.extraRecipients)) {
        cfg.extraRecipients = cfg.extraRecipients.filter((f) => f !== fp);
      }
    }
    this.storage.save('contacts', this.contacts);
    this.storage.save('channels', this.channels);
  }

  getContact(fingerprint) {
    return this.contacts[String(fingerprint).toUpperCase()] || null;
  }

  listContacts() {
    return Object.values(this.contacts).sort((a, b) => (a.label || '').localeCompare(b.label || ''));
  }

  findContactByDiscordId(discordUserId) {
    if (!discordUserId) return null;
    return (
      Object.values(this.contacts).find((c) => c.discordUserId === String(discordUserId)) || null
    );
  }

  setContactDiscordId(fingerprint, discordUserId) {
    const contact = this.getContact(fingerprint);
    if (!contact) return;
    contact.discordUserId = discordUserId ? String(discordUserId) : null;
    this.storage.save('contacts', this.contacts);
  }

  setContactLabel(fingerprint, label) {
    const contact = this.getContact(fingerprint);
    if (!contact) return;
    contact.label = label;
    this.storage.save('contacts', this.contacts);
  }

  /** Toutes les clés publiques connues (contacts + identité) pour vérifier les signatures. */
  allVerificationKeys() {
    const keys = Object.values(this.contacts).map((c) => c.publicKeyArmored);
    if (this.identity) keys.push(this.identity.publicKeyArmored);
    return keys;
  }

  // ---- Salons -------------------------------------------------------------

  getChannel(channelId) {
    return this.channels[channelId] || { enabled: false, extraRecipients: [] };
  }

  setChannelEnabled(channelId, enabled) {
    const cfg = this.channels[channelId] || { enabled: false, extraRecipients: [] };
    cfg.enabled = Boolean(enabled);
    if (cfg.enabled || cfg.extraRecipients.length) {
      this.channels[channelId] = cfg;
    } else {
      delete this.channels[channelId];
    }
    this.storage.save('channels', this.channels);
  }

  setChannelRecipients(channelId, fingerprints) {
    const cfg = this.channels[channelId] || { enabled: false, extraRecipients: [] };
    cfg.extraRecipients = (fingerprints || []).map((f) => String(f).toUpperCase());
    this.channels[channelId] = cfg;
    this.storage.save('channels', this.channels);
  }

  listEnabledChannels() {
    return Object.entries(this.channels)
      .filter(([, cfg]) => cfg.enabled)
      .map(([channelId, cfg]) => ({ channelId, ...cfg }));
  }

  // ---- Réglages -----------------------------------------------------------

  getSettings() {
    return this.settings;
  }

  updateSettings(patch) {
    Object.assign(this.settings, patch);
    this.storage.save('settings', this.settings);
  }
}

/** Adaptateur mémoire (tests). */
class MemoryStorage {
  constructor() {
    this.data = {};
  }
  load(key) {
    return this.data[key];
  }
  save(key, value) {
    this.data[key] = value;
  }
}

module.exports = { Keyring, MemoryStorage };
