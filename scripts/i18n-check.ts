/**
 * Verification de coherence des traductions.
 *
 * Echoue si une cle presente dans une langue manque dans une autre. Sans ce
 * controle, une chaine oubliee en anglais se traduit par une cle brute affichee
 * a l'utilisateur — un defaut qu'aucune relecture ne rattrape de facon fiable.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const LOCALES_DIR = join(process.cwd(), 'src', 'i18n', 'locales');
const REFERENCE = 'fr';

type Json = { [key: string]: Json | string };

function flatten(value: Json, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [key, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof child === 'string') keys.push(path);
    else keys.push(...flatten(child, path));
  }
  return keys;
}

function loadNamespace(language: string, namespace: string): Json {
  const path = join(LOCALES_DIR, language, `${namespace}.json`);
  return JSON.parse(readFileSync(path, 'utf8')) as Json;
}

/**
 * i18next genere les variantes de pluriel par suffixe (`_one`, `_other`).
 * On les normalise pour comparer des ensembles comparables entre langues, qui
 * n'ont pas les memes categories de pluriel.
 */
function normalize(key: string): string {
  return key.replace(/_(zero|one|two|few|many|other)$/, '');
}

const languages = readdirSync(LOCALES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const namespaces = readdirSync(join(LOCALES_DIR, REFERENCE))
  .filter((file) => file.endsWith('.json'))
  .map((file) => file.replace(/\.json$/, ''));

let failures = 0;

for (const namespace of namespaces) {
  const reference = new Set(flatten(loadNamespace(REFERENCE, namespace)).map(normalize));

  for (const language of languages) {
    if (language === REFERENCE) continue;

    let keys: Set<string>;
    try {
      keys = new Set(flatten(loadNamespace(language, namespace)).map(normalize));
    } catch {
      console.error(`MANQUANT  ${language}/${namespace}.json`);
      failures += 1;
      continue;
    }

    for (const key of reference) {
      if (!keys.has(key)) {
        console.error(`MANQUANT  ${language}/${namespace}: ${key}`);
        failures += 1;
      }
    }
    for (const key of keys) {
      if (!reference.has(key)) {
        console.error(`EN TROP   ${language}/${namespace}: ${key}`);
        failures += 1;
      }
    }
  }
}

if (failures > 0) {
  console.error(`\n${failures} probleme(s) de traduction.`);
  process.exit(1);
}

console.log(
  `Traductions coherentes: ${languages.length} langues x ${namespaces.length} namespaces.`,
);
