'use strict';

// Couche crypto pure (aucune dépendance à Discord/BetterDiscord) : testable
// en Node avec `npm test`.

const openpgp = require('openpgp');
const { ARMOR_MESSAGE_RE, ARMOR_PUBKEY_RE, ARMOR_PRIVKEY_RE } = require('./constants');

/** Génère une identité PGP (ECC ed25519/curve25519, compatible GnuPG >= 2.2). */
async function generateIdentity({ name, email, passphrase }) {
  const userIDs = [{ name: (name || 'Utilisateur Discord').trim(), email: (email || '').trim() || undefined }];
  const options = { userIDs, format: 'armored' };
  if (passphrase) options.passphrase = passphrase;
  const { privateKey, publicKey } = await openpgp.generateKey(options);
  const info = await keyInfo(publicKey);
  return {
    privateKeyArmored: privateKey,
    publicKeyArmored: publicKey,
    fingerprint: info.fingerprint,
    userIDs: info.userIDs,
    createdAt: Date.now(),
    hasPassphrase: Boolean(passphrase),
  };
}

/** Lit une clé publique armurée et renvoie ses métadonnées. */
async function keyInfo(armoredKey) {
  const key = await openpgp.readKey({ armoredKey });
  const algo = key.getAlgorithmInfo();
  return {
    fingerprint: key.getFingerprint().toUpperCase(),
    userIDs: key.getUserIDs(),
    created: key.getCreationTime(),
    algorithm: algo.curve || algo.algorithm,
    isPrivate: key.isPrivate(),
  };
}

/** Importe une clé privée armurée (ex: export GnuPG) comme identité. */
async function importIdentity(armoredKey) {
  const priv = await openpgp.readPrivateKey({ armoredKey });
  const pub = priv.toPublic();
  return {
    privateKeyArmored: priv.armor(),
    publicKeyArmored: pub.armor(),
    fingerprint: priv.getFingerprint().toUpperCase(),
    userIDs: priv.getUserIDs(),
    createdAt: Date.now(),
    hasPassphrase: !priv.isDecrypted(),
  };
}

/**
 * Déverrouille une clé privée armurée. Si la clé n'est pas protégée par
 * phrase secrète, elle est renvoyée telle quelle.
 */
async function unlockPrivateKey(armoredKey, passphrase) {
  const priv = await openpgp.readPrivateKey({ armoredKey });
  if (priv.isDecrypted()) return priv;
  return openpgp.decryptKey({ privateKey: priv, passphrase: passphrase || '' });
}

/**
 * Chiffre `text` pour toutes les clés publiques armurées données, signé avec
 * `signingKey` (objet clé privée déverrouillée, optionnel).
 */
async function encryptText(text, recipientArmoredKeys, signingKey) {
  if (!recipientArmoredKeys || recipientArmoredKeys.length === 0) {
    throw new Error('Aucun destinataire');
  }
  const encryptionKeys = await Promise.all(
    recipientArmoredKeys.map((armoredKey) => openpgp.readKey({ armoredKey }))
  );
  const message = await openpgp.createMessage({ text });
  return openpgp.encrypt({
    message,
    encryptionKeys,
    signingKeys: signingKey || undefined,
  });
}

/**
 * Déchiffre un message armuré avec la clé privée déverrouillée.
 * `verificationArmoredKeys` sert à vérifier la signature éventuelle.
 *
 * Renvoie { text, signature: { status, keyID } } où status vaut :
 *  - 'valid'   : signature vérifiée par une des clés fournies
 *  - 'invalid' : la clé du signataire est connue mais la signature est fausse
 *  - 'unknown' : signé, mais par une clé qu'on ne possède pas
 *  - 'none'    : message non signé
 */
async function decryptText(armoredMessage, privateKey, verificationArmoredKeys) {
  const message = await openpgp.readMessage({ armoredMessage });
  const verificationKeys = [];
  for (const armoredKey of verificationArmoredKeys || []) {
    try {
      verificationKeys.push(await openpgp.readKey({ armoredKey }));
    } catch (e) {
      // clé de contact corrompue : on l'ignore pour ne pas bloquer le déchiffrement
    }
  }
  const result = await openpgp.decrypt({
    message,
    decryptionKeys: privateKey,
    verificationKeys: verificationKeys.length ? verificationKeys : undefined,
  });

  const signature = { status: 'none', keyID: null };
  if (result.signatures && result.signatures.length > 0) {
    const sig = result.signatures[0];
    signature.keyID = sig.keyID.toHex().toUpperCase();
    const signerKnown = verificationKeys.some((key) =>
      key.getKeys().some((k) => k.getKeyID().equals(sig.keyID))
    );
    try {
      await sig.verified;
      signature.status = 'valid';
    } catch (e) {
      signature.status = signerKnown ? 'invalid' : 'unknown';
    }
  }
  return { text: result.data, signature };
}

/** Extrait les blocs armurés d'un texte (message et/ou clé publique). */
function extractBlocks(text) {
  if (typeof text !== 'string') return { message: null, publicKey: null, privateKey: null };
  const message = text.match(ARMOR_MESSAGE_RE);
  const publicKey = text.match(ARMOR_PUBKEY_RE);
  const privateKey = text.match(ARMOR_PRIVKEY_RE);
  return {
    message: message ? message[0] : null,
    publicKey: publicKey ? publicKey[0] : null,
    privateKey: privateKey ? privateKey[0] : null,
  };
}

/** Formate une empreinte en groupes de 4 : "AAAA BBBB ...". */
function formatFingerprint(fingerprint) {
  if (!fingerprint) return '';
  return fingerprint.toUpperCase().replace(/(.{4})(?=.)/g, '$1 ');
}

module.exports = {
  generateIdentity,
  importIdentity,
  keyInfo,
  unlockPrivateKey,
  encryptText,
  decryptText,
  extractBlocks,
  formatFingerprint,
};
