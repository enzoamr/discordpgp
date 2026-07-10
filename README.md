# 🔐 DiscordPGP

**Chiffrement PGP de bout en bout pour Discord Desktop** — plugin [BetterDiscord](https://betterdiscord.app).

Ce qui part réellement sur les serveurs de Discord est un **vrai bloc PGP armuré**
(`-----BEGIN PGP MESSAGE-----`), chiffré et signé avec [OpenPGP.js](https://openpgpjs.org).
Chez vous et vos contacts équipés du plugin, le message s'affiche **déchiffré en clair**,
avec vérification de signature. Discord (et n'importe qui d'autre) ne voit que du PGP.

```
Vous tapez :        salut, ça marche ?
Discord reçoit :    -----BEGIN PGP MESSAGE-----
                    wV4DbgLr1Kp+QLsSAQdAy2jDei+pNQ…
                    -----END PGP MESSAGE-----
Votre contact voit: 🔐 salut, ça marche ?
```

## ✨ Fonctionnalités

- **Chiffrement + signature** de vos messages, **déchiffrement automatique** à la réception
  (y compris vos propres messages : ils sont aussi chiffrés pour votre clé).
- **Gestion de clés complète** : génération d'une paire moderne (ed25519/curve25519,
  compatible GnuPG ≥ 2.2), import/export, sauvegarde de la clé privée, phrase secrète,
  verrouillage automatique.
- **Contacts** : import de clés publiques en un clic (`.pgp trust`), association
  clé ↔ compte Discord, vérification d'empreinte.
- **Vérification de signature** : avertissements visibles si un message est non signé,
  signé par une clé inconnue, ou si la signature est **invalide**.
- **Intégration GnuPG** : détecte si `gpg` est installé sur votre machine, liste ses clés,
  importe une clé du trousseau GnuPG comme contact, exporte votre clé vers GnuPG,
  et peut même utiliser une clé secrète GnuPG existante comme identité.
- **DM, groupes privés et salons de serveur** (destinataires choisis manuellement pour
  les serveurs).
- **Interopérable** : quelqu'un sans le plugin peut copier le bloc PGP et le déchiffrer
  avec `gpg` classique.
- **Sécurité par défaut** : si le chiffrement échoue (clé manquante, verrouillée…),
  le message **n'est pas envoyé** — jamais de repli silencieux vers du texte en clair.

## 📦 Installation

1. Installez [BetterDiscord](https://betterdiscord.app/) sur votre Discord **Desktop**
   (Windows/macOS/Linux — pas la version web).
2. Téléchargez [`dist/DiscordPGP.plugin.js`](https://raw.githubusercontent.com/enzoamr/discordpgp/main/dist/DiscordPGP.plugin.js).
3. Déposez-le dans le dossier plugins :
   - **Windows** : `%AppData%\BetterDiscord\plugins`
   - **macOS** : `~/Library/Application Support/BetterDiscord/plugins`
   - **Linux** : `~/.config/BetterDiscord/plugins`
   
   (ou Réglages → Plugins → « Ouvrir le dossier des plugins »)
4. Activez **DiscordPGP** dans Réglages → Plugins.

## 🚀 Démarrage rapide

1. **Créez votre identité** : Réglages → Plugins → DiscordPGP → « Générer ma paire de clés »
   (choisissez une bonne phrase secrète, puis **sauvegardez votre clé privée** en lieu sûr).
2. Dans un DM avec un contact équipé du plugin, tapez **`.pgp key`** : votre clé publique
   part dans le salon.
3. Votre contact tape **`.pgp trust`** → il vérifie l'empreinte avec vous → il importe votre clé.
   Faites la même chose dans l'autre sens.
4. Chacun tape **`.pgp on`** dans le salon : à partir de là, tout ce que vous envoyez
   est chiffré et signé.

## ⌨️ Commandes

Tapées dans la zone de message, elles sont interceptées localement (jamais envoyées) :

| Commande | Effet |
|---|---|
| `.pgp on` / `.pgp off` | activer / désactiver le chiffrement dans ce salon |
| `.pgp key` | envoyer votre clé publique dans le salon |
| `.pgp trust` | importer la dernière clé publique vue dans le salon |
| `.pgp unlock` / `.pgp lock` | déverrouiller / verrouiller votre clé privée |
| `.pgp status` | état du chiffrement pour ce salon |
| `.pgp help` | aide |

## 🔧 GnuPG (optionnel)

Le plugin embarque sa propre crypto (OpenPGP.js) : **GnuPG n'est pas requis**.
S'il est installé, le panneau de réglages le détecte automatiquement et permet de :

- lister les clés de votre trousseau GnuPG et les **importer comme contacts** ;
- **exporter votre clé publique** DiscordPGP vers GnuPG (pour signer/chiffrer ailleurs) ;
- **utiliser une clé secrète GnuPG existante** comme identité (GnuPG demandera
  l'autorisation via pinentry).

Installation de GnuPG : [gpg4win.org](https://gpg4win.org) (Windows),
`brew install gnupg` (macOS), `apt install gnupg` (Linux).

## ⚠️ À savoir (sécurité & limites)

- **Les métadonnées restent visibles** : Discord sait toujours *qui* parle à *qui*, *quand*,
  et la taille approximative des messages. Seul le **contenu** est chiffré.
- **Pas de confidentialité persistante (forward secrecy)** : c'est du PGP — si votre clé
  privée fuite, tous les anciens messages capturés deviennent lisibles. Pour du chat
  ultra-sensible, un protocole type Signal reste supérieur.
- **Vérifiez les empreintes** hors de Discord (appel, IRL) avant de faire `.pgp trust` :
  c'est votre seule protection contre une attaque de l'homme du milieu.
- **Votre clé privée est stockée localement** (chiffrée par votre phrase secrète si vous
  en avez une) dans les données de plugin BetterDiscord. Sans phrase secrète, toute
  personne ayant accès à votre session PC peut lire vos messages.
- **Limite de taille** : un message chiffré fait ~600 caractères + ~1,4× le texte. Au-delà
  de la limite Discord (2000, ou 4000 avec Nitro — réglable dans les options), l'envoi est
  refusé avec un message d'erreur.
- **Modification de messages** : éditer un message chiffré n'est pas pris en charge
  (l'édition montrerait le bloc armuré).
- **ToS Discord** : comme tout client modifié, BetterDiscord est contraire aux conditions
  d'utilisation de Discord. Risque théorique de sanction du compte — à vous de juger.
- Le déchiffrement ne modifie rien côté serveur : l'affichage en clair est purement local
  et disparaît au redémarrage (les messages sont re-déchiffrés à la volée).

## 🛠️ Développement

```bash
npm install       # dépendances (openpgp, esbuild)
npm test          # tests de la couche crypto (node --test)
npm run build     # produit dist/DiscordPGP.plugin.js
npm run watch     # rebuild à chaque modification
```

Architecture (`src/`) :

| Fichier | Rôle |
|---|---|
| `pgp.js` | couche crypto pure (OpenPGP.js) — testée sous Node |
| `keyring.js` | identité, contacts, salons, réglages (persistance BdApi.Data) |
| `session.js` | clé privée déverrouillée en mémoire + verrouillage auto |
| `send.js` | résolution des destinataires + chiffrement sortant |
| `receive.js` | détection/déchiffrement des blocs PGP entrants, affichage local |
| `commands.js` | commandes `.pgp …` interceptées à l'envoi |
| `gpg.js` | détection et intégration GnuPG (child_process) |
| `discord.js` | accès aux modules internes Discord (Webpack BetterDiscord) |
| `ui/` | panneau de réglages et boîtes de dialogue |

Les accroches internes de Discord changent au fil de ses mises à jour ; le panneau de
réglages inclut une section « État interne » qui signale ce qui est cassé le cas échéant.

## Licence

[MIT](./LICENSE)
