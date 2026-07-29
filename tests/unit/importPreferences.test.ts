import { describe, expect, it } from 'vitest';

import {
  MAX_CLIP_OFFSET,
  MAX_CLIP_SCALE,
  QUARTER_TURN,
  applyImportPreferences,
  createEmptyProject,
  splitRotation,
} from '@/domain/project';
import { DEFAULT_IMPORT_PREFERENCES, type Clip, type ImportPreferences } from '@/domain/types';

const REEL = { width: 1080, height: 1920 };
const LANDSCAPE = { width: 1920, height: 1080 };

function clip(): Clip {
  return {
    id: 'c1',
    assetId: 'a1',
    start: 0,
    duration: 2,
    fit: 'cover',
    transform: { scale: 1, x: 0, y: 0, rotation: 0 },
    muted: false,
  };
}

function prefs(patch: Partial<ImportPreferences> = {}): ImportPreferences {
  return { ...DEFAULT_IMPORT_PREFERENCES, ...patch };
}

describe('createEmptyProject — les reglages survivent a « Nouveau reel »', () => {
  it('herite du format memorise', () => {
    /*
      Bug signale: regler le format en 16:9 puis taper « Nouveau reel » ramenait
      le projet en 9:16. Les dimensions etaient codees en dur dans le projet
      vierge, donc tout choix durable etait perdu au montage suivant.
    */
    const fresh = createEmptyProject('Test', { frame: { width: 1920, height: 1080 } });
    expect(fresh.frame.width).toBe(1920);
    expect(fresh.frame.height).toBe(1080);
  });

  it('herite du fond memorise', () => {
    const fresh = createEmptyProject('Test', { background: { type: 'blur', amount: 0.04 } });
    expect(fresh.background).toEqual({ type: 'blur', amount: 0.04 });
  });

  it('garde la cadence hors des preferences', () => {
    // `fps` n'est pas un choix de mise en page: il ne doit pas suivre le format.
    const fresh = createEmptyProject('Test', { frame: { width: 1920, height: 1080 } });
    expect(fresh.frame.fps).toBe(30);
  });

  it('retombe sur les valeurs par defaut sans preference', () => {
    // Non-regression: un appel sans second argument doit se comporter comme avant.
    const fresh = createEmptyProject('Test');
    expect(fresh.frame).toEqual({ width: 1080, height: 1920, fps: 30 });
    expect(fresh.background).toEqual({ type: 'color', color: '#000000' });

    // `null` explicite (aucune preference enregistree) vaut le defaut.
    const nulled = createEmptyProject('Test', { frame: null, background: null });
    expect(nulled.frame).toEqual({ width: 1080, height: 1920, fps: 30 });
  });

  it('produit toujours un projet vide et neuf', () => {
    // Les preferences ne portent QUE la mise en page: elles ne doivent jamais
    // faire ressurgir du contenu d'un projet precedent.
    const fresh = createEmptyProject('Test', { frame: { width: 1920, height: 1080 } });
    expect(fresh.videoTrack.clips).toEqual([]);
    expect(fresh.audioTracks).toEqual([]);
    expect(Object.keys(fresh.assets)).toEqual([]);
  });
});

describe('applyImportPreferences — cadrage', () => {
  it('applique le cadrage choisi', () => {
    expect(applyImportPreferences(clip(), { width: 100, height: 100 }, REEL, prefs({ fit: 'contain' })).fit).toBe('contain');
    expect(applyImportPreferences(clip(), { width: 100, height: 100 }, REEL, prefs({ fit: 'cover' })).fit).toBe('cover');
  });

  it('ne touche a rien sans dimensions de source', () => {
    // Une video dont le sondage a echoue ne doit pas se retrouver tournee au
    // hasard: sans dimensions, aucune decision geometrique n'est possible.
    const out = applyImportPreferences(clip(), undefined, REEL, prefs({ autoRotate: true, autoZoom: true }));
    expect(out.transform).toEqual(clip().transform);
  });

  it('ignore une source degeneree', () => {
    const out = applyImportPreferences(clip(), { width: 0, height: 0 }, REEL, prefs({ autoRotate: true }));
    expect(out.transform.rotation).toBe(0);
  });
});

