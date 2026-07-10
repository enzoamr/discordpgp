'use strict';
/* global BdApi */

// Réception : détecte les blocs PGP dans les messages, les déchiffre et
// remplace le contenu affiché LOCALEMENT (le message côté serveur reste
// chiffré). Le remplacement passe par un dispatch MESSAGE_UPDATE, technique
// éprouvée par les plugins de traduction/chiffrement BetterDiscord.

const { PLUGIN_NAME, CACHE_LIMIT } = require('./constants');
const pgp = require('./pgp');

const PLACEHOLDER_LOCKED = '🔒 *Message PGP verrouillé — tapez `.pgp unlock` pour le lire*';
const PLACEHOLDER_NO_IDENTITY =
  '🔒 *Message PGP — créez votre identité dans Réglages → Plugins → DiscordPGP*';
const PLACEHOLDER_UNREADABLE =
  '🔒 *Message PGP impossible à déchiffrer (pas chiffré pour votre clé)*';

function capSet(map, key, value) {
  if (!map.has(key) && map.size >= CACHE_LIMIT) {
    map.delete(map.keys().next().value);
  }
  map.set(key, value);
}

class Receiver {
  constructor(ctx) {
    this.ctx = ctx;
    // messageId -> contenu réécrit actuellement affiché
    this.decrypted = new Map();
    // messageId -> { channelId, content (armuré original), base (objet message pour redispatch) }
    this.original = new Map();
    // messageId -> channelId : messages en attente de déverrouillage
    this.pendingLocked = new Map();
    this.lockedToastShown = false;
  }

  // ---- Entrée des événements Flux ----------------------------------------

  handleDispatch(event) {
    if (!event || event.__discordpgp) return;
    switch (event.type) {
      case 'MESSAGE_CREATE': {
        if (event.optimistic) return;
        const msg = event.message;
        if (msg) this.processMessage(msg.channel_id || event.channelId, msg);
        break;
      }
      case 'MESSAGE_UPDATE': {
        const msg = event.message;
        if (msg) this.processMessage(msg.channel_id || event.channelId, msg);
        break;
      }
      case 'LOAD_MESSAGES_SUCCESS': {
        for (const msg of event.messages || []) {
          this.processMessage(msg.channel_id || event.channelId, msg);
        }
        break;
      }
      case 'CHANNEL_SELECT': {
        if (event.channelId) this.processChannelFromStore(event.channelId);
        break;
      }
      default:
    }
  }

  processChannelFromStore(channelId) {
    for (const record of this.ctx.discord.storeMessages(channelId)) {
      this.processMessage(channelId, record);
    }
  }

  /** Re-traite les messages connus d'un salon depuis leur contenu original. */
  reprocessChannel(channelId) {
    for (const [id, entry] of this.original) {
      if (entry.channelId !== channelId) continue;
      this.decrypted.delete(id);
      this.processMessage(channelId, Object.assign({}, entry.base, { content: entry.content }));
    }
  }

  // ---- Traitement d'un message --------------------------------------------

  processMessage(channelId, msg) {
    try {
      this._processMessage(channelId, msg);
    } catch (e) {
      console.error(`[${PLUGIN_NAME}] processMessage`, e);
    }
  }

  _processMessage(channelId, msg) {
    if (!msg || !msg.id || typeof msg.content !== 'string' || !msg.content) return;
    const id = msg.id;
    const content = msg.content;

    // Déjà affiché sous cette forme (c'est notre propre réécriture) : rien à faire.
    if (this.decrypted.get(id) === content) return;

    // Le store a été rafraîchi avec le contenu armuré déjà connu : on
    // ré-affiche simplement ce qu'on avait calculé, sans re-déchiffrer.
    const known = this.original.get(id);
    if (known && known.content === content && this.decrypted.has(id)) {
      this.show(channelId, known.base, this.decrypted.get(id));
      return;
    }

    const blocks = pgp.extractBlocks(content);
    if (!blocks.message && !blocks.publicKey) return;

    const base = this._baseOf(msg, channelId);
    capSet(this.original, id, { channelId, content, base });

    if (blocks.message) {
      this._handleEncrypted(channelId, id, blocks.message, base);
    } else if (blocks.publicKey) {
      this._handlePublicKey(channelId, id, blocks.publicKey, base, msg);
    }
  }

  _handleEncrypted(channelId, id, armored, base) {
    const { keyring, session } = this.ctx;
    if (!keyring.getIdentity()) {
      this.show(channelId, base, PLACEHOLDER_NO_IDENTITY);
      return;
    }
    if (!session.isUnlocked()) {
      this.pendingLocked.set(id, channelId);
      this.show(channelId, base, PLACEHOLDER_LOCKED);
      if (!this.lockedToastShown) {
        this.lockedToastShown = true;
        this.ctx.toast('messages PGP verrouillés — tapez `.pgp unlock`', 'warning');
      }
      return;
    }
    this._decryptAndShow(channelId, id, armored, base);
  }

  async _decryptAndShow(channelId, id, armored, base) {
    const { keyring, session } = this.ctx;
    try {
      const result = await pgp.decryptText(
        armored,
        session.getKey(),
        keyring.allVerificationKeys()
      );
      this.show(channelId, base, this._decorate(result));
    } catch (e) {
      this.show(channelId, base, PLACEHOLDER_UNREADABLE);
    }
  }

