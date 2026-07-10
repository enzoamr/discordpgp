'use strict';
/* global BdApi */

// Commandes tapées dans la zone de message. Elles sont interceptées AVANT
// l'envoi : rien de tout cela ne part jamais sur le réseau (sauf `.pgp key`
// qui envoie volontairement votre clé publique).

const { COMMAND_PREFIX } = require('./constants');
const pgp = require('./pgp');
const { confirm, h } = require('./ui/modals');
const { UserError } = require('./errors');

function isCommand(content) {
  if (typeof content !== 'string') return false;
  const t = content.trim().toLowerCase();
  return t === COMMAND_PREFIX || t.startsWith(COMMAND_PREFIX + ' ');
}

async function runCommand(ctx, channelId, content) {
  const parts = content.trim().split(/\s+/);
  const sub = (parts[1] || 'help').toLowerCase();
  switch (sub) {
    case 'on':
      return cmdOn(ctx, channelId);
    case 'off':
      return cmdOff(ctx, channelId);
    case 'key':
      return cmdKey(ctx, channelId);
    case 'trust':
      return cmdTrust(ctx, channelId);
    case 'unlock':
      return cmdUnlock(ctx);
    case 'lock':
      return cmdLock(ctx);
    case 'status':
      return cmdStatus(ctx, channelId);
    case 'help':
    default:
      return cmdHelp(ctx);
  }
}

function requireIdentity(ctx) {
  const identity = ctx.keyring.getIdentity();
  if (!identity) {
    throw new UserError('Aucune identité PGP — créez-la dans Réglages → Plugins → DiscordPGP');
  }
  return identity;
}

function cmdOn(ctx, channelId) {
  requireIdentity(ctx);
  ctx.keyring.setChannelEnabled(channelId, true);
  ctx.toast(`chiffrement ACTIVÉ pour « ${ctx.discord.channelLabel(channelId)} »`, 'success');
}

function cmdOff(ctx, channelId) {
  ctx.keyring.setChannelEnabled(channelId, false);
  ctx.toast(`chiffrement désactivé pour « ${ctx.discord.channelLabel(channelId)} »`, 'info');
}

async function cmdKey(ctx, channelId) {
  const identity = requireIdentity(ctx);
  await ctx.discord.sendRaw(channelId, identity.publicKeyArmored);
  ctx.toast('clé publique envoyée dans le salon', 'success');
}

async function cmdTrust(ctx, channelId) {
  // Cherche le bloc de clé publique le plus récent dans le salon. Le contenu
  // affiché a pu être réécrit par le plugin : on regarde aussi le cache des
  // contenus originaux.
  const messages = ctx.discord.storeMessages(channelId);
  let found = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const original = ctx.receiver.original.get(msg.id);
    const source = (original && original.content) || msg.content || '';
    const blocks = pgp.extractBlocks(source);
    if (blocks.publicKey) {
      found = { armored: blocks.publicKey, authorId: msg.author && msg.author.id };
      break;
    }
  }
  if (!found) {
    throw new UserError('Aucune clé publique PGP trouvée dans les messages récents de ce salon');
  }

  const info = await pgp.keyInfo(found.armored);
  const identity = ctx.keyring.getIdentity();
  if (identity && identity.fingerprint === info.fingerprint) {
    ctx.toast('cette clé est la vôtre 😉', 'info');
    return;
  }

  const who = found.authorId ? ctx.discord.userLabel(found.authorId) : 'inconnu';
  const existing = ctx.keyring.getContact(info.fingerprint);
  const mono = { fontFamily: 'monospace', fontSize: '12px', wordBreak: 'break-all' };
  const body = h(
    'div',
    { style: { color: 'var(--text-normal, #dcddde)', lineHeight: '1.6' } },
    h('div', null, `Envoyée par : ${who}`),
    h('div', null, `Identité de la clé : ${info.userIDs.join(', ') || '(aucune)'}`),
    h('div', null, 'Empreinte :'),
    h('div', { style: mono }, pgp.formatFingerprint(info.fingerprint)),
    h(
      'div',
      { style: { marginTop: '8px', color: 'var(--text-muted, #949ba4)' } },
      'Vérifiez cette empreinte avec votre contact par un AUTRE canal (appel, IRL…) avant de faire confiance.'
    ),
    existing ? h('div', { style: { marginTop: '8px' } }, `⚠️ Déjà importée sous « ${existing.label} » — l'import mettra à jour l'association.`) : null
  );

  const ok = await confirm({
    title: 'Importer cette clé publique ?',
    body,
    confirmText: 'Importer',
  });
  if (!ok) return;

  ctx.keyring.addContact({
    publicKeyArmored: found.armored,
    fingerprint: info.fingerprint,
    label: who !== 'inconnu' ? who : info.userIDs[0] || info.fingerprint.slice(-8),
    discordUserId: found.authorId || null,
  });
  ctx.toast(`clé de ${who} importée ✔`, 'success');
  // Les signatures « clé inconnue » peuvent maintenant être vérifiées.
  ctx.receiver.reprocessChannel(channelId);
}

