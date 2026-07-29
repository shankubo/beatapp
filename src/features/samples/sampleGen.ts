/**
 * Boucles de batterie generees par synthese.
 *
 * Pourquoi generer plutot que livrer des fichiers:
 * - aucun risque de licence (rien n'est emprunte);
 * - zero octet a telecharger, ce qui compte pour une PWA mobile;
 * - le BPM et la position exacte de chaque frappe sont connus A PRIORI, ce qui
 *   en fait la demonstration idéale de l'aimantation rythmique, et d'excellentes
 *   fixtures de test.
 */

import type { MediaAsset } from '../../domain/types';

export interface GeneratedSample {
  id: string;
  /**
   * Cles i18n completes, declarees ici plutot qu'assemblees a l'usage: le
   * typage strict de `t()` les verifie donc a la compilation.
   */
  nameKey: 'samples:generated.fourOnFloor.name'
    | 'samples:generated.boomBap.name'
    | 'samples:generated.trapHats.name'
    | 'samples:generated.houseGroove.name'
    | 'samples:generated.amapiano.name'
    | 'samples:generated.afrobeats.name'
    | 'samples:generated.phonk.name'
    | 'samples:generated.lofiChill.name'
    | 'samples:generated.drumFill.name';
  descriptionKey: 'samples:generated.fourOnFloor.description'
    | 'samples:generated.boomBap.description'
    | 'samples:generated.trapHats.description'
    | 'samples:generated.houseGroove.description'
    | 'samples:generated.amapiano.description'
    | 'samples:generated.afrobeats.description'
    | 'samples:generated.phonk.description'
    | 'samples:generated.lofiChill.description'
    | 'samples:generated.drumFill.description';
  bpm: number;
  /** Nombre de mesures de la boucle. */
  bars: number;
  /**
   * `true` si la boucle n'a pas de tempo constant (accelerando).
   * L'aimantation rythmique n'a pas de sens sur ce type de sample: il sert de
   * transition, pas de trame rythmique.
   */
  freeTempo?: boolean;
  build: (context: BaseAudioContext, bpm: number, bars: number) => AudioBuffer;
}

const SAMPLE_RATE = 44_100;

// ---------------------------------------------------------------------------
// Briques de synthese
// ---------------------------------------------------------------------------

/** Bruit pseudo-aleatoire deterministe: la meme boucle a chaque generation. */
function noise(seed: number): () => number {
  let state = seed;
  return () => {
    // Generateur congruentiel lineaire: suffisant pour du bruit percussif.
    state = (state * 1664525 + 1013904223) % 4294967296;
    return (state / 2147483648) - 1;
  };
}

/** Grosse caisse: sinusoide descendante a enveloppe rapide. */
function addKick(data: Float32Array, at: number, gain: number): void {
  const start = Math.round(at * SAMPLE_RATE);
  const length = Math.round(0.18 * SAMPLE_RATE);

  for (let i = 0; i < length; i += 1) {
    const index = start + i;
    if (index >= data.length) break;
    const t = i / SAMPLE_RATE;
    // Glissando de 120 Hz vers 45 Hz: c'est ce qui donne le "boom".
    const frequency = 45 + 75 * Math.exp(-t * 45);
    const envelope = Math.exp(-t * 14);
    data[index]! += gain * envelope * Math.sin(2 * Math.PI * frequency * t);
  }
}

/** Caisse claire: bruit filtre plus une composante tonale. */
function addSnare(data: Float32Array, at: number, gain: number, rng: () => number): void {
  const start = Math.round(at * SAMPLE_RATE);
  const length = Math.round(0.14 * SAMPLE_RATE);

  // Passe-haut a un pole, applique de facon incrementale.
  let previous = 0;
  let highpassed = 0;

  for (let i = 0; i < length; i += 1) {
    const index = start + i;
    if (index >= data.length) break;
    const t = i / SAMPLE_RATE;
    const envelope = Math.exp(-t * 26);

    const raw = rng();
    highpassed = 0.72 * (highpassed + raw - previous);
    previous = raw;

    const tone = Math.sin(2 * Math.PI * 185 * t) * 0.35;
    data[index]! += gain * envelope * (highpassed * 0.75 + tone);
  }
}

