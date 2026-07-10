'use strict';

module.exports = {
  PLUGIN_NAME: 'DiscordPGP',
  COMMAND_PREFIX: '.pgp',

  // Blocs armurés OpenPGP (RFC 4880). Les regex matchent aussi un bloc collé
  // dans un bloc de code Markdown, puisqu'on cherche le motif à l'intérieur
  // du contenu brut du message.
  ARMOR_MESSAGE_RE: /-----BEGIN PGP MESSAGE-----[\s\S]+?-----END PGP MESSAGE-----/,
  ARMOR_PUBKEY_RE: /-----BEGIN PGP PUBLIC KEY BLOCK-----[\s\S]+?-----END PGP PUBLIC KEY BLOCK-----/,
  ARMOR_PRIVKEY_RE: /-----BEGIN PGP PRIVATE KEY BLOCK-----[\s\S]+?-----END PGP PRIVATE KEY BLOCK-----/,

  DEFAULT_SETTINGS: {
    // Limite de caractères Discord (2000, ou 4000 avec Nitro).
    charLimit: 2000,
    // Minutes avant verrouillage automatique de la clé privée (0 = jamais).
    passphraseTimeoutMin: 30,
    // Préfixe 🔐 devant les messages déchiffrés.
    decoratePrefix: true,
    // Avertir quand un message déchiffré n'est pas signé.
    warnUnsigned: true,
    // Avertir quand la signature provient d'une clé inconnue.
    warnUnknownKey: true,
    // Afficher aussi une note quand la signature est valide.
    showValidSignature: false,
  },

  // Taille max des caches de messages (éviction FIFO au-delà).
  CACHE_LIMIT: 3000,
};
