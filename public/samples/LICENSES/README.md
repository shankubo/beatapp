# Licences des samples audio

## Regle

Seule la licence **CC0-1.0** (Creative Commons Zero, dedicace au domaine public)
est acceptee pour les fichiers audio livres avec l'application.

« Royalty-free » **n'est pas une licence** : c'est un terme marketing qui ne
confere aucun droit. Un fichier presente comme « gratuit » ou « libre de droits »
sans identifiant de licence explicite est refuse.

## Procedure pour ajouter un son

1. Verifier que la page source indique explicitement CC0 / domaine public.
2. Enregistrer dans ce dossier :
   - le texte de la licence, ou l'URL exacte de la page qui l'enonce ;
   - le nom de l'auteur, s'il est indique.
3. Ajouter une entree dans `../manifest.json` :

```json
{
  "id": "loop-nom-court",
  "i18nKey": "pack.nomCourt",
  "bpm": 120,
  "file": "audio/loop-nom-court.mp3",
  "spdx": "CC0-1.0",
  "author": "Nom de l'auteur",
  "sourceUrl": "https://…",
  "downloadedAt": "2026-07-25"
}
```

4. Ajouter les traductions du nom et de la description dans
   `src/i18n/locales/*/samples.json`, sous la cle `pack.*`.

## Etat actuel

Aucun fichier audio externe n'est livre. La bibliotheque repose sur les
**boucles generees par synthese** (`src/features/samples/sampleGen.ts`), qui ne
posent aucune question de licence : elles sont produites par le code de
l'application, leur BPM est connu exactement, et elles ne pesent rien dans le
telechargement de la PWA.

Sources fiables pour completer le pack, le cas echeant :

- Kenney (packs audio CC0) — https://kenney.nl/assets
- Freesound, avec le filtre de licence CC0 — https://freesound.org
- Chosic, section domaine public — https://www.chosic.com/free-music/all/