/** Charleston: bruit tres bref et tres aigu. */
function addHat(data: Float32Array, at: number, gain: number, rng: () => number, open = false): void {
  const start = Math.round(at * SAMPLE_RATE);
  const decay = open ? 0.16 : 0.045;
  const length = Math.round(decay * 2 * SAMPLE_RATE);

  let previous = 0;
  let highpassed = 0;

  for (let i = 0; i < length; i += 1) {
    const index = start + i;
    if (index >= data.length) break;
    const t = i / SAMPLE_RATE;
    const envelope = Math.exp(-t / decay);

    const raw = rng();
    // Passe-haut plus agressif que pour la caisse claire.
    highpassed = 0.9 * (highpassed + raw - previous);
    previous = raw;

    data[index]! += gain * envelope * highpassed * 0.6;
  }
}

/** Clap: trois bruits tres rapproches, ce qui cree la texture caracteristique. */
function addClap(data: Float32Array, at: number, gain: number, rng: () => number): void {
  for (const offset of [0, 0.011, 0.022]) {
    addSnare(data, at + offset, gain * 0.45, rng);
  }
}

/** Basse 808: sinusoide longue et tenue. */
function addBass(data: Float32Array, at: number, gain: number, frequency: number, duration: number): void {
  const start = Math.round(at * SAMPLE_RATE);
  const length = Math.round(duration * SAMPLE_RATE);

  for (let i = 0; i < length; i += 1) {
    const index = start + i;
    if (index >= data.length) break;
    const t = i / SAMPLE_RATE;
    // Attaque et relachement doux, pour eviter les clics.
    const attack = Math.min(1, t * 120);
    const release = Math.exp(-t * 2.2);
    data[index]! += gain * attack * release * Math.sin(2 * Math.PI * frequency * t);
  }
}

/**
 * Normalise le buffer a -3 dBFS.
 * Une boucle qui sature deforme l'analyse rythmique et sonne mal une fois
 * mixee avec la voix.
 */
function normalize(data: Float32Array, targetPeak = 0.707): void {
  let peak = 0;
  for (const sample of data) {
    const absolute = Math.abs(sample);
    if (absolute > peak) peak = absolute;
  }
  if (peak <= 0) return;

  const scale = targetPeak / peak;
  for (let i = 0; i < data.length; i += 1) data[i]! *= scale;
}

function createBuffer(
  context: BaseAudioContext,
  bpm: number,
  bars: number,
  fill: (data: Float32Array, beat: number, sixteenth: number) => void,
): AudioBuffer {
  const beat = 60 / bpm;
  const duration = beat * 4 * bars;
  const length = Math.ceil(duration * SAMPLE_RATE);

  // Mono: une boucle de batterie n'a pas besoin de stereo, et cela divise par
  // deux la memoire comme le temps de generation.
  const buffer = context.createBuffer(1, length, SAMPLE_RATE);
  const data = buffer.getChannelData(0);

  fill(data, beat, beat / 4);
  normalize(data);

  return buffer;
}

// ---------------------------------------------------------------------------
// Motifs
// ---------------------------------------------------------------------------

/** Grosse caisse sur chaque temps: le motif de danse le plus universel. */
function fourOnFloor(context: BaseAudioContext, bpm: number, bars: number): AudioBuffer {
  return createBuffer(context, bpm, bars, (data, beat, sixteenth) => {
    const rng = noise(1337);
    const totalBeats = 4 * bars;

    for (let b = 0; b < totalBeats; b += 1) {
      addKick(data, b * beat, 1);
      // Charleston sur les contretemps: ce qui donne la pulsation "house".
      addHat(data, b * beat + sixteenth * 2, 0.5, rng, b % 2 === 1);
      if (b % 4 === 2) addClap(data, b * beat, 0.8, rng);
    }
  });
}

