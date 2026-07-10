'use strict';

// Intégration avec GnuPG installé sur la machine (optionnelle).
// Utilise child_process via le require Node exposé par BetterDiscord dans le
// renderer Electron. Tout est encapsulé dans des try/catch : si Node n'est
// pas accessible, la détection renvoie simplement { available: false }.

function nodeRequire(moduleName) {
  try {
    const req =
      (typeof window !== 'undefined' && window.require) ||
      (typeof global !== 'undefined' && global.require) ||
      null;
    return req ? req(moduleName) : null;
  } catch (e) {
    return null;
  }
}

const GPG_CANDIDATES = [
  'gpg',
  'gpg2',
  'C:\\Program Files (x86)\\GnuPG\\bin\\gpg.exe',
  'C:\\Program Files\\GnuPG\\bin\\gpg.exe',
  '/usr/local/bin/gpg',
  '/opt/homebrew/bin/gpg',
];

let cachedBinary = null;

function execGpg(args, { input, timeout = 20000 } = {}) {
  const cp = nodeRequire('child_process');
  if (!cp) return Promise.reject(new Error('API Node indisponible dans ce client'));
  const binary = cachedBinary || 'gpg';
  return new Promise((resolve, reject) => {
    const child = cp.execFile(
      binary,
      args,
      { timeout, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          error.stderr = stderr;
          reject(error);
        } else {
          resolve({ stdout, stderr });
        }
      }
    );
    if (input != null && child.stdin) {
      child.stdin.write(input);
      child.stdin.end();
    }
  });
}

/** Détecte GnuPG. Renvoie { available, version, binary } (mis en cache). */
async function detect() {
  const cp = nodeRequire('child_process');
  if (!cp) return { available: false, reason: 'API Node indisponible dans ce client' };
  for (const candidate of GPG_CANDIDATES) {
    try {
      const { stdout } = await new Promise((resolve, reject) => {
        cp.execFile(
          candidate,
          ['--version'],
          { timeout: 8000, windowsHide: true },
          (error, stdout, stderr) => (error ? reject(error) : resolve({ stdout, stderr }))
        );
      });
      const firstLine = String(stdout).split('\n')[0].trim();
      cachedBinary = candidate;
      return { available: true, version: firstLine, binary: candidate };
    } catch (e) {
      // essaie le candidat suivant
    }
  }
  return { available: false, reason: 'gpg introuvable dans le PATH' };
}

/** Liste les clés publiques du trousseau GnuPG : [{ fingerprint, uids }]. */
async function listPublicKeys() {
  const { stdout } = await execGpg(['--batch', '--with-colons', '--list-keys']);
  const keys = [];
  let current = null;
  for (const line of String(stdout).split('\n')) {
    const fields = line.split(':');
    if (fields[0] === 'pub') {
      current = { fingerprint: null, uids: [] };
      keys.push(current);
    } else if (fields[0] === 'fpr' && current && !current.fingerprint) {
      current.fingerprint = fields[9];
    } else if (fields[0] === 'uid' && current) {
      current.uids.push(fields[9]);
    }
  }
  return keys.filter((k) => k.fingerprint);
}

/** Exporte une clé publique armurée depuis GnuPG (query = email, id, fpr...). */
async function exportPublicKey(query) {
  const { stdout } = await execGpg(['--batch', '--armor', '--export', query]);
  if (!stdout || !stdout.includes('BEGIN PGP PUBLIC KEY BLOCK')) {
    throw new Error(`Aucune clé publique GnuPG ne correspond à « ${query} »`);
  }
  return stdout;
}

/**
 * Exporte une clé SECRÈTE armurée depuis GnuPG. GnuPG affichera son propre
 * dialogue pinentry pour autoriser l'export ; délai long en conséquence.
 */
async function exportSecretKey(query) {
  const { stdout } = await execGpg(['--armor', '--export-secret-keys', query], {
    timeout: 120000,
  });
  if (!stdout || !stdout.includes('BEGIN PGP PRIVATE KEY BLOCK')) {
    throw new Error(`Aucune clé secrète GnuPG ne correspond à « ${query} » (export refusé ?)`);
  }
  return stdout;
}

/** Importe une clé armurée (publique) dans le trousseau GnuPG. */
async function importArmored(armored) {
  const { stderr } = await execGpg(['--batch', '--import'], { input: armored });
  return stderr; // gpg écrit le résumé d'import sur stderr
}

module.exports = { detect, listPublicKeys, exportPublicKey, exportSecretKey, importArmored };
