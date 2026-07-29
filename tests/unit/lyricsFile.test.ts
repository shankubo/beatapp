/**
 * Lecture des fichiers de paroles horodatees.
 *
 * Ces fichiers viennent de l'exterieur et sont donc traites comme hostiles: mal
 * tries, mal nommes, tronques, avec des horodatages a des precisions variables.
 * Chaque cas ici correspond a une forme reellement rencontree dans la nature.
 */

import { describe, expect, it } from 'vitest';

import {
  detectLyricsFormat,
  fitLinesToReel,
  parseLrc,
  parseLyricsFile,
  parseSrt,
} from '@/domain/lyricsFile';

describe('detectLyricsFormat', () => {
  it('reconnait un SRT par sa plage', () => {
    const raw = '1\n00:00:01,000 --> 00:00:03,500\nPremiere ligne';
    expect(detectLyricsFormat(raw)).toBe('srt');
  });

  it('reconnait un LRC par ses horodatages entre crochets', () => {
    expect(detectLyricsFormat('[00:01.00] Premiere ligne')).toBe('lrc');
  });

  it('renvoie null sur du texte simple', () => {
    // L'appelant proposera de le coller comme texte: plus utile qu'une erreur.
    expect(detectLyricsFormat('Premiere ligne\nDeuxieme ligne')).toBeNull();
  });

  it('ne se fie pas a l extension mais au contenu', () => {
    // Un `.txt` contenant du LRC doit fonctionner: le nom du fichier est une
    // affirmation de l'utilisateur, pas une preuve.
    expect(parseLyricsFile('[00:02.50] Une ligne')?.format).toBe('lrc');
  });
});

describe('parseLrc', () => {
  it('lit les instants et deduit les durees de la ligne suivante', () => {
    const lines = parseLrc(['[00:00.00] Un', '[00:02.00] Deux', '[00:05.00] Trois'].join('\n'));

    expect(lines).toHaveLength(3);
    expect(lines[0]!.start).toBeCloseTo(0, 3);
    expect(lines[0]!.duration).toBeCloseTo(2, 3);
    expect(lines[1]!.start).toBeCloseTo(2, 3);
    expect(lines[1]!.duration).toBeCloseTo(3, 3);
  });

  it('developpe une ligne portant plusieurs horodatages', () => {
    // Facon compacte d'ecrire un refrain qui revient: sans ce traitement, le
    // refrain n'apparaitrait qu'une seule fois.
    const lines = parseLrc('[00:10.00][00:30.00] Refrain\n[00:40.00] Fin');

    const refrains = lines.filter((line) => line.text === 'Refrain');
    expect(refrains).toHaveLength(2);
    expect(refrains[0]!.start).toBeCloseTo(10, 3);
    expect(refrains[1]!.start).toBeCloseTo(30, 3);
  });

  it('trie les lignes meme si le fichier ne l est pas', () => {
    const lines = parseLrc('[00:20.00] Deux\n[00:05.00] Un');
    expect(lines.map((line) => line.text)).toEqual(['Un', 'Deux']);
  });

  it('ignore les metadonnees', () => {
    const lines = parseLrc('[ar: Artiste]\n[ti: Titre]\n[00:01.00] Seule ligne');
    expect(lines.map((line) => line.text)).toEqual(['Seule ligne']);
  });

  it('applique `offset` en decalant les temps', () => {
    // `offset` positif = avancer les paroles, donc retrancher.
    const lines = parseLrc('[offset: 500]\n[00:10.00] Ligne');
    expect(lines[0]!.start).toBeCloseTo(9.5, 3);
  });

  it('utilise un horodatage sans texte comme borne de fin', () => {
    // Marqueur d'instrumental: il borne la ligne precedente puis disparait.
    const lines = parseLrc('[00:00.00] Chantee\n[00:03.00]\n[00:20.00] Suivante');

    expect(lines.map((line) => line.text)).toEqual(['Chantee', 'Suivante']);
    // La ligne chantee s'arrete au marqueur, pas a la ligne suivante.
    expect(lines[0]!.duration).toBeCloseTo(3, 3);
  });

  it('accepte les centiemes comme les millisecondes', () => {
    const lines = parseLrc('[00:01.5] A\n[00:02.250] B');
    expect(lines[0]!.start).toBeCloseTo(1.5, 3);
    expect(lines[1]!.start).toBeCloseTo(2.25, 3);
  });

  it('accepte les minutes au-dela de 59', () => {
    // Un morceau long, ou un fichier concatene.
    const lines = parseLrc('[75:30.00] Tardive');
    expect(lines[0]!.start).toBeCloseTo(75 * 60 + 30, 3);
  });

  it('donne une duree a la derniere ligne, qui n a pas de fin', () => {
    const lines = parseLrc('[00:01.00] Unique');
    expect(lines[0]!.duration).toBeGreaterThan(0);
  });
});

