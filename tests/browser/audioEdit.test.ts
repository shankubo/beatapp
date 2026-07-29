/**
 * Le decoupage audio doit se retrouver dans le mix.
 *
 * Les tests unitaires verifient que `scheduleSegments` calcule les bons
 * evenements; ici on verifie que le mixage les JOUE reellement. `OfflineAudioContext`
 * ne se mocke pas utilement, d'ou l'execution dans un vrai navigateur.
 *
 * La methode: une source dont chaque seconde porte une amplitude differente. On
 * retire un passage, puis on relit le mix et on mesure l'amplitude a chaque
 * seconde. Si le passage retire est encore audible, la mesure le montre.
 */

import { describe, expect, it } from 'vitest';

import { mixdown, MIX_SAMPLE_RATE } from '@/export/audioMix';
import { removeRange, setTrackRange } from '@/domain/audioEdit';
import { createEmptyProject } from '@/domain/project';
import { appendClip } from '@/domain/timeline';
import type { AudioTrack, Project } from '@/domain/types';

/** Duree de la source de test, en secondes. */
const SOURCE_SECONDS = 6;

/**
 * Amplitude de la n-ieme seconde de la source.
 *
 * Les paliers sont espaces d'un FACTEUR (et non d'une constante): le limiteur de
 * sortie applique un gain de compensation multiplicatif, qu'un ecart constant ne
 * survivrait pas — deux paliers voisins finiraient par se confondre. Avec un
 * rapport de 1,6 entre paliers, l'identification reste sans ambiguite.
 */
function stepAmplitude(second: number): number {
  return 0.06 * 1.6 ** second;
}

/** Source ou chaque seconde porte une amplitude propre, identifiable. */
function makeStepBuffer(context: BaseAudioContext): AudioBuffer {
  const buffer = context.createBuffer(1, SOURCE_SECONDS * MIX_SAMPLE_RATE, MIX_SAMPLE_RATE);
  const data = buffer.getChannelData(0);

  for (let second = 0; second < SOURCE_SECONDS; second += 1) {
    const amplitude = stepAmplitude(second);
    const from = second * MIX_SAMPLE_RATE;
    for (let i = 0; i < MIX_SAMPLE_RATE; i += 1) {
      // Onde carree: l'amplitude crete est exactement `amplitude`, ce qui rend la
      // mesure triviale et insensible a la phase.
      data[from + i] = i % 100 < 50 ? amplitude : -amplitude;
    }
  }

  return buffer;
}

/** Amplitude crete de la seconde `second` du mix. */
function peakAtSecond(buffer: AudioBuffer, second: number): number {
  const data = buffer.getChannelData(0);
  const from = Math.floor(second * buffer.sampleRate);
  const to = Math.min(data.length, Math.floor((second + 1) * buffer.sampleRate));

  let peak = 0;
  // On evite les 20 premieres millisecondes: le limiteur de sortie a un temps
  // d'attaque, et les toutes premieres cretes sont donc atypiques.
  const skip = Math.floor(0.02 * buffer.sampleRate);
  for (let i = from + skip; i < to; i += 1) {
    peak = Math.max(peak, Math.abs(data[i]!));
  }
  return peak;
}

/**
 * Numero de la seconde SOURCE entendue a la seconde `second` du mix.
 *
 * On n'identifie PAS le palier par son amplitude absolue: le limiteur de sortie
 * applique un gain de compensation (mesure: environ +10 %) qui n'a rien a voir
 * avec le montage. On compare donc en echelle logarithmique, ou un gain
 * multiplicatif se traduit par un simple decalage, et on tolere jusqu'a la moitie
 * d'un ecart entre paliers.
 *
 * Renvoie -1 quand la seconde est silencieuse.
 */
