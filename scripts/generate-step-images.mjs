/**
 * Genere les visuels de l'ecran « Nouveau reel » (illustrations des trois
 * etapes, bandeau promotionnel) et les vignettes des modeles de reels.
 *
 * Sources dans `assets/sources/`, sorties dans `public/steps/`.
 *
 * Les sources vivent HORS de `public/`: tout ce qui s'y trouve est copie tel
 * quel dans `dist/`, et `includeAssets: ['icons/*.png']` du manifeste PWA le
 * pousse en plus dans le precache du service worker. Les originaux pesent
 * ~4,7 Mo que personne n'affiche jamais — chaque visiteur les aurait
 * telecharges pour rien.
 *
 * Usage : node scripts/generate-step-images.mjs
 *
 * Deux operations, chacune pour une raison precise.
 *
 * RECADRAGE — les sources portent un bandeau de titre incruste, en francais
 * (« 1 IMPORTER IMAGES & VIDEO »). Le garder doublonnerait le libelle de la
 * carte, et surtout afficherait du francais aux locales en et ta: une chaine
 * cuite dans un pixel echappe a i18next. Le recadrage ne conserve donc que la
 * partie illustree, celle qui montre l'operation plutot que de la nommer.
 *
 * COMPRESSION — les sources pesent ~1,5 Mo piece, soit 4,7 Mo pour le premier
 * ecran d'une application mobile-first. En WebP a la largeur reellement
 * affichee, l'ensemble tombe a quelques dizaines de kilo-octets.
 */

