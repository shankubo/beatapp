# Beatapp

PWA mobile-first pour créer des reels Instagram / WhatsApp calés sur le rythme.
Tout se passe dans le navigateur : aucun compte, aucun envoi vers un serveur.

## Démarrer

```bash
npm install
npm run dev            # http://localhost:5173
npm run dev:lan        # accessible depuis un téléphone sur le réseau local
```

## Commandes

| Commande | Rôle |
| --- | --- |
| `npm run build` | Vérification de types puis build de production |
| `npm run lint` | ESLint, avec la règle « aucune chaîne UI en dur » |
| `npm test` | Tests unitaires (domaine, rythme, validation) |
| `npm run test:browser` | Tests dans un vrai Chromium (export MP4, WebCodecs) |
| `npm run i18n:check` | Cohérence des traductions fr / en |

## Ce que fait l'application

- **démarrage en 3 étapes** : sur un projet vide, trois cartes numérotées
  (importer images & vidéo → importer audio → analyser le rythme). La troisième
  détecte le tempo *et* répartit les plans sur les temps, puis ouvre l'éditeur
  sur un montage déjà rythmé ;
- import de photos, vidéos, reels et musiques — depuis un fichier ou un **lien
  direct** ;
- **analyse du rythme** et répartition automatique des plans sur les temps ;
- aperçu 9:16 en direct, timeline tactile (scrub, pinch-zoom, trim aimanté) ;
- panneau **Modifier** : remplacer, dupliquer, déplacer, recadrer, changer la
  durée ou supprimer le plan sélectionné ;
- **édition audio** : bornes de début et de fin, découpage d'un passage,
  forme d'onde zoomable et calage manuel de la musique sur l'image ;
- incrustations de texte (police, taille, couleur libre, position, rotation,
  emoji), **paroles synchronisées** calées sur les temps ;
- transitions, zoom lent, **filtres** (8 looks nommés, dosables) ;
- boucles de batterie intégrées et modèles de montage ;
- **deux bibliothèques** : « Ce reel » (les médias du montage en cours) et
  « Mes médias » (conservés d'un reel à l'autre) ;
- bouton **Nouveau** : repart d'un montage vierge sans toucher à « Mes médias » ;
- export MP4 (H.264 / AAC) partageable directement vers Instagram et WhatsApp.

## Deux limites, dites franchement

**Les liens de réseaux sociaux ne peuvent pas fonctionner.** Instagram, TikTok
et YouTube n'autorisent pas le téléchargement depuis un navigateur (CORS), et
aucun code côté client ne contourne cela — il faudrait un serveur relais, ce qui
contredirait la promesse « rien ne quitte votre appareil ». Ces domaines sont
donc détectés *avant* la requête, pour expliquer quoi faire plutôt que d'échouer
sans raison apparente. L'import par lien direct (`.mp4`, `.jpg`, `.mp3` servi
avec CORS ouvert) fonctionne normalement.

**Il n'y a pas de transcription automatique des paroles.** Aucun moteur de
reconnaissance vocale ne tourne dans un navigateur : les seules options seraient
un service externe (l'audio quitterait l'appareil) ou un modèle WebAssembly de
plusieurs dizaines de mégaoctets, inutilisable sur mobile. Ce qui est automatisé,
c'est le **calage** — la partie réellement pénible : on colle les paroles, et
chaque ligne se pose sur la grille rythmique déjà détectée.

## Architecture

### Couleurs vérifiées, pas choisies à l'œil

L'échelle de gris et les accents sont posés à partir de **ratios de contraste
mesurés**, et l'application est auditée dans le navigateur en parcourant chaque
nœud de texte et chaque bordure. Trois seuils :

| Élément | Minimum | Token |
| --- | --- | --- |
| Texte courant | 4,5:1 | `ink-300` (10,8:1), `ink-400` (7,8:1) |
| Bordure porteuse de sens | 3,0:1 | `ink-600` (3,6:1 sur `ink-900`) |
| État désactivé | 3,0:1 | `opacity-60` |

`ink-700` et en dessous ne servent qu'aux **séparateurs**, jamais à délimiter un
élément cliquable. Sur un fond sombre, deux paliers de gris voisins ne se
distinguent pas (1,1:1) : le relief vient des utilitaires `surface` /
`surface-raised`, qui ajoutent un liseré clair en haut et une ombre portée.

Les accents sont **fonctionnels** — chaque famille désigne une seule chose, ce
qui rend un panneau reconnaissable avant même d'en lire le titre :
`media-400` (bleu, images et vidéos), `audio-400` (violet, son), `beat-400`
(chartreuse, rythme), `ok-400` (vert, étape accomplie), `danger-500` (vermillon,
destructif).

### Une seule voie de rendu

`engine/Compositor.draw(scene, target)` est la **seule** fonction qui dessine des
pixels, et c'est une fonction pure de `(Project, temps)`. L'aperçu et l'export
l'appellent tous les deux ; ils ne diffèrent que par l'horloge qui avance le
temps et par la destination des frames. C'est la garantie structurelle que le
MP4 correspond à ce que l'utilisateur a vu — vérifiée mécaniquement par le test
de parité dans `tests/browser/export.test.ts`.

Toutes les tailles et positions sont exprimées en **unités normalisées** (0..1
de la frame) : un canvas d'aperçu de 390 px et un canvas d'export de 1080 px
produisent donc la même mise en page.

### Une seule voie de montage audio