function sourceSecondHeardAt(buffer: AudioBuffer, second: number): number {
  const peak = peakAtSecond(buffer, second);
  // Seuil bien sous le premier palier (0,06): distingue le silence d'un signal.
  if (peak < 0.015) return -1;

  let best = 0;
  let bestDistance = Infinity;
  for (let candidate = 0; candidate < SOURCE_SECONDS; candidate += 1) {
    const distance = Math.abs(Math.log(peak / stepAmplitude(candidate)));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  // Au-dela de la moitie d'un ecart entre paliers, on ne reconnait rien: mieux
  // vaut echouer bruyamment que renvoyer un palier arbitraire.
  return bestDistance < Math.log(1.6) / 2 ? best : -2;
}

/** Projet d'une duree video donnee, avec une piste musicale. */
function projectWithAudio(track: AudioTrack, videoSeconds: number): Project {
  let project = createEmptyProject('Audio');

  project = {
    ...project,
    assets: {
      asset_audio: {
        id: 'asset_audio',
        kind: 'audio',
        name: 'steps.wav',
        mimeType: 'audio/wav',
        bytes: 1024,
        storage: { backend: 'idb', key: 'steps.bin' },
        duration: SOURCE_SECONDS,
        createdAt: Date.now(),
      },
      asset_image: {
        id: 'asset_image',
        kind: 'image',
        name: 'flat.png',
        mimeType: 'image/png',
        bytes: 512,
        storage: { backend: 'idb', key: 'flat.bin' },
        width: 100,
        height: 100,
        createdAt: Date.now(),
      },
    },
    audioTracks: [track],
  };

  // La duree exportee vient de la video: il faut donc un clip assez long.
  return {
    ...project,
    videoTrack: appendClip(
      project.videoTrack,
      {
        id: 'clip_1',
        assetId: 'asset_image',
        start: 0,
        duration: videoSeconds,
        fit: 'cover',
        transform: { scale: 1, x: 0, y: 0, rotation: 0 },
        muted: false,
      },
      project.frame.fps,
    ),
  };
}

function baseTrack(): AudioTrack {
  return {
    id: 'atrack_1',
    kind: 'audio',
    assetId: 'asset_audio',
    role: 'music',
    start: 0,
    source: { in: 0, out: SOURCE_SECONDS },
    gain: 1,
    muted: false,
    fadeIn: 0,
    fadeOut: 0,
  };
}

describe('decoupage audio dans le mix', () => {
  it('joue la source complete sans decoupage', async () => {
    const context = new AudioContext();
    const buffer = makeStepBuffer(context);
    const project = projectWithAudio(baseTrack(), SOURCE_SECONDS);

    const mixed = await mixdown(project, new Map([['asset_audio', buffer]]), SOURCE_SECONDS);
    expect(mixed).not.toBeNull();

    // Chaque seconde du mix correspond a la meme seconde de la source.
    const heard = Array.from({ length: SOURCE_SECONDS }, (_, second) =>
      sourceSecondHeardAt(mixed!, second),
    );
    expect(heard).toEqual([0, 1, 2, 3, 4, 5]);

    void context.close();
  });

  it('retire reellement le passage coupe', async () => {
    const context = new AudioContext();
    const buffer = makeStepBuffer(context);

    // On retire [2, 4]: les secondes d'amplitude 0,3 et 0,4 doivent disparaitre,
    // et les suivantes (0,5 puis 0,6) doivent AVANCER pour prendre leur place.
    const track = removeRange(baseTrack(), 2, 4, SOURCE_SECONDS);
    const project = projectWithAudio(track, 4);

    const mixed = await mixdown(project, new Map([['asset_audio', buffer]]), 4);
    expect(mixed).not.toBeNull();

    const heard = Array.from({ length: 4 }, (_, second) =>
      sourceSecondHeardAt(mixed!, second),
    );

    // C'est le coeur du test: les secondes 2 et 3 de la source ont disparu, et
    // les secondes 4 et 5 ont AVANCE pour prendre leur place. Si le montage etait
    // ignore, on entendrait [0, 1, 2, 3].
    expect(heard).toEqual([0, 1, 4, 5]);

    void context.close();
  });

  it('respecte les bornes de debut et de fin', async () => {
    const context = new AudioContext();
    const buffer = makeStepBuffer(context);

    // On garde [3, 6]: le mix doit commencer a l'amplitude 0,4.
    const track = setTrackRange(baseTrack(), { in: 3, out: SOURCE_SECONDS }, SOURCE_SECONDS);
    const project = projectWithAudio(track, 3);

    const mixed = await mixdown(project, new Map([['asset_audio', buffer]]), 3);
    // La lecture demarre a la seconde 3 de la source, pas au debut.
    expect(sourceSecondHeardAt(mixed!, 0)).toBe(3);
    expect(sourceSecondHeardAt(mixed!, 1)).toBe(4);

    void context.close();
  });

  it('decale la musique selon le calage manuel', async () => {
    const context = new AudioContext();
    const buffer = makeStepBuffer(context);

    // Musique decalee d'une seconde: la premiere seconde du reel est silencieuse.
    const track = { ...baseTrack(), start: 1 };
    const project = projectWithAudio(track, 4);

    const mixed = await mixdown(project, new Map([['asset_audio', buffer]]), 4);
    // -1 = silence: la musique n'a pas encore commence.
    expect(sourceSecondHeardAt(mixed!, 0)).toBe(-1);
    expect(sourceSecondHeardAt(mixed!, 1)).toBe(0);

    void context.close();
  });
});
