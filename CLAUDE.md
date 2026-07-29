# CLAUDE.md — GUIDE D'EXÉCUTION

## Mission

PWA mobile-first pour créer des reels Instagram / WhatsApp **calés sur le rythme**.
Tout se passe dans le navigateur : aucun compte, aucun serveur, aucun envoi de données.

Importer photos / vidéos / reels / audio → analyser le rythme → répartir les plans
sur les temps → ajuster (durées, recadrage, texte, filtres, audio) → exporter en MP4.

## Les trois règles du projet

**1. Mobile-first strict.** Toute UI cible d'abord 390 × 844. La tête de lecture est
fixe au centre, la timeline défile dessous : c'est ce qui rend le positionnement
précis possible d'un seul pouce. Cible tactile ≥ 44 px (`min-h-11`).

**2. i18n obligatoire.** Aucune chaîne affichée n'est écrite dans un composant.
Trois garde-fous : ESLint `i18next/no-literal-string` (mode `jsx-text-only`,
`should-validate-template`), le typage des clés via `CustomTypeOptions` — une clé
absente est une **erreur de compilation** — et `npm run i18n:check` qui échoue sur
toute clé manquante en fr **ou** en. Namespaces : `common`, `editor`, `errors`,
`export`, `samples`.

**3. Sécurité par défaut.** Les fichiers importés sont hostiles jusqu'à preuve du
contraire : validation par **magic bytes** (jamais `File.type` ni l'extension),
plafonds de taille et de durée appliqués *avant* tout décodage. Le texte utilisateur
est rendu par `fillText` sur canvas, jamais via un `foreignObject` SVG. Chaque
`createObjectURL` est révoqué par un hook qui en détient le cycle de vie.
CSP : `connect-src 'self' https:` (jamais `*`), `script-src` reste `'self'`.

## Commandes

| Commande | Rôle |
| --- | --- |
| `npm run dev` | Serveur de développement (`dev:lan` pour tester sur téléphone) |
| `npm run typecheck` | `tsc -b` |
| `npm run lint` | ESLint, dont « aucune chaîne UI en dur » |
| `npm test` | Tests unitaires (node) |
| `npm run test:browser` | Tests dans un vrai Chromium (export MP4, WebCodecs, audio) |
| `npm run i18n:check` | Cohérence fr / en |
| `npm run build` | Types puis build de production |

**Portes avant de conclure une tâche** : `typecheck` · `lint` · `test` ·
`i18n:check` · `build`. Les tests navigateur en plus dès que l'export, l'audio ou
le rendu sont touchés.

## Pile

Vite · React 19 · TypeScript 5.9 (`strict`, `noUncheckedIndexedAccess`) ·
Tailwind v4 (thème en CSS via `@theme`, **pas** de `tailwind.config.js`) ·
Zustand 5 + zundo + immer · `idb` (IndexedDB) · **mediabunny** (demux/mux) ·
WebCodecs · `@use-gesture/react` · vitest 4 (projets `unit` et `browser`).

## Invariants d'architecture

Ces cinq points ne se négocient pas : chacun corrige un bug déjà rencontré.

### Une seule voie de rendu

`engine/Compositor.draw(scene, target)` est la **seule** fonction qui dessine des
pixels, et c'est une fonction pure de `(Project, temps)`. L'aperçu et l'export
l'appellent tous les deux ; ils ne diffèrent que par l'horloge et la destination.
C'est la garantie structurelle que le MP4 correspond à ce que l'utilisateur a vu,
vérifiée par le test de parité de `tests/browser/export.test.ts`.

Corollaire : toutes les tailles et positions sont en **unités normalisées** (0..1 de
la frame). Un aperçu de 390 px et un export de 1080 px produisent la même mise en
page. Tout ce qui s'exprime en pixels (le flou d'un filtre, par exemple) doit être
multiplié par la largeur de frame.

### Une seule voie de montage audio

`domain/audioEdit.scheduleSegments()` est la **seule** fonction qui décide où tombe
chaque morceau d'audio. L'aperçu temps réel et le mixage d'export l'appellent tous
les deux. C'est le pendant audio de la règle du compositeur.

Piège attrapé par les tests : deux segments **jointifs** ne doivent jamais être
fusionnés, seuls ceux qui se *chevauchent* le sont. Une coupe produit par
construction deux morceaux adjacents ; les fusionner l'annulerait silencieusement.

