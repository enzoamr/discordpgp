'use strict';
/* global BdApi */

// Panneau de réglages (Réglages → Plugins → DiscordPGP).
// Construit sans JSX : h() = BdApi.React.createElement.

const pgp = require('../pgp');
const { promptText, confirm, showArmored, copyToClipboard, h, inputStyle } = require('./modals');

const React = () => BdApi.React;

const styles = {
  panel: { color: 'var(--text-normal, #dcddde)', fontSize: '14px', lineHeight: '1.5' },
  section: {
    background: 'var(--background-secondary, #2b2d31)',
    borderRadius: '8px',
    padding: '16px',
    marginBottom: '12px',
  },
  title: {
    color: 'var(--header-primary, #f2f3f5)',
    fontSize: '16px',
    fontWeight: '600',
    marginBottom: '10px',
  },
  muted: { color: 'var(--text-muted, #949ba4)', fontSize: '12px' },
  mono: { fontFamily: 'monospace', fontSize: '12px', wordBreak: 'break-all' },
  row: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '8px',
    padding: '8px 0',
    borderBottom: '1px solid var(--background-modifier-accent, #3f4147)',
  },
};

function Btn({ label, onClick, danger, disabled, small }) {
  return h(
    'button',
    {
      onClick,
      disabled,
      style: {
        background: danger ? 'var(--status-danger, #da373c)' : 'var(--brand-500, #5865f2)',
        color: '#fff',
        border: 'none',
        borderRadius: '4px',
        padding: small ? '4px 10px' : '8px 14px',
        marginRight: '8px',
        marginTop: small ? '0' : '8px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        fontSize: small ? '12px' : '14px',
      },
    },
    label
  );
}

function Field({ label, ...props }) {
  return h(
    'label',
    { style: { display: 'block', marginTop: '8px' } },
    h('div', { style: styles.muted }, label),
    h('input', Object.assign({ style: Object.assign({}, inputStyle, { marginTop: '4px' }) }, props))
  );
}