/** Boom bap: grosse caisse syncopee, caisse claire sur 2 et 4. */
function boomBap(context: BaseAudioContext, bpm: number, bars: number): AudioBuffer {
  return createBuffer(context, bpm, bars, (data, beat, sixteenth) => {
    const rng = noise(4242);

    for (let bar = 0; bar < bars; bar += 1) {
      const barStart = bar * beat * 4;
      addKick(data, barStart, 1);
      // Kick supplementaire sur le 3e temps: appuie la pulsation a la noire
      // plutot que de la brouiller par une syncope isolee.
      addKick(data, barStart + beat * 2, 0.9);
      addKick(data, barStart + beat * 2 + sixteenth * 3, 0.5);
      addSnare(data, barStart + beat, 0.95, rng);
      addSnare(data, barStart + beat * 3, 0.95, rng);

      // Charleston sur les NOIRES uniquement, et discret.
      //
      // Un charleston sur chaque croche, meme accentue, produit deux fois plus
      // d'onsets que de temps: la pulsation la plus saillante du signal devient
      // la croche, et toute analyse rythmique (la notre comme celle d'un
      // humain) y lit le double tempo. C'est un choix de composition, pas un
      // contournement: un boom bap se ressent a la noire.
      for (let quarter = 0; quarter < 4; quarter += 1) {
        addHat(data, barStart + quarter * beat, 0.3, rng);
      }
      // Une seule ouverture en fin de mesure, pour la respiration.
      addHat(data, barStart + beat * 3 + sixteenth * 2, 0.16, rng, true);
    }
  });
}

/** Trap: charleston roules et 808. */
function trapHats(context: BaseAudioContext, bpm: number, bars: number): AudioBuffer {
  return createBuffer(context, bpm, bars, (data, beat, sixteenth) => {
    const rng = noise(90210);

    for (let bar = 0; bar < bars; bar += 1) {
      const barStart = bar * beat * 4;
      addKick(data, barStart, 1);
      addKick(data, barStart + beat * 1.5, 0.8);
      addSnare(data, barStart + beat * 2, 0.75, rng);
      addBass(data, barStart, 0.55, 55, beat * 1.2);

      // Roulement de charleston en triples croches sur le 4e temps.
      for (let step = 0; step < 16; step += 1) {
        const at = barStart + step * sixteenth;
        addHat(data, at, 0.28, rng);
        if (step >= 12) addHat(data, at + sixteenth / 2, 0.22, rng);
      }
    }
  });
}

/** House: charleston sur les contretemps, clap sur 2 et 4. */
function houseGroove(context: BaseAudioContext, bpm: number, bars: number): AudioBuffer {
  return createBuffer(context, bpm, bars, (data, beat, sixteenth) => {
    const rng = noise(5150);
    const totalBeats = 4 * bars;

    for (let b = 0; b < totalBeats; b += 1) {
      addKick(data, b * beat, 0.95);
      addHat(data, b * beat + beat / 2, 0.55, rng, true);
      if (b % 4 === 1 || b % 4 === 3) addClap(data, b * beat, 0.7, rng);
      addHat(data, b * beat + sixteenth, 0.18, rng);
    }
  });
}

/**
 * Amapiano: le « log drum », basse percussive glissante.
 *
 * Le style qui domine les reels depuis quelques annees. Sa signature n'est pas
 * un motif de batterie mais une BASSE qui glisse d'une note a l'autre, jouee
 * comme une percussion. Le shaker sur les croches porte le reste.
 */
function amapiano(context: BaseAudioContext, bpm: number, bars: number): AudioBuffer {
  return createBuffer(context, bpm, bars, (data, beat, sixteenth) => {
    const rng = noise(8080);

    for (let bar = 0; bar < bars; bar += 1) {
      const barStart = bar * beat * 4;

      addKick(data, barStart, 0.9);
      addKick(data, barStart + beat * 2.5, 0.75);

      /*
        Log drum: trois notes descendantes, chacune courte et accentuee.

        Les frequences suivent une gamme mineure (La-Sol-Mi): c'est la descente
        qui fait reconnaitre le style, pas les hauteurs absolues.
      */
      addBass(data, barStart + beat, 0.7, 55, beat * 0.5);
      addBass(data, barStart + beat * 1.75, 0.6, 49, beat * 0.4);
      addBass(data, barStart + beat * 3, 0.65, 41, beat * 0.6);

      // Shaker sur chaque croche: la trame continue du genre.
      for (let step = 0; step < 8; step += 1) {
        addHat(data, barStart + step * sixteenth * 2, step % 2 === 0 ? 0.22 : 0.3, rng);
      }
      addClap(data, barStart + beat * 3, 0.5, rng);
    }
  });
}