### Horloge

Le temps de lecture dérive de `AudioContext.currentTime`, **jamais** de
`performance.now()` ni d'un cumul de deltas `requestAnimationFrame`. L'audio est
planifié une seule fois par lecture ou par seek. Quelques dizaines de millisecondes
de dérive suffisent à faire paraître décalé un montage calé sur le rythme.

L'`AudioContext` est créé hors geste utilisateur, donc `suspended` : tout
gestionnaire de clic qui mènera à du son doit appeler `void audioContext.resume()`.

### Séparation des états

| Où | Quoi |
| --- | --- |
| `store/useProjectStore` | état persistant, avec annulation/rétablissement |
| `store/usePlaybackStore` | position de lecture (hors historique, jamais persistée) |
| `store/useUiStore` | panneau ouvert, zoom, messages |
| `features/preview/MediaProvider` | objets non sérialisables (ImageBitmap, AudioBuffer) |

Mélanger ces couches ferait entrer la tête de lecture dans l'historique d'annulation
et casserait l'enregistrement automatique. Aux fréquences élevées (lecture, scrub),
s'abonner via `useSyncExternalStore` plutôt que re-rendre l'arbre 60 fois par seconde.

`MediaProvider.audioBuffers` est un **état React** : après `await register(...)`, la
Map capturée par la closure courante est encore l'ancienne. Ne jamais enchaîner
automatiquement une opération qui vient d'enregistrer un buffer sur une opération
qui le lit.

### Deux bibliothèques, un seul stockage de blobs

Le magasin `library` (IndexedDB v2) ne contient que des **métadonnées** ; les blobs
restent partagés dans `mediaStore`. `referencedMediaKeys()` fusionne les clés des
projets **et** de la bibliothèque : sans cette fusion, « Nouveau reel » supprimerait
les médias de « Mes médias », exactement ce que la bibliothèque doit empêcher.
Convention : `null` = « liste inconnue, ne rien supprimer ».

## Couleurs : mesurées, pas choisies à l'œil

Le thème vit dans `src/index.css` (`@theme`). Les valeurs sont posées à partir de
**ratios de contraste mesurés**, et l'application est auditée en parcourant chaque
nœud de texte et chaque bordure dans le navigateur.

| Élément | Minimum | Token |
| --- | --- | --- |
| Texte courant | 4,5:1 | `ink-300` (10,8:1), `ink-400` (7,8:1) |
| Bordure porteuse de sens | 3,0:1 | `ink-600` (3,6:1 sur `ink-900`) |
| État désactivé | 3,0:1 | `opacity-60` |

`ink-700` et en dessous ne servent qu'aux **séparateurs**, jamais à délimiter un
élément cliquable. Sur fond sombre, deux paliers de gris voisins ne se distinguent
pas (1,1:1) : le relief vient des utilitaires `surface` / `surface-raised`.

Les accents sont **fonctionnels** — une famille = une seule chose :
`media-400` (bleu, images et vidéos), `audio-400` (violet, son),
`beat-400` (chartreuse, rythme), `ok-400` (vert, accompli),
`danger-500` (vermillon, destructif).

**Le chartreuse désigne le beat, et rien d'autre.** Sa rareté fait son sens : ne
jamais l'employer pour un bouton ordinaire.

## Détection de rythme

Flux spectral compressé en log, seuil adaptatif, autocorrélation et filtre en peigne
(`audio/beatDetection.ts`, dans un worker). Deux points établis par la mesure et
conservés par des tests :

- un critère de **netteté** de l'ODF (pic/moyenne) est nécessaire : sans lui, la
  fuite spectrale d'un son tenu fait détecter un rythme inexistant ;
- l'autocorrélation est calculée **au-delà** de la plage de tempo explorée, pour que
  tous les candidats aient les mêmes harmoniques — sinon le filtre en peigne favorise
  mécaniquement le double du vrai tempo.

Le biais perceptuel est une **gaussienne en log-tempo**, jamais un palier. Élargir la
plage à 50–210 BPM avec un simple palier ×1,15 cassait tout : 174 BPM était lu 58, et
90 lu 45. Doubler un tempo est la même opération perceptive qu'on parte de 60 ou de
150, donc la pénalité doit être progressive et exprimée en octaves.

### Cinq critères de calage