describe('applyImportPreferences — redressement', () => {
  it('tourne une photo paysage dans un cadre vertical', () => {
    const out = applyImportPreferences(clip(), { width: 4000, height: 3000 }, REEL, prefs({ autoRotate: true }));
    expect(splitRotation(out.transform.rotation).quarters).toBe(1);
  });

  it('tourne une photo portrait dans un cadre paysage', () => {
    const out = applyImportPreferences(clip(), { width: 3000, height: 4000 }, LANDSCAPE, prefs({ autoRotate: true }));
    expect(splitRotation(out.transform.rotation).quarters).toBe(1);
  });

  it('ne tourne PAS quand les orientations concordent', () => {
    const out = applyImportPreferences(clip(), { width: 1080, height: 1920 }, REEL, prefs({ autoRotate: true }));
    expect(out.transform.rotation).toBe(0);
  });

  it('ne tourne JAMAIS une image carree', () => {
    // Un carre ne contredit aucune orientation: le tourner serait un mouvement
    // gratuit, visible et incomprehensible pour l'utilisateur.
    const out = applyImportPreferences(clip(), { width: 2000, height: 2000 }, REEL, prefs({ autoRotate: true }));
    expect(out.transform.rotation).toBe(0);
  });

  it('ne tourne pas dans un cadre carre', () => {
    const square = { width: 1080, height: 1080 };
    const out = applyImportPreferences(clip(), { width: 4000, height: 3000 }, square, prefs({ autoRotate: true }));
    expect(out.transform.rotation).toBe(0);
  });

  it('ne fait rien quand l option est eteinte', () => {
    const out = applyImportPreferences(clip(), { width: 4000, height: 3000 }, REEL, prefs({ autoRotate: false }));
    expect(out.transform.rotation).toBe(0);
  });
});

describe('applyImportPreferences — zoom de remplissage', () => {
  it('zoome pour combler les bandes en mode contain', () => {
    const out = applyImportPreferences(
      clip(),
      { width: 4000, height: 3000 },
      REEL,
      prefs({ fit: 'contain', autoZoom: true }),
    );
    expect(out.transform.scale).toBeGreaterThan(1);
  });

  it('ne zoome PAS en mode cover', () => {
    // L'image deborde deja: zoomer ne comblerait rien et rognerait davantage.
    const out = applyImportPreferences(
      clip(),
      { width: 4000, height: 3000 },
      REEL,
      prefs({ fit: 'cover', autoZoom: true }),
    );
    expect(out.transform.scale).toBe(1);
  });

  it('ne zoome pas une source deja au bon format', () => {
    const out = applyImportPreferences(
      clip(),
      { width: 1080, height: 1920 },
      REEL,
      prefs({ fit: 'contain', autoZoom: true }),
    );
    expect(out.transform.scale).toBeCloseTo(1, 6);
  });

  it('reste dans les bornes de zoom', () => {
    // Une source tres allongee demanderait un facteur enorme: le plafond doit
    // tenir, sinon l'image deviendrait illisible.
    const out = applyImportPreferences(
      clip(),
      { width: 9000, height: 500 },
      REEL,
      prefs({ fit: 'contain', autoZoom: true }),
    );
    // Borne lue et non recopiee, pour que le test survive a un relevement du
    // plafond: ce qu'il verifie, c'est que le bornage agit.
    expect(out.transform.scale).toBeLessThanOrEqual(MAX_CLIP_SCALE);
  });
});