`domain/audioEdit.scheduleSegments()` est la **seule** fonction qui décide où
tombe chaque morceau d'audio. L'aperçu temps réel et le mixage d'export
l'appellent tous les deux : le montage entendu est donc, par construction, celui
qui sera encodé. C'est le pendant audio de la règle du compositeur unique, et
c'est vérifié par `tests/browser/audioEdit.test.ts`, qui mesure quelle seconde de
la source est réellement audible après une coupe.

Corollaire non évident : deux segments **jointifs** ne doivent jamais être
fusionnés (seuls les segments qui se *chevauchent* le sont). Une coupe produit
par construction deux morceaux adjacents ; les fusionner l'annulerait
silencieusement — c'est un bug que les tests ont attrapé.

### Deux bibliothèques, un seul stockage de blobs

Le magasin `library` (IndexedDB v2) ne contient que des **métadonnées**. Les
blobs restent dans `mediaStore`, partagés : un média présent à la fois dans le
montage et dans « Mes médias » n'occupe l'espace qu'une seule fois.

Le point délicat est le ramasse-miettes. `referencedMediaKeys()` fusionne les
clés des projets **et** celles de la bibliothèque : sans cette fusion, « Nouveau
reel » supprimerait les blobs de « Mes médias », qu'aucun projet ne référence
plus — c'est-à-dire exactement ce que la bibliothèque doit empêcher. La
convention `null` = « liste inconnue, ne rien supprimer » s'applique aux deux
sources.

### Horloge

Le temps de lecture dérive de `AudioContext.currentTime`, jamais de
`performance.now()` ni d'un cumul de deltas `requestAnimationFrame`. L'audio est
planifié une seule fois par lecture ou par seek. Sans cela, l'image et le son
dérivent, et quelques dizaines de millisecondes suffisent à ce qu'un montage
calé sur le rythme paraisse décalé à la fin.

### Export déterministe

Le rendu se fait frame par frame, sans capture temps réel : un téléphone lent
produit exactement le même fichier, simplement plus lentement. L'`await` sur
`CanvasSource.add()` sert de contre-pression et borne la mémoire.

### Détection de rythme

Flux spectral compressé en log, seuil adaptatif, autocorrélation et filtre en
peigne (`audio/beatDetection.ts`, exécuté dans un worker). Deux points ont été
établis par la mesure et sont conservés par des tests :

- un critère de **netteté** de l'ODF (pic/moyenne) est nécessaire : sans lui,
  la fuite spectrale d'un son tenu fait détecter un rythme inexistant ;
- l'autocorrélation est calculée **au-delà** de la plage de tempo explorée, pour
  que tous les candidats disposent des mêmes harmoniques — sinon le filtre en
  peigne favorise mécaniquement le double du vrai tempo.

### Séparation des états

| Où | Quoi |
| --- | --- |
| `store/useProjectStore` | état persistant, avec annulation/rétablissement |
| `store/usePlaybackStore` | position de lecture (hors historique, jamais persistée) |
| `store/useUiStore` | panneau ouvert, zoom, messages |
| `features/preview/MediaProvider` | objets non sérialisables (ImageBitmap, AudioBuffer) |

Mélanger ces couches ferait entrer la tête de lecture dans l'historique
d'annulation et ferait échouer l'enregistrement automatique.

## Règles du projet

**Mobile-first.** Toute l'interface est conçue pour 390 × 844. La tête de
lecture est fixe au centre et la timeline défile dessous : c'est ce qui rend le
positionnement précis possible d'un seul pouce.

**i18n obligatoire.** Aucune chaîne affichée n'est écrite dans un composant.
Trois garde-fous : la règle ESLint `i18next/no-literal-string`, le typage des
clés (`t('editor:nope')` est une erreur de compilation) et `npm run i18n:check`
qui échoue sur toute clé manquante dans une langue.

**Sécurité par défaut.** Pas de serveur ni de compte. Les fichiers importés sont
traités comme hostiles : validation par magic bytes (jamais `File.type` ni
l'extension), plafonds de taille et de durée appliqués avant tout décodage. Le
texte utilisateur est rendu par `fillText` sur canvas, jamais via un
`foreignObject` SVG. Chaque `createObjectURL` est révoqué par un hook qui en
détient le cycle de vie.

L'import par lien est la seule connexion sortante de l'application, et la CSP le
cadre étroitement : `connect-src 'self' https:` (jamais `*`, donc rien en clair),
`script-src` reste à `'self'` — un fichier téléchargé ne peut en aucun cas être
exécuté —, et la requête part sans identifiants ni référent. Le flux est
descendant : on télécharge un fichier, on n'envoie jamais de données de
l'utilisateur.

## Compatibilité de l'export

L'export utilise WebCodecs : Chrome / Edge, Chrome Android, Safari 26+. La
capacité est sondée pour **chaque résolution** — certains appareils encodent le
720 × 1280 tout en refusant le 1080 × 1920 —, et l'interface ne propose que les
qualités réellement disponibles. Les navigateurs sans WebCodecs reçoivent un
écran expliquant quoi faire.

## Samples audio

La bibliothèque repose sur des **boucles générées par synthèse**
(`features/samples/sampleGen.ts`) : aucun risque de licence, rien à télécharger,
et le BPM exact est connu — ce qui en fait aussi les fixtures des tests de
rythme.

Le pack de sons libres (`public/samples/`) n'accepte que du **CC0-1.0**, avec
source et licence consignées. « Royalty-free » n'est pas une licence et est
refusé ; voir `public/samples/LICENSES/README.md`. Aucun fichier externe n'est
livré à ce stade.
