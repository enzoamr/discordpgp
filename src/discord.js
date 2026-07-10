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

/** Essaie plusieurs stratégies de recherche, dans l'ordre, jusqu'à un succès. */
function firstOf(strategies) {
  for (const strategy of strategies) {
    try {
      const mod = strategy();
      if (mod) return mod;
    } catch (e) {
      /* stratégie suivante */
    }
  }
  return null;
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

/** Recherche un store Flux par son nom (API BdApi.Webpack.getStore, BD ≥ 1.10). */
function storeByName(name) {
  return BdApi.Webpack.getStore ? BdApi.Webpack.getStore(name) : null;
}

/** Recherche par clés : d'abord parmi les exports directs, puis à l'intérieur
 * des exports (Discord récent expose beaucoup de modules en propriété). */
function moduleByKeys(...keys) {
  return firstOf([
    () => BdApi.Webpack.getModule(byKeys(...keys)),
    () => BdApi.Webpack.getModule(byKeys(...keys), { searchExports: true }),
  ]);
}

const Discord = {
  get Dispatcher() {
    const looksLikeDispatcher = (m) =>
      m &&
      typeof m.dispatch === 'function' &&
      typeof m.subscribe === 'function' &&
      typeof m.unsubscribe === 'function';
    return resolve('Dispatcher', () =>
      firstOf([
        // Export direct (anciennes versions de Discord).
        () => BdApi.Webpack.getModule(looksLikeDispatcher),
        // Propriété d'un export (Discord récent).
        () => BdApi.Webpack.getModule(looksLikeDispatcher, { searchExports: true }),
        // Filet de sécurité : chaque store Flux référence le dispatcher.
        () => {
          const store =
            this.UserStore || this.ChannelStore || this.MessageStore || this.SelectedChannelStore;
          const dispatcher = store && store._dispatcher;
          return looksLikeDispatcher(dispatcher) ? dispatcher : null;
        },
      ])
    );
  },

  get MessageActions() {
    return resolve('MessageActions', () => moduleByKeys('sendMessage', 'editMessage'));
  },

  get MessageStore() {
    return resolve('MessageStore', () =>
      firstOf([
        () => storeByName('MessageStore'),
        () => moduleByKeys('getMessage', 'getMessages'),
      ])
    );
  },

  get ChannelStore() {
    return resolve('ChannelStore', () =>
      firstOf([
        () => storeByName('ChannelStore'),
        () => moduleByKeys('getChannel', 'getDMFromUserId'),
      ])
    );
  },

  get UserStore() {
    return resolve('UserStore', () =>
      firstOf([
        () => storeByName('UserStore'),
        () => moduleByKeys('getCurrentUser', 'getUser'),
      ])
    );
  },

  get SelectedChannelStore() {
    return resolve('SelectedChannelStore', () =>
      firstOf([
        () => storeByName('SelectedChannelStore'),
        () => moduleByKeys('getChannelId', 'getVoiceChannelId'),
      ])
    );
  },

  get UploadManager() {
    return resolve('UploadManager', () => moduleByKeys('uploadFiles'));
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
      UploadManager: Boolean(this.UploadManager),
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
    const message = {
      content,
      tts: false,
      invalidEmojis: [],
      validNonShortcutEmojis: [],
    };
    // Discord moderne attend un 4e argument « options » contenant un nonce
    // (envoi optimiste). L'omettre déclenche l'erreur interne
    // « Cannot read properties of undefined (reading 'nonce') ».
    return actions.sendMessage(channelId, message, undefined, { nonce: this._nonce() });
  },

  /** Nonce d'envoi (snowflake Discord : (ms - époque 2015-01-01) << 22). */
  _nonce() {
    try {
      return String((BigInt(Date.now()) - 1420070400000n) << 22n);
    } catch (e) {
      return String(Date.now());
    }
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
