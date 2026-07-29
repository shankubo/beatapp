/**
 * Les boucles generees tiennent-elles le tempo qu'elles annoncent ?
 *
 * L'enjeu n'est pas musical: le BPM affiche sert de reference a l'aimantation
 * rythmique et a la repartition des plans. Une boucle dont l'analyse renvoie le
 * double du tempo declare decalerait tout un montage sans qu'aucune erreur ne
 * soit levee.
 *
 * En test NAVIGATEUR et non unitaire: la synthese comme l'analyse ont besoin
 * d'un vrai `AudioContext`.
 */

import { describe, expect, it } from 'vitest';

import { analyzeAudio } from '@/audio/beatClient';
import { decodeAudioBlob } from '@/export/audioMix';
import { GENERATED_SAMPLES, encodeWav, renderSample } from '@/features/samples/sampleGen';

/** Boucles a tempo constant: la montee accelere par construction. */
const STEADY_SAMPLES = GENERATED_SAMPLES.filter((sample) => !sample.freeTempo);

describe('boucles generees', () => {
  it('declare un tempo et une longueur exploitables', () => {
    for (const sample of GENERATED_SAMPLES) {
      expect(sample.bpm, sample.id).toBeGreaterThanOrEqual(50);
      expect(sample.bpm, sample.id).toBeLessThanOrEqual(210);
      expect(sample.bars, sample.id).toBeGreaterThan(0);
    }
  });

  it('porte des identifiants et des cles uniques', () => {
    // Un doublon d'identifiant ferait resoudre `findGeneratedSample` sur la
    // mauvaise boucle, silencieusement.
    const ids = new Set(GENERATED_SAMPLES.map((sample) => sample.id));
    expect(ids.size).toBe(GENERATED_SAMPLES.length);
    const names = new Set(GENERATED_SAMPLES.map((sample) => sample.nameKey));
    expect(names.size).toBe(GENERATED_SAMPLES.length);
  });

  it('produit un signal audible et non sature', async () => {
    const context = new AudioContext();
    for (const sample of GENERATED_SAMPLES) {
      const buffer = renderSample(sample, context, 4);
      const data = buffer.getChannelData(0);

      let peak = 0;
      let energy = 0;
      for (const value of data) {
        peak = Math.max(peak, Math.abs(value));
        energy += value * value;
      }

      // Normalise a -3 dBFS: un pic proche de zero signalerait une boucle muette,
      // un pic au-dela de 1 un ecretage qui craquerait a l'export.
      expect(peak, sample.id).toBeGreaterThan(0.5);
      expect(peak, sample.id).toBeLessThanOrEqual(1);
      expect(Math.sqrt(energy / data.length), sample.id).toBeGreaterThan(0.01);
    }
    await context.close();
  });

  it('fait detecter le tempo declare, ou son double ou sa moitie', async () => {
    /*
      La tolerance aux rapports 2 et 1/2 est deliberee, pas un relachement.

      Choisir entre 75 et 150 BPM est une question de RESSENTI, pas de mesure:
      les deux lectures sont musicalement justes, et le projet documente deja ce
      piege du double tempo. Ce que ce test verrouille, c'est qu'aucune boucle ne
      derive vers un tempo SANS RAPPORT avec celui qu'elle annonce — la vraie
      panne, qui decalerait tout un montage.
    */
    const context = new AudioContext();

    for (const sample of STEADY_SAMPLES) {
      const rendered = renderSample(sample, context, 12);
      const blob = encodeWav(rendered);
      const buffer = await decodeAudioBlob(blob, context);
      // `useCache: false`: le cache est indexe par media, et deux boucles
      // analysees dans la meme session partageraient un resultat faux.
      const beatMap = await analyzeAudio(sample.id, buffer, { useCache: false });

      const detected = beatMap.bpm;

      const ratio = detected / sample.bpm;
      const closest = [0.5, 1, 2].reduce((best, candidate) =>
        Math.abs(ratio - candidate) < Math.abs(ratio - best) ? candidate : best,
      );
      expect(
        Math.abs(ratio - closest),
        `${sample.id}: ${sample.bpm} declare, ${detected.toFixed(1)} detecte`,
      ).toBeLessThan(0.06);
    }

    await context.close();
  });
});
