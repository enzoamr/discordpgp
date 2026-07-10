'use strict';
/* global BdApi */

// Accès aux modules internes de Discord via l'API Webpack de BetterDiscord.
// Chaque module est résolu paresseusement et mis en cache ; si Discord change
// et qu'un module devient introuvable, `health()` permet de le signaler
// proprement au lieu de planter.

const moduleCache = new Map();

function byKeys(...keys) {
  const filters = BdApi.Webpack.Filters;
  const factory = filters.byKeys || filters.byProps; // compat anciennes versions BD
  return factory(...keys);
}

function resolve(name, factory) {
  if (moduleCache.has(name)) return moduleCache.get(name);
  let mod = null;
  try {
    mod = factory() || null;
  } catch (e) {
    mod = null;
  }
  if (mod) moduleCache.set(name, mod);
  return mod;
}

const Discord = {
  get Dispatcher() {
    return resolve('Dispatcher', () =>
      BdApi.Webpack.getModule(
        (m) => m && typeof m.dispatch === 'function' && typeof m.subscribe === 'function'
      )
    );
  },

  get MessageActions() {
    return resolve('MessageActions', () =>
      BdApi.Webpack.getModule(byKeys('sendMessage', 'editMessage'))
    );
  },

  get MessageStore() {
    return resolve('MessageStore', () =>
      BdApi.Webpack.getModule(byKeys('getMessage', 'getMessages'))
    );
  },

  get ChannelStore() {
    return resolve('ChannelStore', () =>
      BdApi.Webpack.getModule(byKeys('getChannel', 'getDMFromUserId'))
    );
  },

  get UserStore() {
    return resolve('UserStore', () =>
      BdApi.Webpack.getModule(byKeys('getCurrentUser', 'getUser'))
    );
  },

  get SelectedChannelStore() {
    return resolve('SelectedChannelStore', () =>
      BdApi.Webpack.getModule(byKeys('getChannelId', 'getVoiceChannelId'))
    );
  },

  /** État de santé des accroches internes — affiché dans les réglages. */
  health() {
    return {
      Dispatcher: Boolean(this.Dispatcher),
      MessageActions: Boolean(this.MessageActions),
      MessageStore: Boolean(this.MessageStore),
      ChannelStore: Boolean(this.ChannelStore),
      UserStore: Boolean(this.UserStore),
      SelectedChannelStore: Boolean(this.SelectedChannelStore),
    };
  },

  /** Id de l'utilisateur courant. */
  currentUserId() {
    try {
      return this.UserStore?.getCurrentUser?.()?.id || null;
    } catch (e) {
      return null;
    }
  },

  /** Nom lisible d'un utilisateur. */
  userLabel(userId) {
    try {
      const user = this.UserStore?.getUser?.(userId);
      return user ? user.globalName || user.username : String(userId);
    } catch (e) {
      return String(userId);
    }
  },

  /** Nom lisible d'un salon (DM, groupe ou salon de serveur). */
  channelLabel(channelId) {
    try {
      const channel = this.ChannelStore?.getChannel?.(channelId);
      if (!channel) return channelId;
      if (channel.type === 1) {
        const uid = (channel.recipients || [])[0];
        return `DM avec ${this.userLabel(uid)}`;
      }
      if (channel.type === 3) {
        return channel.name || `Groupe (${(channel.recipients || []).length + 1})`;
      }
      return `#${channel.name || channelId}`;
    } catch (e) {
      return String(channelId);
    }
  },

  /** Envoie un message texte brut dans un salon. */
  sendRaw(channelId, content) {
    const actions = this.MessageActions;
    if (!actions) throw new Error('Module d\'envoi introuvable');
    return actions.sendMessage(channelId, {
      content,
      tts: false,
      invalidEmojis: [],
      validNonShortcutEmojis: [],
    });
  },

  /** Messages actuellement en cache pour un salon (records du store). */
  storeMessages(channelId) {
    try {
      const collection = this.MessageStore?.getMessages?.(channelId);
      if (!collection) return [];
      if (typeof collection.toArray === 'function') return collection.toArray();
      if (Array.isArray(collection._array)) return collection._array;
      return [];
    } catch (e) {
      return [];
    }
  },
};

module.exports = { Discord };
