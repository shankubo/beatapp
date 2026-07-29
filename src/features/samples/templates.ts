/**
 * Modeles de montage.
 *
 * C'est le vrai levier de "facilite": un modele applique en un geste une
 * combinaison de reglages qu'un debutant mettrait plusieurs minutes a trouver.
 * Purement declaratif — donc aucun risque de licence, et modifiable sans
 * toucher au code.
 */

/*
  Le TYPE `Template` vit dans le domaine, pas ici.

  `applyTemplate` doit pouvoir le consommer sans que `src/domain/` ne dependa de
  `src/features/`, ce qui inverserait la direction des dependances du projet. On
  le reexporte pour que les appelants n'aient qu'un seul import a connaitre.
*/
export type { Template } from '../../domain/template';

import type { Template } from '../../domain/template';

export const TEMPLATES: readonly Template[] = [
  {
    id: 'beat-slideshow',
    nameKey: 'samples:templates.beatSlideshow.name',
    descriptionKey: 'samples:templates.beatSlideshow.description',
    targetDuration: 15,
    suggestedClips: 8,
    division: 1,
    everyN: 2,
    transition: { type: 'fade', duration: 0.12 },
    fallbackClipDuration: 1.875,
    kenBurns: false,
    // 120 BPM: un plan toutes les deux pulsations tombe sur une seconde pile.
    suggestedSampleId: 'gen-four-on-floor',
    textPreset: 'caption',
  },
  {
    id: 'cinematic-travel',
    nameKey: 'samples:templates.cinematicTravel.name',
    descriptionKey: 'samples:templates.cinematicTravel.description',
    targetDuration: 20,
    suggestedClips: 5,
    // Toutes les deux pulsations: des plans longs et posés.
    division: 0.5,
    everyN: 2,
    transition: { type: 'fade', duration: 0.5 },
    fallbackClipDuration: 4,
    kenBurns: true,
    // 88 BPM: le tempo le plus lent du catalogue, pour des plans qui respirent.
    suggestedSampleId: 'gen-lofi-chill',
    textPreset: 'plain',
  },
  {
    id: 'quick-cuts',
    nameKey: 'samples:templates.quickCuts.name',
    descriptionKey: 'samples:templates.quickCuts.description',
    targetDuration: 8,
    suggestedClips: 16,
    division: 2,
    everyN: 1,
    transition: { type: 'none', duration: 0 },
    fallbackClipDuration: 0.5,
    kenBurns: false,
    // 160 BPM: le plus rapide, seul a soutenir une coupe par demi-temps.
    suggestedSampleId: 'gen-phonk',
    textPreset: 'karaoke',
  },
  {
    id: 'countdown',
    nameKey: 'samples:templates.countdown.name',
    descriptionKey: 'samples:templates.countdown.description',
    targetDuration: 12,
    suggestedClips: 6,
    division: 1,
    everyN: 4,
    transition: { type: 'zoomIn', duration: 0.2 },
    fallbackClipDuration: 2,
    kenBurns: false,
    // 126 BPM: une mesure fait deux secondes, soit un plan par mesure.
    suggestedSampleId: 'gen-house-groove',
    textPreset: 'sticker',
  },
  {
    id: 'before-after',
    nameKey: 'samples:templates.beforeAfter.name',
    descriptionKey: 'samples:templates.beforeAfter.description',
    targetDuration: 10,
    suggestedClips: 2,
    division: 0.5,
    everyN: 4,
    transition: { type: 'flash', duration: 0.18 },
    fallbackClipDuration: 5,
    kenBurns: false,
    // 140 BPM: le flash sur le beat a besoin d'un tempo franc pour claquer.
    suggestedSampleId: 'gen-trap-hats',
    textPreset: 'sticker',
  },
];

export function findTemplate(id: string): Template | undefined {
  return TEMPLATES.find((template) => template.id === id);
}