describe('applyImportPreferences — recentrage', () => {
  it('deplace vers un point d interet decentre', () => {
    // Source tres haute: elle deborde en HAUTEUR, donc le recentrage vertical a
    // de la marge pour agir.
    const out = applyImportPreferences(
      clip(),
      { width: 1080, height: 3000 },
      REEL,
      prefs({ autoCenter: true }),
      { x: 0.5, y: 0.25 },
    );
    // Point d'interet en haut => l'image descend pour l'amener au centre.
    expect(out.transform.y).toBeGreaterThan(0);
  });

  it('ne bouge pas sur un axe sans debordement', () => {
    /*
      Mesure qui surprend, et qu'il faut consigner: une photo 2:3 posee en
      `cover` dans un cadre 9:16 est dessinee en 1280x1920. Elle deborde de
      200 px en largeur et de ZERO en hauteur. Un sujet situe en haut ne PEUT
      donc pas etre remonte — il n'y a aucune marge verticale a exploiter, et
      forcer un decalage ferait entrer du vide dans le cadre.
    */
    const out = applyImportPreferences(
      clip(),
      { width: 3456, height: 5184 },
      REEL,
      prefs({ autoCenter: true }),
      { x: 0.5, y: 0.25 },
    );
    expect(out.transform.y).toBe(0);
  });

  it('reste dans les bornes de decalage', () => {
    const out = applyImportPreferences(
      clip(),
      { width: 1080, height: 9000 },
      REEL,
      prefs({ autoCenter: true }),
      { x: 0.5, y: 0 },
    );
    expect(Math.abs(out.transform.y)).toBeLessThanOrEqual(MAX_CLIP_OFFSET);
  });

  it('ne fait rien sans point d interet', () => {
    // `focalPointOf` renvoie `null` sur une image unie: le cadrage doit alors
    // rester centre plutot que d'inventer un deplacement.
    const out = applyImportPreferences(
      clip(),
      { width: 1080, height: 3000 },
      REEL,
      prefs({ autoCenter: true }),
      undefined,
    );
    expect(out.transform.x).toBe(0);
    expect(out.transform.y).toBe(0);
  });
});

describe('applyImportPreferences — combinaisons', () => {
  it('redresse PUIS cadre sur les dimensions obtenues', () => {
    /*
      L'ordre compte: apres un quart de tour, une photo 4000x3000 est VUE en
      3000x4000. Le zoom de remplissage doit raisonner sur ces dimensions-la,
      sinon il comblerait des bandes qui n'existent plus.
    */
    const out = applyImportPreferences(
      clip(),
      { width: 4000, height: 3000 },
      REEL,
      prefs({ fit: 'contain', autoRotate: true, autoZoom: true }),
    );
    expect(splitRotation(out.transform.rotation).quarters).toBe(1);

    // Apres rotation, la source vue (3:4) est bien plus proche du cadre 9:16
    // que l'originale (4:3): le zoom necessaire est donc plus faible.
    const sansRotation = applyImportPreferences(
      clip(),
      { width: 4000, height: 3000 },
      REEL,
      prefs({ fit: 'contain', autoRotate: false, autoZoom: true }),
    );
    expect(out.transform.scale).toBeLessThan(sansRotation.transform.scale);
  });

  it('produit une transformation toujours valide', () => {
    // Balayage large: aucune combinaison ne doit produire de NaN ni sortir des
    // bornes, y compris sur des sources extremes.
    for (const source of [
      { width: 4000, height: 3000 },
      { width: 3000, height: 4000 },
      { width: 9000, height: 500 },
      { width: 500, height: 9000 },
      { width: 1000, height: 1000 },
    ]) {
      for (const fit of ['cover', 'contain'] as const) {
        const out = applyImportPreferences(
          clip(),
          source,
          REEL,
          prefs({ fit, autoRotate: true, autoZoom: true, autoCenter: true }),
          { x: 0.3, y: 0.2 },
        );
        const label = `${source.width}x${source.height} ${fit}`;
        expect(Number.isFinite(out.transform.scale), label).toBe(true);
        expect(Number.isFinite(out.transform.x), label).toBe(true);
        expect(Number.isFinite(out.transform.y), label).toBe(true);
        expect(out.transform.rotation, label).toBeGreaterThanOrEqual(0);
        expect(out.transform.rotation, label).toBeLessThan(4 * QUARTER_TURN);
      }
    }
  });

  it('ne fait rien du tout avec les preferences par defaut', () => {
    // Non-regression: sans reglage explicite, l'import doit se comporter
    // exactement comme avant l'ajout de cette fonctionnalite.
    const out = applyImportPreferences(clip(), { width: 4000, height: 3000 }, REEL, prefs());
    expect(out.fit).toBe('cover');
    expect(out.transform).toEqual({ scale: 1, x: 0, y: 0, rotation: 0 });
  });
});
