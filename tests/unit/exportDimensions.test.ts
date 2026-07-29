import { describe, expect, it } from 'vitest';

import {
  qualityDimensions,
  tierAppliesTo,
  QUALITY_4K,
  QUALITY_HIGH,
  QUALITY_MEDIUM,
  QUALITY_ULTRA,
} from '@/export/webcodecs';
import { ASPECT_RATIOS, aspectRatioOf, type AspectRatioId } from '@/domain/types';

const TIERS = [QUALITY_MEDIUM, QUALITY_HIGH, QUALITY_ULTRA];
const FORMATS = Object.keys(ASPECT_RATIOS) as AspectRatioId[];

describe('qualityDimensions', () => {
  it('respecte le format du projet, tous paliers confondus', () => {
    for (const id of FORMATS) {
      const frame = ASPECT_RATIOS[id];
      for (const tier of TIERS) {
        const out = qualityDimensions(tier, frame);
        /*
          Le risque central du chantier: `Compositor.draw` met X et Y a l'echelle
          INDEPENDAMMENT. Un ratio d'encodage different de celui du projet
          etirerait donc l'image au lieu de l'encadrer.
        */
        expect(out.width / out.height, `${id} @ ${tier.height}`).toBeCloseTo(
          frame.width / frame.height,
          1,
        );
      }
    }
  });

  it('produit toujours des dimensions PAIRES', () => {
    // H.264 en 4:2:0 sous-echantillonne la chrominance d'un facteur deux: un cote
    // impair fait echouer l'encodeur, et l'echec surviendrait apres plusieurs
    // secondes d'export.
    for (const id of FORMATS) {
      for (const tier of TIERS) {
        const out = qualityDimensions(tier, ASPECT_RATIOS[id]);
        expect(out.width % 2, `largeur ${id} @ ${tier.height}`).toBe(0);
        expect(out.height % 2, `hauteur ${id} @ ${tier.height}`).toBe(0);
      }
    }
  });

  it('donne les dimensions historiques en 9:16', () => {
    // Non-regression: le format par defaut ne doit pas bouger d'un pixel.
    expect(qualityDimensions(QUALITY_HIGH, ASPECT_RATIOS.reel)).toMatchObject({
      width: 1080,
      height: 1920,
    });
    expect(qualityDimensions(QUALITY_MEDIUM, ASPECT_RATIOS.reel)).toMatchObject({
      width: 720,
      height: 1280,
    });
  });

  it('reporte le debit du palier', () => {
    expect(qualityDimensions(QUALITY_ULTRA, ASPECT_RATIOS.reel).bitrate).toBe(
      QUALITY_ULTRA.bitrate,
    );
  });

  it('gere un format carre sans le deformer', () => {
    const carre = qualityDimensions(QUALITY_HIGH, ASPECT_RATIOS.square);
    expect(carre.width).toBe(carre.height);
  });

  it('gere un format paysage', () => {
    const paysage = qualityDimensions(QUALITY_HIGH, ASPECT_RATIOS.landscape);
    expect(paysage.width).toBeGreaterThan(paysage.height);
    expect(paysage.width / paysage.height).toBeCloseTo(16 / 9, 1);
  });

  it('reste pair meme sur un ratio qui tombe sur un impair', () => {
    // 1080/1350 x 2560 = 2048 exactement; on force ici un cas moins rond.
    const out = qualityDimensions({ height: 1000, bitrate: 1 }, { width: 1001, height: 1000 });
    expect(out.width % 2).toBe(0);
    expect(out.height % 2).toBe(0);
  });
});

describe('palier 4K', () => {
  it('produit exactement 3840 x 2160 en 16:9', () => {
    /*
      La valeur que YouTube attend. Le piege evite ici: `height` est bien la
      HAUTEUR et non « le cote long ». Traiter 2160 comme le cote long donnerait
      3840 de haut, soit du 6827x3840.
    */
    expect(qualityDimensions(QUALITY_4K, ASPECT_RATIOS.landscape)).toMatchObject({
      width: 3840,
      height: 2160,
    });
  });

  it('n est propose qu en paysage', () => {
    expect(tierAppliesTo(QUALITY_4K, ASPECT_RATIOS.landscape)).toBe(true);
    // En vertical il donnerait 2160x3840, que les reseaux verticaux ne
    // diffusent pas: quatre fois le poids pour un re-encodage a l'arrivee.
    expect(tierAppliesTo(QUALITY_4K, ASPECT_RATIOS.reel)).toBe(false);
    expect(tierAppliesTo(QUALITY_4K, ASPECT_RATIOS.square)).toBe(false);
    expect(tierAppliesTo(QUALITY_4K, ASPECT_RATIOS.portrait)).toBe(false);
  });

  it('devient disponible sur le 4:3, indisponible sur le 3:4', () => {
    /*
      Consequence LOGIQUE de `landscapeOnly`, constatee ici plutot que decouverte
      a l'usage: ajouter un format paysage ouvre le palier 4K, ajouter son
      equivalent portrait ne l'ouvre pas.
    */
    expect(tierAppliesTo(QUALITY_4K, ASPECT_RATIOS.classic)).toBe(true);
    expect(tierAppliesTo(QUALITY_4K, ASPECT_RATIOS.classicPortrait)).toBe(false);
  });

  it('donne du 4K non deforme en 4:3', () => {
    const out = qualityDimensions(QUALITY_4K, ASPECT_RATIOS.classic);
    expect(out.height).toBe(2160);
    expect(out.width / out.height).toBeCloseTo(4 / 3, 2);
  });

  it('laisse les autres paliers disponibles partout', () => {
    for (const tier of [QUALITY_MEDIUM, QUALITY_HIGH, QUALITY_ULTRA]) {
      for (const id of FORMATS) {
        expect(tierAppliesTo(tier, ASPECT_RATIOS[id])).toBe(true);
      }
    }
  });

  it('garde un debit superieur aux autres paliers', () => {
    // Un 4K au debit du 1080p serait plus DEFINI mais plus compresse: on y
    // perdrait en qualite percue malgre les pixels supplementaires.
    expect(QUALITY_4K.bitrate).toBeGreaterThan(QUALITY_ULTRA.bitrate);
  });
});

describe('ASPECT_RATIOS', () => {
  it('n expose que des dimensions paires', () => {
    for (const id of FORMATS) {
      expect(ASPECT_RATIOS[id].width % 2, `largeur ${id}`).toBe(0);
      expect(ASPECT_RATIOS[id].height % 2, `hauteur ${id}`).toBe(0);
    }
  });

  it('reconnait chaque format par ses dimensions', () => {
    for (const id of FORMATS) {
      expect(aspectRatioOf(ASPECT_RATIOS[id])).toBe(id);
    }
  });

  it('renvoie null sur des dimensions inconnues', () => {
    // Un projet enregistre avec un format retire ne doit pas faire planter l'UI.
    expect(aspectRatioOf({ width: 640, height: 480 })).toBeNull();
  });
});
