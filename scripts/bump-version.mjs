/**
 * Incremente le numero de correctif de `package.json`.
 *
 * Usage : node scripts/bump-version.mjs
 *
 * Appele par `npm run build`, donc a chaque construction: la version affichee
 * dans « A propos » change alors a chaque publication, ce qui permet de dire
 * d'un coup d'oeil si un telephone tourne bien sur la derniere.
 *
 * Seul le CORRECTIF bouge (0.1.0 -> 0.1.1). Le mineur et le majeur restent
 * decides a la main: ils annoncent un changement de fonctionnalites, ce qu'un
 * script ne peut pas juger.
 *
 * Ecrit le fichier seulement si le numero change vraiment, et conserve
 * l'indentation d'origine: un `package.json` reformate a chaque build
 * polluerait tous les diffs.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGE = join(ROOT, 'package.json');

const raw = readFileSync(PACKAGE, 'utf8');
const parsed = JSON.parse(raw);

const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(parsed.version ?? '');
if (!match) {
  console.error(`Version illisible: ${parsed.version}. Attendu « majeur.mineur.correctif ».`);
  process.exit(1);
}

const [, major, minor, patch] = match;
const next = `${major}.${minor}.${Number(patch) + 1}`;

/*
  Remplacement TEXTUEL et non `JSON.stringify` de l'objet entier.

  Reserialiser reformaterait le fichier — indentation, ordre des cles, et
  surtout les cles en double que ce depot contient encore seraient silencieusement
  fusionnees. On ne touche donc que la ligne concernee.
*/
const updated = raw.replace(
  /("version"\s*:\s*)"\d+\.\d+\.\d+"/,
  `$1"${next}"`,
);

if (updated === raw) {
  console.error('Ligne « version » introuvable dans package.json.');
  process.exit(1);
}

writeFileSync(PACKAGE, updated, 'utf8');
console.log(`Version ${parsed.version} -> ${next}`);