`BeatMap.beats` est une **grille de période constante**, volontairement sans trou pour
qu'on puisse aimanter partout — y compris dans un silence. Elle ne peut donc jamais
rendre un rythme qui respire. `features.onsets` est l'inverse : les attaques réelles,
avec leurs écarts vrais. C'est ce que demande quelqu'un qui pointe des traits
irréguliers sur la forme d'onde.

Les impulsions sont retenues par force **décroissante** et non chronologiquement :
dans une rafale, on veut l'impact principal, pas celui qui arrive en premier. Plancher
perceptif de 0,25 s, distinct des 93 ms de la détection — un plan de trois frames est
un clignotement, pas une image.

Les autres critères (`dynamics`, `sections`, `timbre`) partagent **une seule STFT** et
sont calculés **avant** le test « pas de rythme » : une nappe ambiante n'a pas de tempo
exploitable mais garde une dynamique et des sections. Chacun porte sa propre confiance,
qui permet de **griser** un critère que la musique ne porte pas — un bouton actif qui
ne fait rien est pire qu'un bouton grisé.

La piste vidéo **démarre à zéro**, même quand le premier point de grille est plus tard.
Un essai décalant tout le montage a été attrapé par un test navigateur : `videoDuration`
vaut `last.start + last.duration` et suppose cette ancre, si bien que le décalage se
traduisait en **frames noires en tête d'export**. Ce sont les *durées* qui suivent le
rythme, pas la position de départ.

La métrique ternaire (3/4) n'est **pas vérifiable** sur un click track : mesuré trois
fois, l'attaque d'un clic excite la bande grave à chaque temps, et l'ODF compressé en
log est insensible à l'amplitude. `detectBeatsPerBar` existe et fonctionnera sur de la
vraie musique, mais le test verrouille le 4/4 par défaut plutôt que de passer pour une
mauvaise raison.

## Export

Rendu **frame par frame**, jamais de capture temps réel : un téléphone lent produit
exactement le même fichier, simplement plus lentement. L'`await` sur
`CanvasSource.add()` sert de contre-pression et borne la mémoire.
H.264 + AAC-LC, MP4 `fastStart: 'in-memory'`.

Un palier de qualité porte une **hauteur**, jamais une paire de dimensions : la
largeur se déduit du format du projet. `Compositor.draw` met X et Y à l'échelle
*indépendamment*, donc figer les deux étirerait l'image au lieu de l'encadrer. Les
deux côtés sont ramenés à un nombre **pair** — H.264 en 4:2:0 échoue à l'exécution sur
un côté impair, après plusieurs secondes d'encodage.

La capacité WebCodecs est sondée **par dimensions réelles** et non par palier nommé :
un appareil peut accepter 1080 × 1920 et refuser 1920 × 1920. Chrome / Edge,
Chrome Android, Safari 26+.

**Le 4K fonctionne**, contrairement à ce que ce fichier a longtemps affirmé. Mesuré :
`avc1.42E028` (Baseline) est bien refusé en 3840 × 2160, mais `avc1.640033` (High 5.1)
est accepté — et mediabunny sélectionne déjà ce profil derrière la chaîne `'avc'`.
30 frames encodées en 917 ms, plus vite que le temps réel. Le palier n'est proposé
qu'en **paysage** : en 9:16 il donnerait 2160 × 3840, que les réseaux verticaux ne
diffusent pas. Au-delà de 1080 × 1920, Instagram et WhatsApp ré-encodent de toute
façon — d'où un palier 1440 intermédiaire pour les formats verticaux.

## Tests

Deux projets vitest. Le projet **évite délibérément toute bibliothèque de rendu de
composants** : le motif établi est d'extraire la logique pure et de la tester en
unitaire (`domain/`, `features/*/…State.ts`). Ce qui exige un vrai moteur — WebCodecs,
`AudioContext`, IndexedDB, rendu canvas — va dans `tests/browser`, piloté par les
stores et les modules, pas par React.

`fast-check` est disponible pour les invariants (timeline, snapping).

## Deux limites, dites franchement

**Les liens de réseaux sociaux ne peuvent pas fonctionner.** Instagram, TikTok et
YouTube interdisent le téléchargement depuis un navigateur (CORS) ; aucun code
client ne contourne cela — il faudrait un relais serveur, ce qui contredirait la
promesse « rien ne quitte votre appareil ». Ces domaines sont détectés **avant** la
requête pour expliquer quoi faire. L'import par lien direct (`.mp4`, `.jpg`, `.mp3`
servi avec CORS ouvert) fonctionne.