import sharp from 'sharp';
import { mkdirSync, existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC_DIR = join(ROOT, 'assets', 'sources');
const OUT_DIR = join(ROOT, 'public', 'steps');

/** Dimensions des sources, verifiees a l'execution. */
const SRC_W = 1536;
const SRC_H = 1024;

/**
 * Fenetre conservee pour chaque etape, en fractions de la source.
 *
 * Bornes choisies a la mesure, image par image, et deja au format de la bande
 * affichee (~3,75:1). Le recadrage est fait ICI et non laisse a `object-cover`:
 * centre par le navigateur, il coupait justement ce qui porte le sens — la note
 * de musique de l'etape 2, l'icone de synchronisation de l'etape 3 — pour ne
 * garder que de la barre d'outils.
 */
const STEPS = [
  {
    n: 1,
    // Les medias qui filent vers la timeline, fleche comprise. Le telephone de
    // gauche est ecarte: il porte le bandeau de titre incruste.
    crop: [0.385, 0.13, 1.0, 0.53],
  },
  {
    n: 2,
    // La note de musique a gauche, l'onde qui en part, la piste audio a droite:
    // la bande dit « du son entre dans le montage » en une lecture.
    crop: [0.30, 0.05, 1.0, 0.47],
  },
  {
    n: 3,
    // Les plans en vrac, l'icone de synchronisation, les plans coches: le
    // « avant / apres » de l'operation. Depart a 0,19 et non plus haut: au
    // dessus, le bas du bandeau de titre rentrait dans le cadre.
    crop: [0.02, 0.19, 0.99, 0.45],
  },
];

/**
 * Largeurs generees, pour un `srcset` en 1x / 2x.
 *
 * La carte fait au plus ~358 px de large (390 px moins les marges), donc 360 px
 * couvre le 1x et 720 px le 2x des ecrans denses — au-dela, on paierait des
 * octets qu'aucun telephone n'affiche.
 */
const WIDTHS = [360, 720];

/**
 * Visuel promotionnel du bas de l'ecran, repris tel quel: il est deja sombre et
 * cadre, seul son poids pose probleme. Genere aux memes largeurs que les cartes
 * car il occupe la meme colonne.
 */
const PROMO = { src: 'beatapp_by_shan.png', out: 'promo' };

/**
 * Vignettes des modeles de reels.
 *
 * Les sources (420x206) portent un bandeau de legende incruste du type
 * « DIAPORAMA RYTHME (15s • 8 PHOTOS) ». Il est RECADRE, pour deux raisons:
 *
 *  - il est en francais, donc illisible pour les locales en et ta;
 *  - il redit la duree et le nombre de photos que la carte affiche deja, en
 *    texte traduit ET tire de `templates.ts`. Fige dans un pixel, il mentirait
 *    des la premiere modification d'un `targetDuration`.
 *
 * La hauteur conservee differe par image: la legende ne commence pas a la meme
 * hauteur selon la composition, et un recadrage uniforme amputait « Avant /
 * apres » d'une de ses deux rangees.
 */
const TEMPLATE_THUMBS = [
  { src: 'diaporama.png', out: 'tpl-beat-slideshow', keep: 0.74 },
  { src: 'voyage.png', out: 'tpl-cinematic-travel', keep: 0.78 },
  { src: 'coupe rapides.png', out: 'tpl-quick-cuts', keep: 0.76 },
  { src: 'compte a rebours.png', out: 'tpl-countdown', keep: 0.74 },
  { src: 'avant apres.png', out: 'tpl-before-after', keep: 0.82 },
];

/**
 * Largeurs des vignettes de modeles.
 *
 * La grille fait des colonnes d'au moins 9 rem (144 px); 320 couvre donc le 1x
 * large et 640 le 2x des ecrans denses.
 */
const THUMB_WIDTHS = [320, 640];

async function main() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  let total = 0;

  for (const { n, crop } of STEPS) {
    const source = join(SRC_DIR, `beatapp${n}.png`);
    const meta = await sharp(source).metadata();
    if (meta.width !== SRC_W || meta.height !== SRC_H) {
      throw new Error(
        `beatapp${n}.png fait ${meta.width}x${meta.height}, attendu ${SRC_W}x${SRC_H}. ` +
          `Les fractions de recadrage sont calees sur cette taille.`,
      );
    }

    const [l, t, r, b] = crop;
    const left = Math.round(l * SRC_W);
    const top = Math.round(t * SRC_H);
    const width = Math.round(r * SRC_W) - left;
    const height = Math.round(b * SRC_H) - top;

    for (const w of WIDTHS) {
      const outPath = join(OUT_DIR, `step${n}-${w}.webp`);
      await sharp(source)
        .extract({ left, top, width, height })
        .resize(w)
        // Qualite 72: sur ces illustrations sombres et lisses, l'ecart avec 90
        // est invisible a la taille d'affichage, pour ~2,5x moins d'octets.
        .webp({ quality: 72, effort: 6 })
        .toFile(outPath);

      const kb = statSync(outPath).size / 1024;
      total += kb;
      console.log(`  [OK] steps/step${n}-${w}.webp  ${Math.round(kb)} Ko`);
    }
  }

  let files = STEPS.length * WIDTHS.length;

  for (const w of WIDTHS) {
    const outPath = join(OUT_DIR, `${PROMO.out}-${w}.webp`);
    await sharp(join(SRC_DIR, PROMO.src))
      .resize(w)
      .webp({ quality: 72, effort: 6 })
      .toFile(outPath);

    const kb = statSync(outPath).size / 1024;
    total += kb;
    files++;
    console.log(`  [OK] steps/${PROMO.out}-${w}.webp  ${Math.round(kb)} Ko`);
  }

  for (const thumb of TEMPLATE_THUMBS) {
    const source = join(SRC_DIR, thumb.src);
    const meta = await sharp(source).metadata();
    const height = Math.round(meta.height * thumb.keep);

    for (const w of THUMB_WIDTHS) {
      const outPath = join(OUT_DIR, `${thumb.out}-${w}.webp`);
      await sharp(source)
        .extract({ left: 0, top: 0, width: meta.width, height })
        .resize(w)
        .webp({ quality: 72, effort: 6 })
        .toFile(outPath);

      const kb = statSync(outPath).size / 1024;
      total += kb;
      files++;
      console.log(`  [OK] steps/${thumb.out}-${w}.webp  ${Math.round(kb)} Ko`);
    }
  }

  console.log(`\nTotal : ${Math.round(total)} Ko pour ${files} fichiers.`);
}

main().catch((err) => {
  console.error('Erreur fatale :', err);
  process.exit(1);
});
