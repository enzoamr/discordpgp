// Bundle le plugin en un seul fichier dist/DiscordPGP.plugin.js
// (OpenPGP.js inclus), prêt à déposer dans le dossier plugins de
// BetterDiscord.

import * as esbuild from 'esbuild';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

const meta = `/**
 * @name DiscordPGP
 * @author enzoamr
 * @description Chiffrement PGP de bout en bout pour Discord Desktop : messages chiffrés/signés avec OpenPGP.js, gestion des clés et des contacts, intégration GnuPG. Tapez .pgp help dans un salon.
 * @version ${pkg.version}
 * @website https://github.com/enzoamr/discordpgp
 * @source https://github.com/enzoamr/discordpgp
 * @updateUrl https://raw.githubusercontent.com/enzoamr/discordpgp/main/dist/DiscordPGP.plugin.js
 */
`;

const watch = process.argv.includes('--watch');

const options = {
  entryPoints: ['src/index.js'],
  bundle: true,
  outfile: 'dist/DiscordPGP.plugin.js',
  format: 'cjs',
  platform: 'browser',
  target: ['chrome128'],
  banner: { js: meta },
  legalComments: 'none',
  minify: false,
  logLevel: 'info',
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('watching…');
} else {
  await esbuild.build(options);
}
