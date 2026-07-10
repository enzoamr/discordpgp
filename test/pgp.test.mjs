// Tests de la couche crypto et du trousseau (sans Discord/BetterDiscord).
// Lancer avec : npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pgp = require('../src/pgp.js');
const { Keyring, MemoryStorage } = require('../src/keyring.js');
const { Session } = require('../src/session.js');
const { isCommand } = require('../src/commands.js');

// Identités générées une fois pour toute la suite (la génération est lente).
const alice = await pgp.generateIdentity({ name: 'Alice', email: 'alice@example.org', passphrase: 'alice-pass' });
const bob = await pgp.generateIdentity({ name: 'Bob', passphrase: '' });

test('génération : structure et empreinte', () => {
  assert.match(alice.fingerprint, /^[0-9A-F]{40}$/);
  assert.ok(alice.publicKeyArmored.includes('BEGIN PGP PUBLIC KEY BLOCK'));
  assert.ok(alice.privateKeyArmored.includes('BEGIN PGP PRIVATE KEY BLOCK'));
  assert.equal(alice.hasPassphrase, true);
  assert.equal(bob.hasPassphrase, false);
  assert.deepEqual(alice.userIDs, ['Alice <alice@example.org>']);
});

test('keyInfo lit une clé publique', async () => {
  const info = await pgp.keyInfo(alice.publicKeyArmored);
  assert.equal(info.fingerprint, alice.fingerprint);
  assert.equal(info.isPrivate, false);
});

test('déverrouillage : bonne et mauvaise phrase secrète', async () => {
  const key = await pgp.unlockPrivateKey(alice.privateKeyArmored, 'alice-pass');
  assert.equal(key.isDecrypted(), true);
  await assert.rejects(() => pgp.unlockPrivateKey(alice.privateKeyArmored, 'mauvaise'));
  // clé sans phrase secrète : utilisable sans mot de passe
  const bobKey = await pgp.unlockPrivateKey(bob.privateKeyArmored);
  assert.equal(bobKey.isDecrypted(), true);
});

test('chiffrement multi-destinataires + signature valide', async () => {
  const aliceKey = await pgp.unlockPrivateKey(alice.privateKeyArmored, 'alice-pass');
  const armored = await pgp.encryptText(
    'salut Bob, message secret 🤫',
    [bob.publicKeyArmored, alice.publicKeyArmored],
    aliceKey
  );
  assert.ok(armored.includes('BEGIN PGP MESSAGE'));

  // Bob déchiffre et vérifie la signature d'Alice.
  const bobKey = await pgp.unlockPrivateKey(bob.privateKeyArmored);
  const forBob = await pgp.decryptText(armored, bobKey, [alice.publicKeyArmored]);
  assert.equal(forBob.text, 'salut Bob, message secret 🤫');
  assert.equal(forBob.signature.status, 'valid');
  assert.ok(alice.fingerprint.endsWith(forBob.signature.keyID));

  // Alice relit son propre message (chiffré aussi pour elle).
  const forAlice = await pgp.decryptText(armored, aliceKey, [alice.publicKeyArmored]);
  assert.equal(forAlice.text, 'salut Bob, message secret 🤫');
});

test('signature d\'une clé inconnue → unknown', async () => {
  const aliceKey = await pgp.unlockPrivateKey(alice.privateKeyArmored, 'alice-pass');
  const armored = await pgp.encryptText('signé par Alice', [bob.publicKeyArmored], aliceKey);
  const bobKey = await pgp.unlockPrivateKey(bob.privateKeyArmored);
  // Bob ne possède pas la clé publique d'Alice.
  const result = await pgp.decryptText(armored, bobKey, []);
  assert.equal(result.signature.status, 'unknown');
});

test('message non signé → none', async () => {
  const armored = await pgp.encryptText('anonyme', [bob.publicKeyArmored], null);
  const bobKey = await pgp.unlockPrivateKey(bob.privateKeyArmored);
  const result = await pgp.decryptText(armored, bobKey, [alice.publicKeyArmored]);
  assert.equal(result.signature.status, 'none');
});

test('déchiffrer un message qui ne nous est pas destiné échoue', async () => {
  const armored = await pgp.encryptText('pour Bob seulement', [bob.publicKeyArmored], null);
  const aliceKey = await pgp.unlockPrivateKey(alice.privateKeyArmored, 'alice-pass');
  await assert.rejects(() => pgp.decryptText(armored, aliceKey, []));
});

