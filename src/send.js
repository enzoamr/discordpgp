'use strict';

// Chiffrement des messages sortants : résout les destinataires du salon,
// chiffre pour toutes leurs clés + la nôtre (pour relire nos propres
// messages), signe avec notre clé privée.

const pgp = require('./pgp');
const { UserError } = require('./errors');

async function encryptOutgoing(ctx, channelId, content) {
  const { keyring, discord } = ctx;
  const identity = keyring.getIdentity();
  if (!identity) {
    throw new UserError('Aucune identité PGP — créez-la dans Réglages → Plugins → DiscordPGP');
  }
  const signingKey = await ctx.ensureUnlocked('Déverrouillez votre clé pour chiffrer ce message');

  const channel = discord.ChannelStore?.getChannel?.(channelId);
  const cfg = keyring.getChannel(channelId);
  const armoredKeys = [];
  const seen = new Set();
  const missing = [];

  const addContactKey = (contact) => {
    if (contact && !seen.has(contact.fingerprint)) {
      seen.add(contact.fingerprint);
      armoredKeys.push(contact.publicKeyArmored);
    }
  };

  // DM (type 1) et groupe privé (type 3) : destinataires implicites.
  if (channel && (channel.type === 1 || channel.type === 3)) {
    for (const userId of channel.recipients || []) {
      const contact = keyring.findContactByDiscordId(userId);
      if (contact) addContactKey(contact);
      else missing.push(discord.userLabel(userId));
    }
  }

  // Destinataires configurés explicitement (salons de serveur, ou en plus).
  for (const fingerprint of cfg.extraRecipients || []) {
    addContactKey(keyring.getContact(fingerprint));
  }

  if (missing.length) {
    throw new UserError(
      `Clé publique manquante pour : ${missing.join(', ')}. ` +
        'Demandez-leur d\'envoyer leur clé (`.pgp key`) puis tapez `.pgp trust`.'
    );
  }
  if (armoredKeys.length === 0) {
    throw new UserError(
      'Aucun destinataire avec clé connue dans ce salon — pour un salon de serveur, ' +
        'choisissez les destinataires dans Réglages → Plugins → DiscordPGP.'
    );
  }

  // Toujours chiffrer aussi pour soi-même.
  armoredKeys.push(identity.publicKeyArmored);

  const armored = await pgp.encryptText(content, armoredKeys, signingKey);
  const limit = keyring.getSettings().charLimit;
  if (armored.length > limit) {
    throw new UserError(
      `Message chiffré trop long (${armored.length}/${limit} caractères) — raccourcissez le texte.`
    );
  }
  return armored;
}

module.exports = { encryptOutgoing };
