/**
 * Migration de schema et filtres.
 *
 * La migration protege des projets deja enregistres chez l'utilisateur: une
 * erreur ici ne casse pas un test, elle casse le travail de quelqu'un. D'ou des
 * cas construits a partir de projets v1 REELS (sans les champs ajoutes en v2),
 * et non a partir des fabriques courantes qui les rempliraient d'office.
 */

import { describe, expect, it } from 'vitest';

import {
  clampTransform,
  completeLyrics,
  createAudioTrack,
  createEmptyProject,
  createTextOverlay,
  createLyrics,
  filterForPreset,
  DEFAULT_ORIGINAL_GAIN,
  isNeutralFilter,
  KARAOKE_SUNG_COLOR,
  MIN_TEXT_DURATION,
  splitTextOverlay,
  MAX_CLIP_OFFSET,
  MAX_CLIP_SCALE,
  migrateProject,
  MIN_CLIP_SCALE,
  neutralFilter,
  textStyleForPreset,
  withFont,
} from '@/domain/project';
import { filterToCss } from '@/engine/Compositor';
import {
  FONT_STACKS,
  PROJECT_SCHEMA_VERSION,
  type Lyrics,
  type MediaAsset,
  type Project,
} from '@/domain/types';

/**
 * Projet tel qu'il etait ecrit en v1: `TextStyle` sans `font`, `ClipFilter`
 * limite a trois champs. On passe par `unknown` parce que ces formes ne sont
 * plus assignables aux types courants — c'est precisement ce qu'on migre.
 */
function v1Project(): Project {
  return {
    id: 'proj_1',
    schemaVersion: 1,
    name: 'Ancien',
    createdAt: 1,
    updatedAt: 1,
    frame: { width: 1080, height: 1920, fps: 30 },
    background: { type: 'color', color: '#000000' },
    assets: {},
    videoTrack: {
      id: 'vtrack_1',
      kind: 'video',
      clips: [
        {
          id: 'clip_1',
          assetId: 'asset_1',
          start: 0,
          duration: 2,
          fit: 'cover',
          transform: { scale: 1, x: 0, y: 0, rotation: 0 },
          muted: false,
          filter: { brightness: 1.2, contrast: 0.9, saturation: 1.1 },
        },
      ],
    },
    audioTracks: [],
    overlays: [
      {
        id: 'text_1',
        text: 'Salut',
        start: 0,
        duration: 3,
        x: 0.5,
        y: 0.5,
        maxWidth: 0.8,
        rotation: 0,
        style: {
          fontFamily: 'Georgia, serif',
          fontSize: 0.07,
          fontWeight: 700,
          color: '#ffffff',
          align: 'center',
          lineHeight: 1.2,
          letterSpacing: 0,
        },
        animation: { in: 'fade', out: 'fade', duration: 0.3 },
      },
    ],
    snapping: { enabled: true, division: 1 },
  } as unknown as Project;
}

describe('migrateProject', () => {
  it('amene un projet v1 au schema courant', () => {
    const migrated = migrateProject(v1Project());
    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
  });

  it('deduit la police depuis la pile CSS enregistree', () => {
    const migrated = migrateProject(v1Project());
    const style = migrated.overlays[0]!.style;
    // `Georgia, serif` correspond au choix `serif`.
    expect(style.font).toBe('serif');
    // Et la pile est reecrite pour rester coherente avec le choix.
    expect(style.fontFamily).toBe(FONT_STACKS.serif);
  });

  it('complete les champs de filtre ajoutes en v2', () => {
    const migrated = migrateProject(v1Project());
    const filter = migrated.videoTrack.clips[0]!.filter!;

    // Les valeurs v1 sont conservees.
    expect(filter.brightness).toBe(1.2);
    expect(filter.contrast).toBe(0.9);
    expect(filter.saturation).toBe(1.1);

    // Les nouveaux champs prennent l'identite — et surtout, `intensity` vaut 1 et
    // non `undefined`: un `undefined` produirait un NaN dans la chaine CSS du
    // compositeur, ce qui effacerait l'image.
    expect(filter.intensity).toBe(1);
    expect(filter.hueRotate).toBe(0);
    expect(filter.sepia).toBe(0);
    expect(filter.blur).toBe(0);
    expect(filter.preset).toBe('custom');
  });

  it('produit un filtre qui donne une chaine CSS valide', () => {
    const migrated = migrateProject(v1Project());
    const css = filterToCss(migrated.videoTrack.clips[0]!.filter!, 1080);
    // Le vrai risque de la migration: un NaN silencieux.
    expect(css).not.toBeNull();
    expect(css).not.toContain('NaN');
  });

  it('migre aussi le style des paroles', () => {
    const raw = {
      ...v1Project(),
      lyrics: {
        ...createLyrics(),
        style: {
          fontFamily: 'Menlo, monospace',
          fontSize: 0.08,
          fontWeight: 700,
          color: '#ffffff',
          align: 'center',
          lineHeight: 1.2,
          letterSpacing: 0,
        },
      },
    } as unknown as Project;

    const migrated = migrateProject(raw);
    expect(migrated.lyrics!.style.font).toBe('mono');
  });

  it('laisse un projet deja a jour inchange', () => {
    const current = createEmptyProject('Neuf');
    const migrated = migrateProject(current);
    expect(migrated.schemaVersion).toBe(PROJECT_SCHEMA_VERSION);
  });

  it('refuse un projet ecrit par une version plus recente', () => {
    const future = { ...createEmptyProject('Futur'), schemaVersion: 99 };
    // On ne sait pas lire ce schema: echouer est plus sur que de deviner.
    expect(() => migrateProject(future)).toThrow();
  });
});