**Pas de transcription automatique des paroles.** Aucun moteur de reconnaissance
vocale ne tourne dans un navigateur sans envoyer l'audio ailleurs ou charger des
dizaines de mégaoctets de WebAssembly. Ce qui est automatisé, c'est le **calage** :
on colle les paroles, chaque ligne se pose sur la grille rythmique détectée.

## Samples audio

Boucles **générées par synthèse** (`features/samples/sampleGen.ts`) : aucun risque de
licence, rien à télécharger, BPM exact connu — ce qui en fait aussi les fixtures des
tests de rythme. Le pack `public/samples/` n'accepte que du **CC0-1.0**, source et
licence consignées ; « royalty-free » n'est pas une licence et est refusé.

## Réglages : trois portées, à ne pas confondre

Un réglage vit à un seul endroit, et l'endroit décide de sa durée de vie.

| Où | Portée | Exemples |
| --- | --- | --- |
| `Project` | un montage, annulable, enregistré | `frame`, `background`, `snapping` |
| `usePreferencesStore` | l'appareil, persisté, hors historique | préférences d'import, format de départ |
| `useUiStore` | la session, volatil | panneau ouvert, zoom, plein écran |

Piège corrigé : `createEmptyProject` **codait le format en dur**, si bien que
« Nouveau reel » ramenait le projet en 9:16 quels que soient les réglages. Un choix
durable (format, fond) doit être écrit **dans les deux** couches — appliqué au projet
courant *et* mémorisé comme point de départ du suivant. Les deux chemins de création
(`newProject` et le premier lancement dans `App.tsx`) doivent lire la préférence.

La relecture de `localStorage` est **défensive** : son contenu se modifie à la main,
donc les dimensions repassent par `clampFrameSide` à la lecture, pas seulement à
l'écriture.

## Cadrage automatique à l'import

`applyImportPreferences()` (domaine pur) applique les préférences dans un ordre qui
n'est pas négociable : **redresser → cadrer → zoomer → recentrer**. Recentrer avant de
zoomer décalerait vers une zone que le zoom ramènerait ensuite dans le cadre.

Deux mesures conservées par des tests :

- une image **carrée n'est jamais redressée** — elle ne contredit aucune orientation ;
- le recentrage n'agit **que sur l'axe qui déborde**. Une photo 2:3 posée en `cover`
  dans un cadre 9:16 est dessinée en 1280 × 1920 : elle déborde de 200 px en largeur
  et de **zéro** en hauteur, donc un sujet situé en haut ne peut pas être remonté.
  Ce n'est pas un défaut du calcul, c'est la géométrie.

**Pas de détection de visage.** Mesuré dans Chromium : `FaceDetector` n'existe pas, et
n'a jamais été livré sans drapeau. Les deux contournements sont refusés par les règles
du projet — un modèle de ~10 Mo (même limite que la transcription) ou un service
distant. `engine/salience.ts` centre donc sur la zone la plus **détaillée**, ce qui
tombe sur le visage la plupart du temps sans jamais prétendre le reconnaître.

## Rotation d'un clip

Le modèle ne stocke **qu'un** angle (`transform.rotation`) ; l'interface en expose
deux, via `splitRotation` / `joinRotation`. Stocker les deux obligerait à les
additionner partout, avec le risque d'en oublier un.

Piège mesuré : replier modulo 4 **avant** de choisir le quart le plus proche renvoyait
une inclinaison de +6,18 rad pour −0,1 rad — une valeur que le curseur, borné à ±0,35,
ne pouvait pas représenter.

`clampTransform` **normalise** la rotation sans la borner : toutes les orientations
sont légitimes, contrairement à un zoom de 800 %.

## Conventions

- Commentaires et chaînes du dépôt en **français**, sans accents dans les
  commentaires de code (le reste du dépôt suit cette convention).
- Un commentaire explique **pourquoi**, jamais ce que le code dit déjà. Les
  commentaires les plus utiles du dépôt consignent un piège mesuré.
- Le domaine (`src/domain/`) reste **pur** : pas d'accès au store, pas de génération
  d'identifiant à l'intérieur — l'appelant fournit l'id.
