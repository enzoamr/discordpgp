'use strict';
/* global BdApi */

// Petites boîtes de dialogue réutilisables construites sur
// BdApi.UI.showConfirmationModal (pas de JSX : createElement direct).

function h(...args) {
  return BdApi.React.createElement(...args);
}

const inputStyle = {
  width: '100%',
  marginTop: '8px',
  padding: '10px',
  borderRadius: '4px',
  border: '1px solid var(--background-tertiary, #202225)',
  background: 'var(--input-background, #1e1f22)',
  color: 'var(--text-normal, #dcddde)',
  fontSize: '14px',
  boxSizing: 'border-box',
};

/**
 * Demande une saisie texte (par défaut masquée, pour les phrases secrètes).
 * Résout avec la valeur saisie, ou null si annulé.
 */
function promptText({ title, label, type = 'password', placeholder = '' }) {
  return new Promise((resolve) => {
    let value = '';
    const body = h(
      'div',
      null,
      label ? h('div', { style: { color: 'var(--text-normal, #dcddde)' } }, label) : null,
      h('input', {
        type,
        placeholder,
        autoFocus: true,
        style: inputStyle,
        onChange: (e) => {
          value = e.target.value;
        },
      })
    );
    BdApi.UI.showConfirmationModal(title, body, {
      confirmText: 'Valider',
      cancelText: 'Annuler',
      onConfirm: () => resolve(value),
      onCancel: () => resolve(null),
    });
  });
}

/** Confirmation simple. Résout true/false. */
function confirm({ title, body, confirmText = 'Confirmer', danger = false }) {
  return new Promise((resolve) => {
    BdApi.UI.showConfirmationModal(title, body, {
      confirmText,
      cancelText: 'Annuler',
      danger,
      onConfirm: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}

/** Affiche un texte long (clé armurée…) avec bouton de copie. */
function showArmored({ title, note, armored }) {
  const body = h(
    'div',
    null,
    note ? h('div', { style: { marginBottom: '8px', color: 'var(--text-normal, #dcddde)' } }, note) : null,
    h('textarea', {
      readOnly: true,
      defaultValue: armored,
      style: Object.assign({}, inputStyle, {
        height: '220px',
        fontFamily: 'monospace',
        fontSize: '11px',
        resize: 'vertical',
      }),
      onFocus: (e) => e.target.select(),
    })
  );
  return new Promise((resolve) => {
    BdApi.UI.showConfirmationModal(title, body, {
      confirmText: 'Copier',
      cancelText: 'Fermer',
      onConfirm: () => {
        copyToClipboard(armored);
        resolve(true);
      },
      onCancel: () => resolve(false),
    });
  });
}

function copyToClipboard(text) {
  try {
    if (typeof DiscordNative !== 'undefined' && DiscordNative?.clipboard?.copy) {
      DiscordNative.clipboard.copy(text);
      return true;
    }
  } catch (e) {
    /* fallback ci-dessous */
  }
  try {
    navigator.clipboard.writeText(text);
    return true;
  } catch (e) {
    return false;
  }
}

module.exports = { promptText, confirm, showArmored, copyToClipboard, h, inputStyle };