describe('withFont', () => {
  it('garde `font` et `fontFamily` coherents', () => {
    const style = withFont(textStyleForPreset('plain'), 'condensed');
    expect(style.font).toBe('condensed');
    expect(style.fontFamily).toBe(FONT_STACKS.condensed);
  });
});

describe('filterForPreset', () => {
  it('renvoie l identite pour `none`', () => {
    expect(isNeutralFilter(filterForPreset('none'))).toBe(true);
  });

  it('desature completement en noir et blanc', () => {
    expect(filterForPreset('mono').saturation).toBe(0);
  });

  it('porte son propre nom de preset', () => {
    for (const preset of ['vivid', 'faded', 'warm', 'cool', 'noir', 'vhs'] as const) {
      expect(filterForPreset(preset).preset).toBe(preset);
    }
  });
});

describe('filterToCss', () => {
  it('renvoie null pour un filtre neutre', () => {
    expect(filterToCss(neutralFilter(), 1080)).toBeNull();
  });

  it('renvoie null a intensite nulle', () => {
    // Doser un look a zero, c'est ne pas l'appliquer: inutile de payer un filtre.
    expect(filterToCss({ ...filterForPreset('noir'), intensity: 0 }, 1080)).toBeNull();
  });

  it('interpole depuis l identite selon l intensite', () => {
    const half = filterToCss({ ...filterForPreset('mono'), intensity: 0.5 }, 1080);
    // `mono` desature a 0; a mi-intensite on doit obtenir 0,5.
    expect(half).toContain('saturate(0.5)');
  });

  it('met le flou a l echelle de la frame', () => {
    // Un flou en unites normalisees doit produire quatre fois plus de pixels sur
    // un export 1080 que sur un apercu 270 — sinon l'apercu mentirait.
    const wide = filterToCss({ ...filterForPreset('vhs'), intensity: 1 }, 1080);
    const narrow = filterToCss({ ...filterForPreset('vhs'), intensity: 1 }, 270);

    const blurOf = (css: string | null) =>
      Number(/blur\(([\d.]+)px\)/.exec(css ?? '')?.[1] ?? '0');

    expect(blurOf(wide)).toBeCloseTo(blurOf(narrow) * 4, 3);
  });

  it('ne produit jamais de NaN', () => {
    const css = filterToCss(filterForPreset('warm'), 1080);
    expect(css).not.toContain('NaN');
  });
});

describe('clampTransform', () => {
  const base = { scale: 1, x: 0, y: 0, rotation: 0 };

  it('laisse passer un recadrage deja dans les bornes', () => {
    const transform = { scale: 1.5, x: 0.1, y: -0.2, rotation: 0.3 };
    expect(clampTransform(transform)).toEqual(transform);
  });

  it('borne le zoom des deux cotes', () => {
    expect(clampTransform({ ...base, scale: 99 }).scale).toBe(MAX_CLIP_SCALE);
    // Sous 1, l'image ne remplit plus le cadre et laisse apparaitre le fond.
    expect(clampTransform({ ...base, scale: 0.1 }).scale).toBe(MIN_CLIP_SCALE);
  });

  it('borne le decalage symetriquement', () => {
    expect(clampTransform({ ...base, x: 9 }).x).toBe(MAX_CLIP_OFFSET);
    expect(clampTransform({ ...base, x: -9 }).x).toBe(-MAX_CLIP_OFFSET);
    expect(clampTransform({ ...base, y: 9 }).y).toBe(MAX_CLIP_OFFSET);
    expect(clampTransform({ ...base, y: -9 }).y).toBe(-MAX_CLIP_OFFSET);
  });

  it('ne touche pas a la rotation', () => {
    // La rotation n'est pas un recadrage: le geste de pincement ne la modifie
    // pas, et la borner ici brimerait le panneau Modifier.
    expect(clampTransform({ ...base, rotation: 3 }).rotation).toBe(3);
  });
});