describe('parseSrt', () => {
  it('lit les plages explicites', () => {
    const raw = [
      '1',
      '00:00:01,000 --> 00:00:03,500',
      'Premiere',
      '',
      '2',
      '00:00:04,000 --> 00:00:06,000',
      'Deuxieme',
    ].join('\n');

    const lines = parseSrt(raw);
    expect(lines).toHaveLength(2);
    expect(lines[0]!.start).toBeCloseTo(1, 3);
    // La fin est EXPLICITE en SRT: la duree n'est pas deduite de la suivante.
    expect(lines[0]!.duration).toBeCloseTo(2.5, 3);
  });

  it('conserve un sous-titre sur deux lignes', () => {
    const raw = '1\n00:00:01,000 --> 00:00:03,000\nPremiere moitie\nSeconde moitie';
    // Le rendu canvas sait deja gerer un retour a la ligne.
    expect(parseSrt(raw)[0]!.text).toBe('Premiere moitie\nSeconde moitie');
  });

  it('accepte le point comme separateur decimal', () => {
    const raw = '1\n00:00:01.500 --> 00:00:03.000\nLigne';
    expect(parseSrt(raw)[0]!.start).toBeCloseTo(1.5, 3);
  });

  it('complete les millisecondes a droite', () => {
    // `,5` vaut 500 ms et non 5 ms.
    const raw = '1\n00:00:01,5 --> 00:00:03,0\nLigne';
    expect(parseSrt(raw)[0]!.start).toBeCloseTo(1.5, 3);
  });

  it('lit les heures', () => {
    const raw = '1\n01:02:03,000 --> 01:02:05,000\nTardive';
    expect(parseSrt(raw)[0]!.start).toBeCloseTo(3723, 3);
  });

  it('ecarte un bloc sans texte', () => {
    const raw = '1\n00:00:01,000 --> 00:00:03,000\n\n\n2\n00:00:04,000 --> 00:00:05,000\nSeule';
    expect(parseSrt(raw).map((line) => line.text)).toEqual(['Seule']);
  });

  it('survit a un fichier tronque', () => {
    // Fichier coupe en plein bloc: on garde ce qui est lisible.
    const raw = '1\n00:00:01,000 --> 00:00:03,000\nComplete\n\n2\n00:00:04,000 -->';
    expect(parseSrt(raw)).toHaveLength(1);
  });
});

describe('parseLyricsFile', () => {
  it('renvoie null quand rien n est reconnaissable', () => {
    expect(parseLyricsFile('juste du texte')).toBeNull();
  });

  it('renvoie null sur un fichier vide', () => {
    expect(parseLyricsFile('')).toBeNull();
  });
});

describe('fitLinesToReel', () => {
  const lines = parseSrt(
    [
      '1',
      '00:00:10,000 --> 00:00:12,000',
      'Avant',
      '',
      '2',
      '00:00:30,000 --> 00:00:32,000',
      'Pendant',
      '',
      '3',
      '00:01:00,000 --> 00:01:02,000',
      'Apres',
    ].join('\n'),
  );

  it('decale les lignes sur le debut du reel', () => {
    // Le reel commence a la 30e seconde de la chanson.
    const fitted = fitLinesToReel(lines, { from: 30, until: 10 });

    expect(fitted.map((line) => line.text)).toEqual(['Pendant']);
    expect(fitted[0]!.start).toBeCloseTo(0, 3);
  });

  it('ecarte ce qui tombe hors du montage', () => {
    // Sans ce filtrage, la quasi-totalite d'un fichier de chanson entiere
    // tomberait hors d'un reel de quelques secondes, et l'import paraitrait
    // n'avoir rien fait.
    const fitted = fitLinesToReel(lines, { from: 0, until: 15 });
    expect(fitted.map((line) => line.text)).toEqual(['Avant']);
  });

  it('tronque une ligne a cheval sur la fin', () => {
    const fitted = fitLinesToReel(lines, { from: 10, until: 1 });
    expect(fitted).toHaveLength(1);
    expect(fitted[0]!.start + fitted[0]!.duration).toBeLessThanOrEqual(1.001);
  });

  it('ramene a zero une ligne a cheval sur le debut', () => {
    // Le reel demarre au milieu d'une ligne: elle commence a 0 et garde sa fin.
    const fitted = fitLinesToReel(lines, { from: 11, until: 10 });
    expect(fitted[0]!.text).toBe('Avant');
    expect(fitted[0]!.start).toBeCloseTo(0, 3);
    expect(fitted[0]!.duration).toBeCloseTo(1, 3);
  });
});