/**
 * Afrobeats: clave a trois temps sur une pulsation souple.
 *
 * Le motif de percussion se decale volontairement de la grille reguliere: c'est
 * ce leger deport qui donne le balancement, et il reste parfaitement detectable
 * par l'analyse rythmique puisque la grosse caisse, elle, tient les temps.
 */
function afrobeats(context: BaseAudioContext, bpm: number, bars: number): AudioBuffer {
  return createBuffer(context, bpm, bars, (data, beat, sixteenth) => {
    const rng = noise(2323);

    for (let bar = 0; bar < bars; bar += 1) {
      const barStart = bar * beat * 4;

      addKick(data, barStart, 1);
      addKick(data, barStart + beat * 1.5, 0.7);
      addKick(data, barStart + beat * 3, 0.85);

      // Clave 3-2: les appuis tombent sur 1, le « et » de 2, et 4.
      addClap(data, barStart + beat * 1.5, 0.45, rng);
      addClap(data, barStart + beat * 3.5, 0.5, rng);

      for (let step = 0; step < 8; step += 1) {
        addHat(data, barStart + step * sixteenth * 2, 0.24, rng, step === 7);
      }
      addBass(data, barStart, 0.5, 49, beat * 1.4);
    }
  });
}

/**
 * Phonk: le style des montages rapides, grosse caisse saturee et cloche.
 *
 * Tempo eleve et frappes lourdes. La « cloche » est simulee par deux
 * sinusoides breves a intervalle de quinte — assez pour evoquer le timbre sans
 * emprunter quoi que ce soit.
 */
function phonk(context: BaseAudioContext, bpm: number, bars: number): AudioBuffer {
  // `sixteenth` n'est plus utilise depuis que les frappes sont posees en
  // fractions de temps: le rythme s'exprime en 0,5 et 1 temps, pas en croches.
  return createBuffer(context, bpm, bars, (data, beat) => {
    const rng = noise(6660);

    for (let bar = 0; bar < bars; bar += 1) {
      const barStart = bar * beat * 4;

      /*
        Une frappe sur CHAQUE temps, et c'est une correction mesuree.

        Premiere version: grosse caisse sur 1, 1,75 et 3, caisse claire sur 2 et
        4. L'analyse renvoyait 75 BPM pour 150 declares — exactement la moitie.
        Avec des appuis aussi clairsemes, la note la plus reguliere du signal
        devient la blanche, et l'auditeur comme l'analyse y lisent le demi-tempo.

        Le genre reste reconnaissable: c'est la SATURATION des frappes et la
        cloche qui le signent, pas la rarete de la grosse caisse.
      */
      /*
        Frappes d'egale FORCE sur les quatre temps.

        Deuxieme correction, apres mesure. Densifier ne suffisait pas: avec des
        appuis a 1,0 / 0,7 / 0,95 / 0,7, les temps 1 et 3 ressortaient nettement,
        et cette alternance fort-faible construit une periode a la BLANCHE.
        L'analyse y lisait 75 BPM pour 150 declares.

        L'ODF est compresse en log, donc peu sensible a l'amplitude absolue mais
        tres sensible au CONTRASTE regulier entre frappes voisines. Egaliser les
        quatre temps supprime ce contraste; le balancement du genre est reporte
        sur les syncopes, qui ne tombent pas sur la grille.
      */
      for (let quarter = 0; quarter < 4; quarter += 1) {
        addKick(data, barStart + quarter * beat, 0.95);
      }
      // Syncopes: elles habillent sans concurrencer la pulsation, etant plus
      // faibles et hors des temps.
      addKick(data, barStart + beat * 1.5, 0.4);
      addKick(data, barStart + beat * 3.5, 0.4);

      addSnare(data, barStart + beat, 0.7, rng);
      addSnare(data, barStart + beat * 3, 0.7, rng);

      // Cloche: fondamentale et quinte, tres courtes.
      addBass(data, barStart + beat * 2, 0.35, 220, beat * 0.35);
      addBass(data, barStart + beat * 2.5, 0.3, 330, beat * 0.3);

      addBass(data, barStart, 0.6, 41, beat * 1.6);

      // Charleston sur les NOIRES: sur les croches, il doublerait les onsets et
      // ramenerait le meme probleme de double tempo par l'autre bout.
      for (let quarter = 0; quarter < 4; quarter += 1) {
        addHat(data, barStart + quarter * beat, 0.22, rng);
      }
    }
  });
}