describe('completeLyrics', () => {
  it('ajoute le surlignage karaoke quand il manque', () => {
    // Cas REEL: un projet cree avant l'ajout du champ. `setLyricsLines` fait
    // `project.lyrics ?? createLyrics()`, donc les paroles existantes ne
    // recevaient jamais les defauts des champs plus recents — le karaoke restait
    // absent, constate en lisant les clefs reellement persistees.
    const legacy = { ...createLyrics() } as Lyrics;
    delete (legacy as { karaoke?: unknown }).karaoke;

    const completed = completeLyrics(legacy);
    expect(completed.karaoke).toEqual({ enabled: true, color: KARAOKE_SUNG_COLOR });
  });

  it('respecte un reglage deja present', () => {
    // Un utilisateur ayant desactive le surlignage ne doit pas le voir revenir.
    const chosen: Lyrics = {
      ...createLyrics(),
      karaoke: { enabled: false, color: '#ff0000' },
    };
    expect(completeLyrics(chosen).karaoke).toEqual({ enabled: false, color: '#ff0000' });
  });

  it('ne touche a rien d autre', () => {
    const base = createLyrics();
    const completed = completeLyrics(base);
    expect(completed.lines).toBe(base.lines);
    expect(completed.style).toBe(base.style);
    expect(completed.beatsPerLine).toBe(base.beatsPerLine);
  });
});

describe('createAudioTrack — son d origine', () => {
  const video: MediaAsset = {
    id: 'asset_vid',
    kind: 'video',
    name: 'clip.mp4',
    mimeType: 'video/mp4',
    bytes: 1024,
    storage: { backend: 'idb', key: 'v.bin' },
    duration: 8,
    hasAudio: true,
    createdAt: 1,
  };

  it('demarre la ou le plan est pose', () => {
    // Le son suit son image: une piste posee a zero serait desynchronisee des
    // que le plan n'est pas le premier du montage.
    expect(createAudioTrack(video, 'original', { start: 4.5 }).start).toBe(4.5);
  });

  it('entre sous la musique par defaut', () => {
    // A plein volume, le son d'origine couvrirait la musique.
    const original = createAudioTrack(video, 'original');
    expect(original.gain).toBe(DEFAULT_ORIGINAL_GAIN);
    expect(original.gain).toBeLessThan(1);
    // La musique, elle, garde son plein volume.
    expect(createAudioTrack(video, 'music').gain).toBe(1);
  });

  it('n a pas de fondu de sortie', () => {
    // Un fondu eteindrait une voix avant la fin du plan, ce qui s'entend comme
    // un defaut. Le fondu de fin de reel reste l'affaire de la musique.
    expect(createAudioTrack(video, 'original').fadeOut).toBe(0);
    expect(createAudioTrack(video, 'music').fadeOut).toBeGreaterThan(0);
  });

  it('couvre toute la source', () => {
    const original = createAudioTrack(video, 'original');
    expect(original.source).toEqual({ in: 0, out: 8 });
  });

  it('porte le role `original`', () => {
    expect(createAudioTrack(video, 'original').role).toBe('original');
  });
});

describe('splitTextOverlay', () => {
  const overlay = createTextOverlay('Bonjour', { start: 2, duration: 4 });

  it('produit deux morceaux contigus couvrant la duree d origine', () => {
    const pieces = splitTextOverlay(overlay, 3.5, 'text_new');
    expect(pieces).not.toBeNull();
    const [first, second] = pieces!;
    expect(first.duration + second.duration).toBeCloseTo(4, 6);
    expect(second.start).toBeCloseTo(first.start + first.duration, 6);
  });

  it('duplique le texte sur les deux morceaux', () => {
    // Rien ne permet de deviner ou couper une phrase: deviner produirait un
    // resultat absurde.
    const [first, second] = splitTextOverlay(overlay, 3.5, 'text_new')!;
    expect(first.text).toBe('Bonjour');
    expect(second.text).toBe('Bonjour');
  });

  it('donne un identifiant neuf au second morceau', () => {
    const [first, second] = splitTextOverlay(overlay, 3.5, 'text_new')!;
    expect(first.id).toBe(overlay.id);
    expect(second.id).toBe('text_new');
  });

  it('retire l animation d entree du second morceau', () => {
    // La rejouer au milieu d'un texte deja affiche se verrait comme un
    // clignotement.
    const [first, second] = splitTextOverlay(overlay, 3.5, 'text_new')!;
    expect(first.animation.in).toBe(overlay.animation.in);
    expect(second.animation.in).toBe('none');
  });

  it('conserve le style et la position', () => {
    const [first, second] = splitTextOverlay(overlay, 3.5, 'text_new')!;
    for (const piece of [first, second]) {
      expect(piece.style).toEqual(overlay.style);
      expect(piece.x).toBe(overlay.x);
      expect(piece.y).toBe(overlay.y);
    }
  });

  it('refuse une coupe hors de l incrustation', () => {
    expect(splitTextOverlay(overlay, 1, 'n')).toBeNull();
    expect(splitTextOverlay(overlay, 99, 'n')).toBeNull();
  });

  it('refuse de produire un fragment illisible', () => {
    // Trop pres du debut, puis de la fin.
    expect(splitTextOverlay(overlay, 2 + MIN_TEXT_DURATION / 2, 'n')).toBeNull();
    expect(splitTextOverlay(overlay, 6 - MIN_TEXT_DURATION / 2, 'n')).toBeNull();
  });
});
