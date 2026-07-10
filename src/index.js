'use strict';
/* global BdApi */

// DiscordPGP — chiffrement PGP de bout en bout pour Discord Desktop.
// Point d'entrée du plugin BetterDiscord : cycle de vie, patch d'envoi,
// abonnements Flux, déverrouillage de la clé.

const { PLUGIN_NAME, COMMAND_PREFIX } = require('./constants');
const pgp = require('./pgp');
const gpg = require('./gpg');
const { Keyring } = require('./keyring');
const { Session } = require('./session');
const { Discord } = require('./discord');
const { Receiver } = require('./receive');
const { isCommand, runCommand } = require('./commands');
const { encryptOutgoing } = require('./send');
const { promptText, confirm } = require('./ui/modals');
const { buildSettingsPanel } = require('./ui/settings');

const DISPATCH_EVENTS = [
  'MESSAGE_CREATE',
  'MESSAGE_UPDATE',
  'LOAD_MESSAGES_SUCCESS',
  'CHANNEL_SELECT',
];

module.exports = class DiscordPGP {
  constructor(meta) {
    this.meta = meta || { name: PLUGIN_NAME };
    this._unlockInFlight = null;
    this._dispatchHandler = null;
  }

  start() {
    const storage = {
      load: (key) => BdApi.Data.load(PLUGIN_NAME, key),
      save: (key, value) => BdApi.Data.save(PLUGIN_NAME, key, value),
    };
    this.keyring = new Keyring(storage);
    this.session = new Session();
    this.gpgStatus = null;

    this.ctx = {
      keyring: this.keyring,
      session: this.session,
      discord: Discord,
      pgp,
      gpg,
      receiver: null,
      ensureUnlocked: (reason) => this.ensureUnlocked(reason),
      toast: (message, type = 'info') =>
        BdApi.UI.showToast(`${PLUGIN_NAME} : ${message}`, { type, timeout: 5000 }),
      getGpgStatus: () => this.gpgStatus,
      setGpgStatus: (status) => {
        this.gpgStatus = status;
      },
    };
    this.receiver = new Receiver(this.ctx);
    this.ctx.receiver = this.receiver;
    this.session.onLock = () => {
      try {
        this.receiver.onLocked();
        this.ctx.toast('clé verrouillée automatiquement 🔒', 'info');
      } catch (e) {
        /* noop */
      }
    };

    // --- Patch d'envoi : chiffre les messages sortants, intercepte .pgp ---
    const actions = Discord.MessageActions;
    if (actions && typeof actions.sendMessage === 'function') {
      BdApi.Patcher.instead(PLUGIN_NAME, actions, 'sendMessage', (thisObj, args, original) =>
        this._onSendMessage(thisObj, args, original)
      );
    } else {
      this.ctx.toast('module d\'envoi introuvable — chiffrement à l\'envoi indisponible', 'error');
    }

    // --- Garde-fou pièces jointes : les fichiers (et leur légende) ne
    // passent PAS par sendMessage et partent donc NON chiffrés. Dans un
    // salon .pgp on, on demande confirmation avant l'upload. ---
    const uploadManager = Discord.UploadManager;
    if (uploadManager && typeof uploadManager.uploadFiles === 'function') {
      BdApi.Patcher.instead(PLUGIN_NAME, uploadManager, 'uploadFiles', (thisObj, args, original) =>
        this._onUploadFiles(thisObj, args, original)
      );
    }

    // --- Déchiffrement des messages entrants ---
    this._dispatchHandler = (event) => {
      try {
        this.receiver.handleDispatch(event);
      } catch (e) {
        console.error(`[${PLUGIN_NAME}]`, e);
      }
    };
    const dispatcher = Discord.Dispatcher;
    if (dispatcher) {
      for (const eventType of DISPATCH_EVENTS) {
        dispatcher.subscribe(eventType, this._dispatchHandler);
      }
    } else {
      this.ctx.toast('dispatcher introuvable — déchiffrement automatique indisponible', 'error');
    }

    // Traite le salon déjà ouvert.
    const currentChannelId = Discord.SelectedChannelStore?.getChannelId?.();
    if (currentChannelId) this.receiver.processChannelFromStore(currentChannelId);

    // Détection GnuPG en arrière-plan (facultative).
    gpg
      .detect()
      .then((status) => {
        this.gpgStatus = status;
      })
      .catch(() => {
        this.gpgStatus = { available: false, reason: 'erreur de détection' };
      });

    const identity = this.keyring.getIdentity();
    this.ctx.toast(
      identity
        ? `actif — tapez ${COMMAND_PREFIX} help dans un salon`
        : 'actif — créez votre identité dans Réglages → Plugins → DiscordPGP',
      'success'
    );
  }

  stop() {
    try {
      BdApi.Patcher.unpatchAll(PLUGIN_NAME);
    } catch (e) {
      /* noop */
    }
    const dispatcher = Discord.Dispatcher;
    if (dispatcher && this._dispatchHandler) {
      for (const eventType of DISPATCH_EVENTS) {
        try {
          dispatcher.unsubscribe(eventType, this._dispatchHandler);
        } catch (e) {
          /* noop */
        }
      }
    }
    try {
      this.receiver?.restoreAll();
    } catch (e) {
      /* noop */
    }
    if (this.session) {
      this.session.onLock = null; // pas de re-traitement pendant l'arrêt
      this.session.lock();
    }
  }

  getSettingsPanel() {
    return buildSettingsPanel(this.ctx);
  }

  // ---- Envoi ---------------------------------------------------------------

  async _onSendMessage(thisObj, args, original) {
    const [channelId, message] = args;
    const content = message && typeof message.content === 'string' ? message.content : '';

    // Commandes .pgp : interceptées, jamais envoyées.
    if (isCommand(content)) {
      try {
        await runCommand(this.ctx, channelId, content);
      } catch (e) {
        this.ctx.toast(e.userFacing ? e.message : `erreur : ${e.message}`, 'error');
      }
      return;
    }

    const cfg = this.keyring.getChannel(channelId);
    const trimmed = content.trim();
    // Pas de chiffrement : salon non activé, message vide (pièce jointe
    // seule) ou contenu déjà armuré (ex : envoi de clé publique).
    if (!cfg.enabled || !trimmed || trimmed.includes('-----BEGIN PGP')) {
      return original.apply(thisObj, args);
    }

    try {
      const armored = await encryptOutgoing(this.ctx, channelId, content);
      message.content = armored;
      return original.apply(thisObj, args);
    } catch (e) {
      // Sécurité : si le chiffrement échoue, on N'ENVOIE RIEN (jamais de
      // repli silencieux vers du texte en clair).
      this.ctx.toast(e.userFacing ? e.message : `échec du chiffrement : ${e.message}`, 'error');
      if (!e.userFacing) console.error(`[${PLUGIN_NAME}]`, e);
    }
  }

  async _onUploadFiles(thisObj, args, original) {
    try {
      const first = args[0];
      const channelId =
        (first && typeof first === 'object' && first.channelId) ||
        (typeof first === 'string' ? first : null);
      if (channelId && this.keyring.getChannel(channelId).enabled) {
        const ok = await confirm({
          title: '⚠️ Pièce jointe NON chiffrée',
          body:
            'Le chiffrement PGP est activé dans ce salon, mais les fichiers ' +
            'et le texte qui les accompagne (légende) partent EN CLAIR sur ' +
            'les serveurs de Discord — le plugin ne chiffre que les messages texte. ' +
            'Envoyer quand même ?',
          confirmText: 'Envoyer non chiffré',
          danger: true,
        });
        if (!ok) {
          this.ctx.toast('envoi de la pièce jointe annulé', 'info');
          return;
        }
      }
    } catch (e) {
      // En cas de doute (structure d'arguments inattendue), ne pas bloquer
      // l'utilisateur : on laisse passer l'upload.
      console.error(`[${PLUGIN_NAME}]`, e);
    }
    return original.apply(thisObj, args);
  }

  // ---- Déverrouillage ------------------------------------------------------

  async ensureUnlocked(reason) {
    const identity = this.keyring.getIdentity();
    if (!identity) throw new Error('Aucune identité PGP configurée');
    if (this.session.isUnlocked()) return this.session.getKey();

    const timeout = this.keyring.getSettings().passphraseTimeoutMin;

    // Clé sans phrase secrète : déverrouillage direct.
    if (!identity.hasPassphrase) {
      const key = await pgp.unlockPrivateKey(identity.privateKeyArmored);
      this.session.setKey(key, timeout);
      this.receiver.onUnlocked();
      return key;
    }

    // Une seule invite à la fois, partagée entre tous les appelants.
    if (!this._unlockInFlight) {
      this._unlockInFlight = (async () => {
        try {
          for (let attempt = 0; attempt < 3; attempt++) {
            const passphrase = await promptText({
              title: 'DiscordPGP — déverrouiller la clé privée',
              label: reason || 'Phrase secrète de votre clé privée :',
            });
            if (passphrase === null) throw new Error('Déverrouillage annulé');
            try {
              const key = await pgp.unlockPrivateKey(identity.privateKeyArmored, passphrase);
              this.session.setKey(key, timeout);
              return key;
            } catch (e) {
              this.ctx.toast('phrase secrète incorrecte', 'error');
            }
          }
          throw new Error('Trop de tentatives de déverrouillage');
        } finally {
          this._unlockInFlight = null;
        }
      })();
    }
    const key = await this._unlockInFlight;
    this.receiver.onUnlocked();
    return key;
  }
};