async function cmdUnlock(ctx) {
  requireIdentity(ctx);
  if (ctx.session.isUnlocked()) {
    ctx.toast('la clé est déjà déverrouillée', 'info');
    return;
  }
  await ctx.ensureUnlocked('Phrase secrète de votre clé privée :');
  ctx.toast('clé déverrouillée 🔓', 'success');
}

function cmdLock(ctx) {
  ctx.session.lock();
  ctx.toast('clé verrouillée 🔒', 'info');
}

function cmdStatus(ctx, channelId) {
  const identity = ctx.keyring.getIdentity();
  const cfg = ctx.keyring.getChannel(channelId);
  const channel = ctx.discord.ChannelStore?.getChannel?.(channelId);
  const gpgStatus = ctx.getGpgStatus();

  const lines = [];
  lines.push(`Salon : ${ctx.discord.channelLabel(channelId)}`);
  lines.push(`Chiffrement ici : ${cfg.enabled ? 'ACTIVÉ 🔐' : 'désactivé'}`);
  if (identity) {
    lines.push(`Identité : ${identity.userIDs.join(', ')}`);
    lines.push(`Empreinte : ${pgp.formatFingerprint(identity.fingerprint)}`);
    lines.push(`Clé privée : ${ctx.session.isUnlocked() ? 'déverrouillée 🔓' : 'verrouillée 🔒'}`);
  } else {
    lines.push('Identité : aucune (à créer dans les réglages)');
  }
  if (channel && (channel.type === 1 || channel.type === 3)) {
    const withKey = [];
    const withoutKey = [];
    for (const userId of channel.recipients || []) {
      const contact = ctx.keyring.findContactByDiscordId(userId);
      (contact ? withKey : withoutKey).push(ctx.discord.userLabel(userId));
    }
    if (withKey.length) lines.push(`Destinataires avec clé : ${withKey.join(', ')}`);
    if (withoutKey.length) lines.push(`⚠️ Sans clé : ${withoutKey.join(', ')}`);
  }
  lines.push(`Contacts : ${ctx.keyring.listContacts().length}`);
  lines.push(
    `GnuPG : ${gpgStatus ? (gpgStatus.available ? gpgStatus.version : 'non détecté') : 'détection en cours…'}`
  );

  const body = h(
    'div',
    { style: { color: 'var(--text-normal, #dcddde)', lineHeight: '1.7' } },
    lines.map((line, i) => h('div', { key: i }, line))
  );
  return confirm({ title: 'DiscordPGP — état', body, confirmText: 'OK' });
}

function cmdHelp(ctx) {
  const rows = [
    ['.pgp on', 'activer le chiffrement dans ce salon'],
    ['.pgp off', 'désactiver le chiffrement dans ce salon'],
    ['.pgp key', 'envoyer votre clé publique ici'],
    ['.pgp trust', 'importer la dernière clé publique vue dans ce salon'],
    ['.pgp unlock', 'déverrouiller votre clé privée'],
    ['.pgp lock', 'verrouiller votre clé privée'],
    ['.pgp status', 'état du chiffrement pour ce salon'],
    ['.pgp help', 'cette aide'],
  ];
  const body = h(
    'div',
    { style: { color: 'var(--text-normal, #dcddde)', lineHeight: '1.8' } },
    rows.map(([cmd, desc], i) =>
      h(
        'div',
        { key: i },
        h('code', { style: { fontFamily: 'monospace', color: 'var(--header-primary, #fff)' } }, cmd),
        ` — ${desc}`
      )
    ),
    h(
      'div',
      { style: { marginTop: '10px', color: 'var(--text-muted, #949ba4)' } },
      'Ces commandes sont interceptées localement : elles ne sont jamais envoyées dans le salon. Gestion complète des clés : Réglages → Plugins → DiscordPGP.'
    )
  );
  return confirm({ title: 'DiscordPGP — commandes', body, confirmText: 'OK' });
}

module.exports = { isCommand, runCommand };
