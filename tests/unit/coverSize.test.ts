import { describe, expect, it } from 'vitest';

import { coverSize } from '@/engine/MediaCache';
import { fitRect } from '@/engine/Compositor';

const FRAME_W = 1080;
const FRAME_H = 1920;

describe('coverSize', () => {
  it('couvre la frame pour le cas signale (3456x5184 en 9:16)', () => {
    const { width, height } = coverSize(3456, 5184, FRAME_W, FRAME_H);

    /*
      Le bug d'origine: `Math.min` donnait 1080x1620, soit 84 % des 1920 px de
      hauteur qu'un `cover` exige. On verifie donc la HAUTEUR, pas la largeur.
    */
    expect(height).toBeGreaterThanOrEqual(FRAME_H);
    expect(width).toBeGreaterThanOrEqual(FRAME_W);
  });

  it('preserve le rapport d aspect de la source', () => {
    const source = { w: 3456, h: 5184 };
    const { width, height } = coverSize(source.w, source.h, FRAME_W, FRAME_H);
    expect(width / height).toBeCloseTo(source.w / source.h, 2);
  });

  it('couvre quel que soit le sens de l ecart de format', () => {
    // Une source 4:3 dans un cadre 9:16 doit couvrir par la LARGEUR, donc
    // deborder largement en hauteur: 4,9 Mpx, sous le budget.
    const paysage = coverSize(4000, 3000, FRAME_W, FRAME_H);
    expect(paysage.width).toBeGreaterThanOrEqual(FRAME_W);
    expect(paysage.height).toBeGreaterThanOrEqual(FRAME_H);
  });

  it('couvre une source deja tres haute sans la reduire', () => {
    /*
      1000x4000 fait deja 4 Mpx a la source et ne couvre PAS les 1080 px de large
      exiges. Comme on ne suragrandit jamais (cela n'ajouterait aucun detail), la
      largeur reste a 1000. Le contrat honnete est donc: ne pas DEGRADER une
      source qui est deja au mieux de ce qu'elle peut donner.
    */
    const haute = coverSize(1000, 4000, FRAME_W, FRAME_H);
    expect(haute).toEqual({ width: 1000, height: 4000 });
  });

  it('ne suragrandit jamais une source plus petite que la frame', () => {
    const small = coverSize(400, 600, FRAME_W, FRAME_H);
    expect(small.width).toBe(400);
    expect(small.height).toBe(600);
  });

  it('garde de la resolution en reserve pour le zoom', () => {
    /*
      Sans marge, une source etait reduite a la taille couvrant la frame a 100 %
      EXACTEMENT: le moindre zoom reagrandissait la bitmap et l'image mollissait.
      C'est ce qui plafonnait la nettete a 100 % quel que soit le zoom autorise.

      On verifie que le decodage depasse la stricte couverture, sur des sources
      qui en ont les moyens.
    */
    for (const [sw, sh] of [
      [3024, 4032], // iPhone 12 Mpx, le cas courant
      [3456, 5184], // le cas signale
    ] as const) {
      const { width, height } = coverSize(sw, sh, FRAME_W, FRAME_H);
      const coverScale = Math.max(FRAME_W / sw, FRAME_H / sh);
      // Zoom restant net = taille decodee / taille dessinee a 100 %.
      const netZoom = width / (sw * coverScale);
      expect(netZoom, `${sw}x${sh}`).toBeGreaterThan(1.35);
      expect(height / (sh * coverScale), `${sw}x${sh}`).toBeCloseTo(netZoom, 2);
    }
  });

  it('sacrifie la marge de zoom avant de depasser le budget', () => {
    /*
      Un reflex 24 Mpx ne peut pas recevoir la marge entiere: 1,4x la couverture
      depasserait le budget de pixels. Le budget gagne alors, et la marge est
      rabotee — c'est le bon ordre de priorite, la memoire etant une contrainte
      dure et la marge un confort.

      Mesure: 3000x2000 decodes, soit 104 % de zoom net et 24 Mo. Sans ce
      raboteage, la meme source demanderait 47 Mo par image.
    */
    const { width, height } = coverSize(6000, 4000, FRAME_W, FRAME_H);
    expect(width * height).toBeLessThanOrEqual(6_000_000 * 1.02);
    // La couverture reste assuree: c'est elle qu'on ne sacrifie jamais.
    expect(width).toBeGreaterThanOrEqual(FRAME_W);
    expect(height).toBeGreaterThanOrEqual(FRAME_H);
  });

  it('ne depasse jamais la resolution native de la source', () => {
    // La marge de zoom ne doit pas devenir un suragrandissement: decoder plus
    // gros que la source n'invente aucun detail et gaspille de la memoire.
    for (const [sw, sh] of [
      [3024, 4032],
      [800, 600],
      [1080, 1920],
    ] as const) {
      const { width, height } = coverSize(sw, sh, FRAME_W, FRAME_H);
      expect(width, `${sw}x${sh}`).toBeLessThanOrEqual(sw);
      expect(height, `${sw}x${sh}`).toBeLessThanOrEqual(sh);
    }
  });

  it('plafonne le budget de pixels sur une source panoramique', () => {
    /*
      Seul cas ou le garde-fou doit mordre: couvrir 1920 px de haut avec du 3:1
      demanderait 5760x1920 pour un simple 100 %, et la marge de zoom multiplie
      encore cette demande. On accepte ici de NE PAS couvrir, car l'alternative
      est de faire exploser la memoire du telephone.

      Le budget (6 Mpx) est verifie par son EFFET et non recopie: le test doit
      constater que le plafond mord, pas dupliquer une constante qui bougera
      encore. La tolerance de 2 % absorbe les arrondis a l'entier.
    */
    const { width, height } = coverSize(9000, 3000, FRAME_W, FRAME_H);
    expect(width * height).toBeLessThanOrEqual(6_000_000 * 1.02);
    // Le plafond mord vraiment: sans lui, cette source demanderait bien plus.
    expect(width).toBeLessThan(9000);
    // Le rapport d'aspect reste juste malgre le plafonnement.
    expect(width / height).toBeCloseTo(3, 1);
  });

  it('couvre aussi les formats non 9:16 du selecteur', () => {
    // Les formats que le lot 2 rend atteignables doivent tous etre couverts.
    for (const [fw, fh] of [
      [1080, 1080],
      [1080, 1350],
      [1920, 1080],
    ] as const) {
      const { width, height } = coverSize(3456, 5184, fw, fh);
      expect(width, `largeur en ${fw}x${fh}`).toBeGreaterThanOrEqual(fw);
      expect(height, `hauteur en ${fw}x${fh}`).toBeGreaterThanOrEqual(fh);
    }
  });

  it('ne divise pas par zero sur une source degeneree', () => {
    expect(coverSize(0, 0, FRAME_W, FRAME_H)).toEqual({ width: FRAME_W, height: FRAME_H });
  });

  it('fournit assez de pixels pour le rectangle que fitRect va dessiner', () => {
    /*
      Test d'integration entre les deux geometries: `coverSize` decide de ce qu'on
      DECODE, `fitRect` de ce qu'on DESSINE. Le premier doit toujours fournir au
      moins ce que le second consomme, sinon l'apercu reagrandit.
    */
    const decoded = coverSize(3456, 5184, FRAME_W, FRAME_H);
    const drawn = fitRect(3456, 5184, FRAME_W, FRAME_H, 'cover');

    expect(decoded.width).toBeGreaterThanOrEqual(Math.round(drawn.width) - 1);
    expect(decoded.height).toBeGreaterThanOrEqual(Math.round(drawn.height) - 1);
  });
});