function Check({ label, checked, onChange }) {
  return h(
    'label',
    { style: { display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px', cursor: 'pointer' } },
    h('input', { type: 'checkbox', checked, onChange: (e) => onChange(e.target.checked) }),
    label
  );
}

function Section({ title, children }) {
  return h('div', { style: styles.section }, h('div', { style: styles.title }, title), children);
}

/** Re-traite le salon ouvert (après création/import d'identité). */
function reprocessCurrent(ctx) {
  try {
    const channelId = ctx.discord.SelectedChannelStore?.getChannelId?.();
    if (channelId && ctx.receiver) ctx.receiver.reprocessChannel(channelId);
  } catch (e) {
    /* noop */
  }
}

// ---- Identité --------------------------------------------------------------

function IdentitySection({ ctx, refresh }) {
  const R = React();
  const identity = ctx.keyring.getIdentity();
  const [name, setName] = R.useState('');
  const [email, setEmail] = R.useState('');
  const [pass, setPass] = R.useState('');
  const [pass2, setPass2] = R.useState('');
  const [importArmor, setImportArmor] = R.useState('');
  const [busy, setBusy] = R.useState(false);

  if (identity) {
    return h(
      Section,
      { title: '🪪 Votre identité PGP' },
      h('div', null, identity.userIDs.join(', ')),
      h('div', { style: Object.assign({}, styles.mono, { marginTop: '4px' }) }, pgp.formatFingerprint(identity.fingerprint)),
      h(
        'div',
        { style: Object.assign({}, styles.muted, { marginTop: '4px' }) },
        identity.hasPassphrase
          ? 'Clé privée protégée par phrase secrète.'
          : '⚠️ Clé privée SANS phrase secrète (stockée telle quelle sur ce PC).'
      ),
      h('div', null,
        h(Btn, {
          label: 'Copier la clé publique',
          onClick: () => {
            copyToClipboard(identity.publicKeyArmored);
            ctx.toast('clé publique copiée', 'success');
          },
        }),
        h(Btn, {
          label: 'Sauvegarder la clé privée',
          onClick: async () => {
            const ok = await confirm({
              title: 'Exporter la clé privée ?',
              body: 'Ne partagez JAMAIS ce bloc. Conservez-le dans un gestionnaire de mots de passe ou sur un support hors-ligne.',
              confirmText: 'Afficher',
              danger: true,
            });
            if (ok) {
              await showArmored({
                title: 'Clé privée (sauvegarde)',
                note: 'Bloc à conserver en lieu sûr — il reste protégé par votre phrase secrète si vous en avez une.',
                armored: identity.privateKeyArmored,
              });
            }
          },
        }),
        ctx.session.isUnlocked()
          ? h(Btn, { label: 'Verrouiller 🔒', onClick: () => { ctx.session.lock(); refresh(); } })
          : null,
        h(Btn, {
          label: 'Supprimer l\'identité',
          danger: true,
          onClick: async () => {
            const ok = await confirm({
              title: 'Supprimer votre identité PGP ?',
              body: 'Sans sauvegarde de la clé privée, TOUS les anciens messages chiffrés deviendront définitivement illisibles.',
              confirmText: 'Supprimer',
              danger: true,
            });
            if (!ok) return;
            const twice = await confirm({
              title: 'Vraiment sûr ?',
              body: 'Dernière chance : avez-vous exporté une sauvegarde ?',
              confirmText: 'Oui, supprimer',
              danger: true,
            });
            if (!twice) return;
            ctx.session.lock();
            ctx.keyring.clearIdentity();
            ctx.toast('identité supprimée', 'info');
            refresh();
          },
        })
      )
    );
  }

  return h(
    Section,
    { title: '🪪 Créer votre identité PGP' },
    h('div', { style: styles.muted }, 'Génère une paire de clés moderne (ed25519/curve25519), compatible GnuPG 2.2+.'),
    h(Field, { label: 'Nom (affiché dans la clé)', type: 'text', value: name, onChange: (e) => setName(e.target.value), placeholder: 'ex : enzo' }),
    h(Field, { label: 'E-mail (optionnel)', type: 'text', value: email, onChange: (e) => setEmail(e.target.value), placeholder: 'ex : enzo@example.org' }),
    h(Field, { label: 'Phrase secrète (fortement recommandée)', type: 'password', value: pass, onChange: (e) => setPass(e.target.value) }),
    h(Field, { label: 'Confirmez la phrase secrète', type: 'password', value: pass2, onChange: (e) => setPass2(e.target.value) }),
    h(Btn, {
      label: busy ? 'Génération…' : 'Générer ma paire de clés',
      disabled: busy,
      onClick: async () => {
        if (pass !== pass2) return ctx.toast('les phrases secrètes ne correspondent pas', 'error');
        if (!pass) {
          const ok = await confirm({
            title: 'Sans phrase secrète ?',
            body: 'Votre clé privée sera stockée sans protection sur ce PC. Toute personne ayant accès à votre session pourra lire vos messages.',
            confirmText: 'Continuer sans',
            danger: true,
          });
          if (!ok) return;
        }
        setBusy(true);
        try {
          const identity = await pgp.generateIdentity({ name, email, passphrase: pass });
          ctx.keyring.setIdentity(identity);
          ctx.toast('identité créée ✔ — envoyez votre clé avec `.pgp key`', 'success');
          reprocessCurrent(ctx);
          refresh();
        } catch (e) {
          ctx.toast(`échec : ${e.message}`, 'error');
        } finally {
          setBusy(false);
        }
      },
    }),
    h('div', { style: { marginTop: '16px', fontWeight: '600' } }, 'Ou importer une clé privée existante'),
    h('textarea', {
      placeholder: '-----BEGIN PGP PRIVATE KEY BLOCK----- …',
      value: importArmor,
      onChange: (e) => setImportArmor(e.target.value),
      style: Object.assign({}, inputStyle, { height: '90px', fontFamily: 'monospace', fontSize: '11px' }),
    }),
    h(Btn, {
      label: 'Importer',
      onClick: async () => {
        try {
          const identity = await pgp.importIdentity(importArmor.trim());
          ctx.keyring.setIdentity(identity);
          ctx.toast('clé privée importée ✔', 'success');
          reprocessCurrent(ctx);
          refresh();
        } catch (e) {
          ctx.toast(`clé invalide : ${e.message}`, 'error');
        }
      },
    })
  );
}

// ---- Contacts ---------------------------------------------------------------

function ContactsSection({ ctx, refresh }) {
  const R = React();
  const [armor, setArmor] = R.useState('');
  const [label, setLabel] = R.useState('');
  const [discordId, setDiscordId] = R.useState('');
  const contacts = ctx.keyring.listContacts();

  return h(
    Section,
    { title: `👥 Contacts (${contacts.length})` },
    contacts.length === 0
      ? h('div', { style: styles.muted }, 'Aucun contact. Le plus simple : votre contact tape `.pgp key` dans un salon, puis vous tapez `.pgp trust`.')
      : contacts.map((contact) =>
          h(
            'div',
            { key: contact.fingerprint, style: styles.row },
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h('div', { style: { fontWeight: '600' } }, contact.label),
              h('div', { style: styles.mono }, pgp.formatFingerprint(contact.fingerprint)),
              h(
                'div',
                { style: styles.muted },
                'ID Discord lié : ',
                h('input', {
                  type: 'text',
                  defaultValue: contact.discordUserId || '',
                  placeholder: 'aucun',
                  style: Object.assign({}, inputStyle, { width: '200px', marginTop: '2px', padding: '4px 6px', fontSize: '12px', display: 'inline-block' }),
                  onBlur: (e) => {
                    ctx.keyring.setContactDiscordId(contact.fingerprint, e.target.value.trim() || null);
                    ctx.toast('association mise à jour', 'success');
                  },
                })
              )
            ),
            h(Btn, {
              label: 'Supprimer',
              danger: true,
              small: true,
              onClick: async () => {
                const ok = await confirm({
                  title: `Supprimer ${contact.label} ?`,
                  body: 'Vous ne pourrez plus chiffrer pour cette personne.',
                  confirmText: 'Supprimer',
                  danger: true,
                });
                if (!ok) return;
                ctx.keyring.removeContact(contact.fingerprint);
                refresh();
              },
            })
          )
        ),
    h('div', { style: { marginTop: '14px', fontWeight: '600' } }, 'Ajouter une clé publique manuellement'),
    h('textarea', {
      placeholder: '-----BEGIN PGP PUBLIC KEY BLOCK----- …',
      value: armor,
      onChange: (e) => setArmor(e.target.value),
      style: Object.assign({}, inputStyle, { height: '80px', fontFamily: 'monospace', fontSize: '11px' }),
    }),
    h('div', { style: { display: 'flex', gap: '8px' } },
      h('input', { type: 'text', placeholder: 'Nom du contact', value: label, onChange: (e) => setLabel(e.target.value), style: Object.assign({}, inputStyle, { flex: 1 }) }),
      h('input', { type: 'text', placeholder: 'ID Discord (optionnel)', value: discordId, onChange: (e) => setDiscordId(e.target.value), style: Object.assign({}, inputStyle, { flex: 1 }) })
    ),
    h(Btn, {
      label: 'Ajouter le contact',
      onClick: async () => {
        try {
          const info = await pgp.keyInfo(armor.trim());
          if (info.isPrivate) return ctx.toast('ceci est une clé PRIVÉE — n\'importez ici que des clés publiques', 'error');
          ctx.keyring.addContact({
            publicKeyArmored: armor.trim(),
            fingerprint: info.fingerprint,
            label: label.trim() || info.userIDs[0] || info.fingerprint.slice(-8),
            discordUserId: discordId.trim() || null,
          });
          ctx.toast('contact ajouté ✔', 'success');
          setArmor(''); setLabel(''); setDiscordId('');
          refresh();
        } catch (e) {
          ctx.toast(`clé invalide : ${e.message}`, 'error');
        }
      },
    }),
    h('div', { style: Object.assign({}, styles.muted, { marginTop: '8px' }) },
      'Astuce : clic droit sur un utilisateur → « Copier l\'identifiant » (mode développeur requis) pour lier sa clé à son compte Discord.')
  );
}

// ---- Salons -----------------------------------------------------------------

function ChannelsSection({ ctx, refresh }) {
  const enabled = ctx.keyring.listEnabledChannels();
  const currentId = ctx.discord.SelectedChannelStore?.getChannelId?.();
  const currentCfg = currentId ? ctx.keyring.getChannel(currentId) : null;
  const contacts = ctx.keyring.listContacts();

  return h(
    Section,
    { title: '💬 Salons chiffrés' },
    currentId
      ? h(
          'div',
          { style: { marginBottom: '10px' } },
          h('div', null, `Salon actuel : ${ctx.discord.channelLabel(currentId)}`),
          h(Btn, {
            label: currentCfg.enabled ? 'Désactiver le chiffrement ici' : 'Activer le chiffrement ici',
            onClick: () => {
              ctx.keyring.setChannelEnabled(currentId, !currentCfg.enabled);
              refresh();
            },
          }),
          contacts.length
            ? h(
                'div',
                { style: { marginTop: '8px' } },
                h('div', { style: styles.muted }, 'Destinataires supplémentaires pour ce salon (obligatoire pour les salons de serveur) :'),
                contacts.map((contact) =>
                  h(Check, {
                    key: contact.fingerprint,
                    label: `${contact.label} (${contact.fingerprint.slice(-8)})`,
                    checked: (currentCfg.extraRecipients || []).includes(contact.fingerprint),
                    onChange: (checked) => {
                      const set = new Set(currentCfg.extraRecipients || []);
                      if (checked) set.add(contact.fingerprint);
                      else set.delete(contact.fingerprint);
                      ctx.keyring.setChannelRecipients(currentId, [...set]);
                      refresh();
                    },
                  })
                )
              )
            : null
        )
      : h('div', { style: styles.muted }, 'Ouvrez un salon pour le configurer ici.'),
    enabled.length
      ? h(
          'div',
          null,
          h('div', { style: { fontWeight: '600', marginTop: '8px' } }, 'Chiffrement activé dans :'),
          enabled.map(({ channelId }) =>
            h(
              'div',
              { key: channelId, style: styles.row },
              h('div', null, ctx.discord.channelLabel(channelId)),
              h(Btn, {
                label: 'Désactiver',
                small: true,
                onClick: () => {
                  ctx.keyring.setChannelEnabled(channelId, false);
                  refresh();
                },
              })
            )
          )
        )
      : h('div', { style: Object.assign({}, styles.muted, { marginTop: '8px' }) }, 'Aucun salon chiffré pour l\'instant — tapez `.pgp on` dans un salon.')
  );
}

// ---- GnuPG ------------------------------------------------------------------

function GpgSection({ ctx, refresh }) {
  const R = React();
  const [status, setStatus] = R.useState(ctx.getGpgStatus());
  const [keys, setKeys] = R.useState(null);
  const [busy, setBusy] = R.useState(false);

  R.useEffect(() => {
    if (!status) {
      ctx.gpg
        .detect()
        .then((s) => {
          ctx.setGpgStatus(s);
          setStatus(s);
        })
        .catch(() => setStatus({ available: false, reason: 'erreur de détection' }));
    }
  }, []);

  const identity = ctx.keyring.getIdentity();

  return h(
    Section,
    { title: '🔧 GnuPG (outil PGP du système)' },
    !status
      ? h('div', { style: styles.muted }, 'Détection en cours…')
      : status.available
        ? h(
            'div',
            null,
            h('div', null, `✅ Détecté : ${status.version}`),
            h('div', null,
              h(Btn, {
                label: busy ? '…' : 'Lister les clés GnuPG',
                disabled: busy,
                onClick: async () => {
                  setBusy(true);
                  try {
                    setKeys(await ctx.gpg.listPublicKeys());
                  } catch (e) {
                    ctx.toast(`gpg : ${e.message}`, 'error');
                  } finally {
                    setBusy(false);
                  }
                },
              }),
              identity
                ? h(Btn, {
                    label: 'Exporter ma clé publique vers GnuPG',
                    onClick: async () => {
                      try {
                        await ctx.gpg.importArmored(identity.publicKeyArmored);
                        ctx.toast('clé ajoutée au trousseau GnuPG ✔', 'success');
                      } catch (e) {
                        ctx.toast(`gpg : ${e.message}`, 'error');
                      }
                    },
                  })
                : null
            ),
            keys
              ? keys.length
                ? keys.map((key) =>
                    h(
                      'div',
                      { key: key.fingerprint, style: styles.row },
                      h(
                        'div',
                        { style: { flex: 1, minWidth: 0 } },
                        h('div', null, key.uids[0] || '(sans identité)'),
                        h('div', { style: styles.mono }, pgp.formatFingerprint(key.fingerprint))
                      ),
                      h(Btn, {
                        label: 'Importer comme contact',
                        small: true,
                        onClick: async () => {
                          try {
                            const armored = await ctx.gpg.exportPublicKey(key.fingerprint);
                            const info = await pgp.keyInfo(armored);
                            ctx.keyring.addContact({
                              publicKeyArmored: armored,
                              fingerprint: info.fingerprint,
                              label: key.uids[0] || info.fingerprint.slice(-8),
                              discordUserId: null,
                            });
                            ctx.toast('contact importé depuis GnuPG ✔ — pensez à lier son ID Discord', 'success');
                            refresh();
                          } catch (e) {
                            ctx.toast(`gpg : ${e.message}`, 'error');
                          }
                        },
                      })
                    )
                  )
                : h('div', { style: styles.muted }, 'Aucune clé publique dans le trousseau GnuPG.')
              : null,
            h('div', { style: { marginTop: '12px', fontWeight: '600' } }, 'Avancé'),
            h(Btn, {
              label: 'Utiliser une clé secrète GnuPG comme identité',
              onClick: async () => {
                const query = await promptText({
                  title: 'Importer depuis GnuPG',
                  label: 'E-mail, nom ou empreinte de la clé secrète :',
                  type: 'text',
                });
                if (!query) return;
                if (identity) {
                  const ok = await confirm({
                    title: 'Remplacer l\'identité actuelle ?',
                    body: 'Sauvegardez d\'abord votre clé actuelle si nécessaire.',
                    confirmText: 'Remplacer',
                    danger: true,
                  });
                  if (!ok) return;
                }
                try {
                  ctx.toast('GnuPG va demander l\'autorisation (pinentry)…', 'info');
                  const armored = await ctx.gpg.exportSecretKey(query);
                  const newIdentity = await pgp.importIdentity(armored);
                  ctx.keyring.setIdentity(newIdentity);
                  ctx.session.lock();
                  ctx.toast('identité importée depuis GnuPG ✔', 'success');
                  reprocessCurrent(ctx);
                  refresh();
                } catch (e) {
                  ctx.toast(`gpg : ${e.message}`, 'error');
                }
              },
            })
          )
        : h(
            'div',
            null,
            h('div', null, `❌ GnuPG non détecté (${status.reason || 'inconnu'}).`),
            h('div', { style: styles.muted },
              'Facultatif : le plugin embarque sa propre crypto (OpenPGP.js). GnuPG permet juste de partager vos clés avec vos autres outils (mail, etc.). Installation : gpg4win.org (Windows), brew install gnupg (macOS), apt install gnupg (Linux).')
          )
  );
}

// ---- Options ----------------------------------------------------------------

function OptionsSection({ ctx, refresh }) {
  const settings = ctx.keyring.getSettings();
  const set = (patch) => {
    ctx.keyring.updateSettings(patch);
    refresh();
  };
  return h(
    Section,
    { title: '⚙️ Options' },
    h(Field, {
      label: 'Limite de caractères Discord (2000, ou 4000 avec Nitro)',
      type: 'number',
      defaultValue: settings.charLimit,
      onBlur: (e) => set({ charLimit: Math.max(500, parseInt(e.target.value, 10) || 2000) }),
    }),
    h(Field, {
      label: 'Verrouillage automatique de la clé (minutes, 0 = jamais)',
      type: 'number',
      defaultValue: settings.passphraseTimeoutMin,
      onBlur: (e) => set({ passphraseTimeoutMin: Math.max(0, parseInt(e.target.value, 10) || 0) }),
    }),
    h(Check, { label: 'Préfixe 🔐 devant les messages déchiffrés', checked: settings.decoratePrefix, onChange: (v) => set({ decoratePrefix: v }) }),
    h(Check, { label: 'Avertir si un message n\'est pas signé', checked: settings.warnUnsigned, onChange: (v) => set({ warnUnsigned: v }) }),
    h(Check, { label: 'Avertir si la signature vient d\'une clé inconnue', checked: settings.warnUnknownKey, onChange: (v) => set({ warnUnknownKey: v }) }),
    h(Check, { label: 'Afficher aussi les signatures valides', checked: settings.showValidSignature, onChange: (v) => set({ showValidSignature: v }) })
  );
}

// ---- Santé ------------------------------------------------------------------

function HealthSection({ ctx }) {
  const health = ctx.discord.health();
  const broken = Object.entries(health).filter(([, ok]) => !ok);
  return h(
    Section,
    { title: '🩺 État interne' },
    broken.length === 0
      ? h('div', null, '✅ Toutes les accroches Discord fonctionnent.')
      : h(
          'div',
          null,
          h('div', null, '⚠️ Modules Discord introuvables (mise à jour de Discord ?) :'),
          broken.map(([name]) => h('div', { key: name, style: styles.mono }, `❌ ${name}`))
        ),
    h('div', { style: Object.assign({}, styles.muted, { marginTop: '6px' }) },
      'Si quelque chose casse après une mise à jour Discord, ouvrez une issue sur github.com/enzoamr/discordpgp.')
  );
}

// ---- Panneau ----------------------------------------------------------------

function SettingsPanel({ ctx }) {
  const R = React();
  const [, bump] = R.useReducer((x) => x + 1, 0);
  const refresh = () => bump();
  return h(
    'div',
    { style: styles.panel },
    h(IdentitySection, { ctx, refresh }),
    h(ContactsSection, { ctx, refresh }),
    h(ChannelsSection, { ctx, refresh }),
    h(GpgSection, { ctx, refresh }),
    h(OptionsSection, { ctx, refresh }),
    h(HealthSection, { ctx })
  );
}

function buildSettingsPanel(ctx) {
  return h(SettingsPanel, { ctx });
}

module.exports = { buildSettingsPanel };