test('import d\'une clé privée comme identité', async () => {
  const imported = await pgp.importIdentity(alice.privateKeyArmored);
  assert.equal(imported.fingerprint, alice.fingerprint);
  assert.equal(imported.hasPassphrase, true);
  const importedBob = await pgp.importIdentity(bob.privateKeyArmored);
  assert.equal(importedBob.hasPassphrase, false);
});

test('extractBlocks trouve les blocs, y compris dans du texte/code', async () => {
  // openpgp ajoute un \n final après le pied d'armure : le bloc extrait est
  // la version sans ce \n.
  const armored = (await pgp.encryptText('x', [bob.publicKeyArmored], null)).trim();
  assert.equal(pgp.extractBlocks(`salut\n${armored}\nbye`).message, armored);
  assert.equal(pgp.extractBlocks('```\n' + armored + '\n```').message, armored);
  assert.equal(pgp.extractBlocks(bob.publicKeyArmored).publicKey, bob.publicKeyArmored.trim());
  assert.equal(pgp.extractBlocks('rien ici').message, null);
  assert.equal(pgp.extractBlocks(null).message, null);
});

test('formatFingerprint groupe par 4', () => {
  assert.equal(pgp.formatFingerprint('AAAABBBBCCCC'), 'AAAA BBBB CCCC');
});

test('la taille d\'un message chiffré reste sous la limite Discord', async () => {
  const aliceKey = await pgp.unlockPrivateKey(alice.privateKeyArmored, 'alice-pass');
  const text = 'a'.repeat(500); // message de 500 caractères
  const armored = await pgp.encryptText(text, [bob.publicKeyArmored, alice.publicKeyArmored], aliceKey);
  assert.ok(armored.length < 2000, `armored: ${armored.length} caractères`);
});

test('Keyring : identité, contacts, salons, réglages', () => {
  const storage = new MemoryStorage();
  let ring = new Keyring(storage);

  ring.setIdentity(alice);
  ring.addContact({
    publicKeyArmored: bob.publicKeyArmored,
    fingerprint: bob.fingerprint,
    label: 'Bob',
    discordUserId: '42',
  });
  ring.setChannelEnabled('chan1', true);
  ring.setChannelRecipients('chan1', [bob.fingerprint]);
  ring.updateSettings({ charLimit: 4000 });

  // Relecture depuis le stockage (simule un redémarrage).
  ring = new Keyring(storage);
  assert.equal(ring.getIdentity().fingerprint, alice.fingerprint);
  assert.equal(ring.findContactByDiscordId('42').label, 'Bob');
  assert.equal(ring.getContact(bob.fingerprint.toLowerCase()).label, 'Bob');
  assert.equal(ring.getChannel('chan1').enabled, true);
  assert.deepEqual(ring.getChannel('chan1').extraRecipients, [bob.fingerprint]);
  assert.equal(ring.getSettings().charLimit, 4000);
  assert.equal(ring.getSettings().warnUnsigned, true); // défaut préservé
  assert.equal(ring.allVerificationKeys().length, 2); // Bob + identité

  ring.removeContact(bob.fingerprint);
  assert.equal(ring.findContactByDiscordId('42'), null);
  assert.deepEqual(ring.getChannel('chan1').extraRecipients, []);
});

test('Session : verrouillage manuel et callback', () => {
  const session = new Session();
  let locked = 0;
  session.onLock = () => locked++;
  assert.equal(session.isUnlocked(), false);
  session.setKey({ fake: true }, 0); // 0 = pas d'auto-verrouillage
  assert.equal(session.isUnlocked(), true);
  session.lock();
  assert.equal(session.isUnlocked(), false);
  assert.equal(locked, 1);
});

test('isCommand détecte .pgp sans faux positifs', () => {
  assert.equal(isCommand('.pgp'), true);
  assert.equal(isCommand('.pgp help'), true);
  assert.equal(isCommand('  .PGP ON  '), true);
  assert.equal(isCommand('.pgpx'), false);
  assert.equal(isCommand('salut .pgp'), false);
  assert.equal(isCommand(''), false);
  assert.equal(isCommand(null), false);
});
