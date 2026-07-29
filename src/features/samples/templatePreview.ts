/**
 * Apercu anime d'un modele.
 *
 * Le modele est REELLEMENT execute: on construit un projet jetable, on lui
 * applique `applyTemplate`, puis on le rend par `buildScene` + `Compositor.draw`
 * — la seule voie de rendu du projet. Aucun second chemin n'est cree, donc
 * l'apercu ne peut pas montrer autre chose que ce que le montage produira.
 *
 * Ce qui reste different du reel, et qui doit etre dit a l'utilisateur: les
 * images sont des cartes de synthese, pas ses photos. L'interface l'annonce
 * (`samples:templates.previewHint`).
 */

import { applyTemplate, type Template } from '../../domain/template';
import { createEmptyProject } from '../../domain/project';
import { ripple } from '../../domain/timeline';
import type { Clip, MediaAsset, Project, Seconds } from '../../domain/types';
import type { FrameSource, MediaCache } from '../../engine/MediaCache';

/**
 * Nombre de plans de demonstration.
 *
 * Borne a 6 et non au `suggestedClips` du modele: « Coupes rapides » en attend
 * 16, ce qui multiplierait par trois le cout de generation pour un apercu ou
 * l'oeil ne distingue de toute facon plus les cartes. Six suffisent a faire
 * lire la cadence.
 */
const PREVIEW_CLIPS = 6;

/** Taille des cartes de synthese. Assez pour couvrir un apercu ~180 px. */
const CARD_WIDTH = 360;
const CARD_HEIGHT = 640;

/**
 * Teintes des cartes, en degrade.
 *
 * Volontairement DISTINCTES les unes des autres: c'est le changement de couleur
 * qui rend une coupe visible. Des cartes trop proches donneraient l'impression
 * d'un plan unique, et l'apercu ne dirait plus rien de la cadence.
 */
const CARD_COLORS: readonly [string, string][] = [
  ['#1e3a5f', '#2b6cb0'],
  ['#4a1d4e', '#8b2f7a'],
  ['#1f4034', '#2f855a'],
  ['#5a3410', '#b7791f'],
  ['#3b2660', '#6b46c1'],
  ['#5c1f2e', '#c53030'],
];

/*
  Cache au niveau MODULE: les cartes sont identiques d'un modele a l'autre et
  d'une ouverture a l'autre. Les regenerer a chaque affichage du detail serait
  du travail refait pour un resultat au pixel pres identique.
*/
let cardsPromise: Promise<ImageBitmap[]> | null = null;

/** Cartes de demonstration, generees une seule fois. */
export function previewCards(): Promise<ImageBitmap[]> {
  cardsPromise ??= createCards();
  return cardsPromise;
}

async function createCards(): Promise<ImageBitmap[]> {
  const cards: ImageBitmap[] = [];

  for (let index = 0; index < PREVIEW_CLIPS; index += 1) {
    const canvas = document.createElement('canvas');
    canvas.width = CARD_WIDTH;
    canvas.height = CARD_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) break;

    const [from, to] = CARD_COLORS[index % CARD_COLORS.length]!;
    const gradient = ctx.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT);
    gradient.addColorStop(0, from);
    gradient.addColorStop(1, to);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

    /*
      Le numero est dessine au canvas, pas via i18n: c'est un repere de position
      dans la demonstration, pas de l'interface. Un chiffre arabe se lit de la
      meme facon dans les trois langues du projet.
    */
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = `600 ${Math.round(CARD_HEIGHT * 0.22)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(index + 1), CARD_WIDTH / 2, CARD_HEIGHT / 2);

    cards.push(await createImageBitmap(canvas));
  }

  return cards;
}

/** Media de synthese, avec les dimensions que `assetDimensions` lira. */
function cardAsset(index: number): MediaAsset {
  return {
    id: `preview_${index}`,
    kind: 'image',
    name: `preview_${index}`,
    mimeType: 'image/png',
    bytes: 0,
    storage: { backend: 'idb', key: `preview_${index}` },
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    createdAt: 0,
  };
}

/**
 * Projet de demonstration, modele deja applique.
 *
 * Pas de grille rythmique: l'apercu montre la cadence NOMINALE du modele, celle
 * qu'il produit sur une musique dont le tempo lui correspond. Y injecter une
 * grille fictive donnerait une cadence qui ne serait celle d'aucun montage reel.
 */
export function previewProject(template: Template, cardCount: number): Project {
  const base = createEmptyProject('preview');
  const count = Math.max(1, Math.min(cardCount, PREVIEW_CLIPS));

  const clips: Clip[] = Array.from({ length: count }, (_, index) => ({
    id: `preview_clip_${index}`,
    assetId: `preview_${index}`,
    start: 0,
    duration: template.targetDuration / count,
    fit: 'cover',
    transform: { scale: 1, x: 0, y: 0, rotation: 0 },
    muted: false,
  }));

  const assets: Record<string, MediaAsset> = {};
  for (let index = 0; index < count; index += 1) {
    assets[`preview_${index}`] = cardAsset(index);
  }

  const project: Project = {
    ...base,
    assets,
    videoTrack: { ...base.videoTrack, clips: ripple(clips, base.frame.fps) },
  };

  return applyTemplate(project, template, { grid: [], fps: base.frame.fps });
}

/**
 * Cache trivial adossant les cartes deja decodees.
 *
 * `buildScene` n'attend qu'un `frameAt`: fournir cette implementation minimale
 * evite de toucher au moteur, et garantit que l'apercu emprunte exactement le
 * meme chemin que l'editeur et l'export.
 */
export function previewCache(cards: readonly ImageBitmap[]): MediaCache {
  return {
    frameAt(assetId: string): FrameSource | null {
      const index = Number.parseInt(assetId.replace('preview_', ''), 10);
      const image = Number.isFinite(index) ? cards[index] : undefined;
      if (!image) return null;
      return { image, width: image.width, height: image.height };
    },
    // Les cartes sont partagees et mises en cache au niveau module: les fermer
    // ici les rendrait inutilisables a la prochaine ouverture.
    dispose() {},
  };
}

/** Duree de la boucle d'apercu. */
export function previewDuration(template: Template): Seconds {
  return template.targetDuration;
}