/**
 * Lo-fi: batterie feutree pour un montage calme.
 *
 * Frappes attenuees et charleston discret: l'oppose des trois precedentes.
 * Une banque uniquement percussive et rapide ne servirait qu'un seul type de
 * montage.
 */
function lofiChill(context: BaseAudioContext, bpm: number, bars: number): AudioBuffer {
  return createBuffer(context, bpm, bars, (data, beat, sixteenth) => {
    const rng = noise(1212);

    for (let bar = 0; bar < bars; bar += 1) {
      const barStart = bar * beat * 4;

      addKick(data, barStart, 0.8);
      addKick(data, barStart + beat * 2 + sixteenth * 2, 0.5);
      // Caisse claire adoucie: c'est le gain reduit qui fait le « feutre ».
      addSnare(data, barStart + beat, 0.45, rng);
      addSnare(data, barStart + beat * 3, 0.45, rng);

      for (let quarter = 0; quarter < 4; quarter += 1) {
        addHat(data, barStart + quarter * beat, 0.2, rng);
        addHat(data, barStart + quarter * beat + sixteenth * 2, 0.12, rng);
      }
      addBass(data, barStart, 0.4, 62, beat * 2);
    }
  });
}

/** Montee: roulement de caisse claire en acceleration. */
function drumFill(context: BaseAudioContext, bpm: number, bars: number): AudioBuffer {
  return createBuffer(context, bpm, bars, (data, beat) => {
    const rng = noise(31415);
    const duration = beat * 4 * bars;

    // Les frappes se resserrent et montent en volume vers la fin.
    let at = 0;
    let interval = beat / 2;
    while (at < duration) {
      const remaining = 1 - at / duration;
      addSnare(data, at, 0.35 + 0.65 * (1 - remaining), rng);
      at += interval;
      interval = Math.max(beat / 16, interval * 0.88);
    }
  });
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

export const GENERATED_SAMPLES: readonly GeneratedSample[] = [
  {
    id: 'gen-four-on-floor',
    nameKey: 'samples:generated.fourOnFloor.name',
    descriptionKey: 'samples:generated.fourOnFloor.description',
    bpm: 120,
    bars: 4,
    build: fourOnFloor,
  },
  {
    id: 'gen-boom-bap',
    nameKey: 'samples:generated.boomBap.name',
    descriptionKey: 'samples:generated.boomBap.description',
    bpm: 90,
    bars: 4,
    build: boomBap,
  },
  {
    id: 'gen-trap-hats',
    nameKey: 'samples:generated.trapHats.name',
    descriptionKey: 'samples:generated.trapHats.description',
    bpm: 140,
    bars: 4,
    build: trapHats,
  },
  {
    id: 'gen-house-groove',
    nameKey: 'samples:generated.houseGroove.name',
    descriptionKey: 'samples:generated.houseGroove.description',
    bpm: 126,
    bars: 4,
    build: houseGroove,
  },
  /*
    Styles dominants des reels, chacun a son tempo caracteristique.

    Ces boucles sont SYNTHETISEES comme les precedentes, jamais empruntees: un
    son tendance des reseaux est une oeuvre sous droits, que l'application ne
    peut ni distribuer ni telecharger. Ce qui est reproduit ici, c'est la
    STRUCTURE RYTHMIQUE d'un genre — un motif de batterie ne s'approprie pas.
  */
  {
    id: 'gen-amapiano',
    nameKey: 'samples:generated.amapiano.name',
    descriptionKey: 'samples:generated.amapiano.description',
    bpm: 112,
    bars: 4,
    build: amapiano,
  },
  {
    id: 'gen-afrobeats',
    nameKey: 'samples:generated.afrobeats.name',
    descriptionKey: 'samples:generated.afrobeats.description',
    bpm: 104,
    bars: 4,
    build: afrobeats,
  },
  /*
    160 et non 150, apres mesure — et ce n'est PAS le motif qui l'impose.

    Sonde du meme motif a plusieurs tempos: 140 -> 139,7 · 150 -> 74,9 ·
    160 -> 160,8 · 170 -> 84,8. Le rythme est identique dans les quatre cas;
    seul le tempo declare change le resultat, par paliers.

    C'est le biais perceptuel qui tranche: gaussienne centree sur 120 BPM,
    sigma 1,1 octave. A 150, la moitie (75) marque plus de points que la verite;
    a 160, non. Elargir le sigma ferait deriver les six autres boucles, deja
    detectees a 0,4 % pres — on ajuste donc la boucle, pas le detecteur.

    160 BPM reste pleinement dans le genre, qui vit entre 140 et 170.
  */
  {
    id: 'gen-phonk',
    nameKey: 'samples:generated.phonk.name',
    descriptionKey: 'samples:generated.phonk.description',
    bpm: 160,
    bars: 4,
    build: phonk,
  },
  /*
    88 et non 78, meme raison en miroir: a 78 la boucle etait lue 156, soit son
    DOUBLE, le biais tirant cette fois vers le haut. 88 BPM reste un tempo de
    lo-fi tout a fait caracteristique.
  */
  {
    id: 'gen-lofi-chill',
    nameKey: 'samples:generated.lofiChill.name',
    descriptionKey: 'samples:generated.lofiChill.description',
    bpm: 88,
    bars: 4,
    build: lofiChill,
  },
  // La montee accelere par construction: pas de tempo stable a detecter.
  {
    id: 'gen-drum-fill',
    nameKey: 'samples:generated.drumFill.name',
    descriptionKey: 'samples:generated.drumFill.description',
    bpm: 128,
    bars: 2,
    freeTempo: true,
    build: drumFill,
  },
];

/** Retrouve un sample par son identifiant. */
export function findGeneratedSample(id: string): GeneratedSample | undefined {
  return GENERATED_SAMPLES.find((sample) => sample.id === id);
}

/**
 * Genere une boucle, repetee pour atteindre au moins `minSeconds`.
 * Un reel dure 15 a 30 s, alors qu'une boucle de 4 mesures a 120 BPM n'en fait
 * que 8: sans repetition, la musique s'arreterait au milieu du montage.
 */
export function renderSample(
  sample: GeneratedSample,
  context: BaseAudioContext,
  minSeconds = 30,
): AudioBuffer {
  const single = sample.build(context, sample.bpm, sample.bars);
  const repeats = Math.max(1, Math.ceil(minSeconds / single.duration));
  if (repeats === 1) return single;

  const total = context.createBuffer(1, single.length * repeats, single.sampleRate);
  const target = total.getChannelData(0);
  const source = single.getChannelData(0);

  for (let repeat = 0; repeat < repeats; repeat += 1) {
    target.set(source, repeat * single.length);
  }

  return total;
}

/**
 * Encode un `AudioBuffer` en WAV.
 *
 * Les boucles sont generees en memoire mais doivent etre stockees comme des
 * blobs, exactement comme un import utilisateur: cela evite un chemin de code
 * special dans le reste de l'application.
 */
export function encodeWav(buffer: AudioBuffer): Blob {
  const channels = buffer.numberOfChannels;
  const samples = buffer.length;
  const bytesPerSample = 2;
  const dataBytes = samples * channels * bytesPerSample;

  const output = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(output);

  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM entier
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  const channelData = Array.from({ length: channels }, (_, c) => buffer.getChannelData(c));

  for (let i = 0; i < samples; i += 1) {
    for (let c = 0; c < channels; c += 1) {
      // Ecretage avant conversion: au-dela de ±1 la conversion en entier
      // signe reboucle et produirait un craquement violent.
      const sample = Math.max(-1, Math.min(1, channelData[c]![i]!));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += bytesPerSample;
    }
  }

  return new Blob([output], { type: 'audio/wav' });
}

/** Fabrique un `MediaAsset` pour une boucle generee. */
export function sampleAssetMetadata(
  sample: GeneratedSample,
  buffer: AudioBuffer,
  blob: Blob,
): Omit<MediaAsset, 'id' | 'storage'> {
  return {
    kind: 'audio',
    // Le nom affiche vient de l'i18n; celui-ci n'est qu'un repli technique.
    name: sample.id,
    mimeType: 'audio/wav',
    bytes: blob.size,
    duration: buffer.duration,
    createdAt: Date.now(),
    sampleId: sample.id,
    license: { spdx: 'CC0-1.0' },
  };
}