  async _handlePublicKey(channelId, id, armoredKey, base, msg) {
    try {
      const info = await pgp.keyInfo(armoredKey);
      const authorId = msg.author && msg.author.id;
      const who = authorId ? this.ctx.discord.userLabel(authorId) : 'quelqu\'un';
      const already = this.ctx.keyring.getContact(info.fingerprint);
      const own =
        this.ctx.keyring.getIdentity() &&
        this.ctx.keyring.getIdentity().fingerprint === info.fingerprint;
      let hint;
      if (own) hint = 'c\'est votre clé';
      else if (already) hint = `déjà importée (${already.label})`;
      else hint = 'tapez `.pgp trust` pour l\'importer';
      const text =
        `🔑 **Clé publique PGP** de ${who}` +
        `\n\`${pgp.formatFingerprint(info.fingerprint)}\`` +
        (info.userIDs.length ? `\n-# ${info.userIDs.join(', ')} — ${hint}` : `\n-# ${hint}`);
      this.show(channelId, base, text);
    } catch (e) {
      // bloc invalide : on laisse le message tel quel
    }
  }

  _decorate({ text, signature }) {
    const { keyring } = this.ctx;
    const settings = keyring.getSettings();
    const prefix = settings.decoratePrefix ? '🔐 ' : '';
    let suffix = '';

    if (signature.status === 'valid') {
      const label = this._signerLabel(signature.keyID);
      if (settings.showValidSignature && label !== null) {
        suffix = `\n-# 🔏 signature valide — ${label}`;
      }
    } else if (signature.status === 'invalid') {
      suffix = '\n-# ⛔ **SIGNATURE INVALIDE** — ce message a pu être falsifié';
    } else if (signature.status === 'unknown' && settings.warnUnknownKey) {
      suffix = `\n-# ⚠️ signé par une clé inconnue (${signature.keyID})`;
    } else if (signature.status === 'none' && settings.warnUnsigned) {
      suffix = '\n-# ⚠️ message non signé';
    }
    return prefix + text + suffix;
  }

  _signerLabel(keyID) {
    if (!keyID) return null;
    const { keyring } = this.ctx;
    const identity = keyring.getIdentity();
    if (identity && identity.fingerprint.endsWith(keyID)) return 'vous';
    const contact = keyring
      .listContacts()
      .find((c) => c.fingerprint.endsWith(keyID));
    return contact ? contact.label : keyID;
  }

  // ---- Affichage / restauration -------------------------------------------

  _baseOf(msg, channelId) {
    // Les records du store exposent parfois toJS() : version brute plus sûre
    // pour un redispatch MESSAGE_UPDATE.
    const raw = typeof msg.toJS === 'function' ? msg.toJS() : msg;
    const base = Object.assign({}, raw);
    base.id = msg.id;
    base.channel_id = raw.channel_id || msg.channel_id || channelId;
    return base;
  }

  show(channelId, base, newContent) {
    const dispatcher = this.ctx.discord.Dispatcher;
    if (!dispatcher) return;
    capSet(this.decrypted, base.id, newContent);
    const payload = {
      type: 'MESSAGE_UPDATE',
      message: Object.assign({}, base, { content: newContent }),
      __discordpgp: true,
    };
    // setTimeout : ne jamais dispatcher pendant un dispatch Flux en cours.
    setTimeout(() => {
      try {
        dispatcher.dispatch(payload);
      } catch (e) {
        console.error(`[${PLUGIN_NAME}] dispatch`, e);
      }
    }, 0);
  }

  /** Appelé après déverrouillage : déchiffre tout ce qui attendait. */
  onUnlocked() {
    this.lockedToastShown = false;
    const pending = [...this.pendingLocked];
    this.pendingLocked.clear();
    for (const [id, channelId] of pending) {
      const entry = this.original.get(id);
      if (!entry) continue;
      const blocks = pgp.extractBlocks(entry.content);
      if (blocks.message) {
        this.decrypted.delete(id);
        this._decryptAndShow(channelId, id, blocks.message, entry.base);
      }
    }
  }

  /** Appelé quand la session se verrouille : retire le clair de l'affichage. */
  onLocked() {
    this.restoreAll();
    const channelId = this.ctx.discord.SelectedChannelStore?.getChannelId?.();
    if (channelId) this.processChannelFromStore(channelId);
  }

  /** Remet les contenus armurés d'origine (arrêt du plugin, verrouillage). */
  restoreAll() {
    for (const [id, entry] of this.original) {
      if (!this.decrypted.has(id)) continue;
      const dispatcher = this.ctx.discord.Dispatcher;
      if (!dispatcher) break;
      const payload = {
        type: 'MESSAGE_UPDATE',
        message: Object.assign({}, entry.base, { content: entry.content }),
        __discordpgp: true,
      };
      setTimeout(() => {
        try {
          dispatcher.dispatch(payload);
        } catch (e) {
          /* noop */
        }
      }, 0);
    }
    this.decrypted.clear();
    this.pendingLocked.clear();
    this.lockedToastShown = false;
  }
}

module.exports = { Receiver, PLACEHOLDER_LOCKED, PLACEHOLDER_NO_IDENTITY, PLACEHOLDER_UNREADABLE };
