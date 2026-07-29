/**
 * Formatage sensible a la locale. Le francais ecrit "00:03,4" (virgule
 * decimale), l'anglais "00:03.4" — d'ou le passage par Intl plutot qu'une
 * concatenation manuelle.
 */

/**
 * Espace insecable, en sequence d'echappement.
 *
 * La typographie francaise impose un espace insecable avant une unite, et cela
 * evite qu'un « s » solitaire passe a la ligne. On l'ecrit echappe plutot qu'en
 * litteral: un caractere invisible dans le code est invisible en relecture.
 */
const NBSP = '\u00a0';

function decimalSeparator(locale: string): string {
  return (
    new Intl.NumberFormat(locale)
      .formatToParts(1.1)
      .find((part) => part.type === 'decimal')?.value ?? '.'
  );
}

/** `mm:ss,d` — la forme compacte affichee sous l'apercu. */
export function formatTimecode(seconds: number, locale: string): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const totalTenths = Math.floor(safe * 10);
  const minutes = Math.floor(totalTenths / 600);
  const secs = Math.floor((totalTenths % 600) / 10);
  const tenths = totalTenths % 10;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(minutes)}:${pad(secs)}${decimalSeparator(locale)}${tenths}`;
}

/** Duree lisible, pour les resumes: "12,4 s". */
export function formatDuration(seconds: number, locale: string): string {
  const value = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(Math.max(0, seconds));
  return `${value}${NBSP}s`;
}

/**
 * Duree en unites LISIBLES: « 90 s », « 10 min », « 12 h ».
 *
 * Distincte de `formatDuration`, qui vise la precision d'un montage (« 12,4 s »).
 * Ici on decrit une limite publiee, ou la precision n'a aucun sens: « 1,5 min »
 * se lit mal alors que « 1 min 30 s » se comprend d'un coup.
 *
 * Les symboles d'unite ne sont pas traduits: `s`, `min` et `h` sont les symboles
 * du systeme international, identiques en francais et en anglais.
 */
export function formatDurationLimit(seconds: number, locale: string): string {
  const total = Math.max(0, Math.round(seconds));
  const number = (value: number) => formatInteger(value, locale);

  if (total < 60) return `${number(total)}${NBSP}s`;

  if (total < 3600) {
    const minutes = Math.floor(total / 60);
    const rest = total % 60;
    return rest === 0
      ? `${number(minutes)}${NBSP}min`
      : `${number(minutes)}${NBSP}min${NBSP}${number(rest)}${NBSP}s`;
  }

  const hours = Math.floor(total / 3600);
  const restMinutes = Math.floor((total % 3600) / 60);
  return restMinutes === 0
    ? `${number(hours)}${NBSP}h`
    : `${number(hours)}${NBSP}h${NBSP}${number(restMinutes)}${NBSP}min`;
}

/**
 * Angle en degres: « 0° », « 90° », « -12° ».
 *
 * Le symbole « ° » se colle au nombre, sans espace: c'est la convention
 * typographique en francais comme en anglais, contrairement aux unites du
 * systeme international (« 90 s ») qui en prennent une.
 *
 * Arrondi a l'entier: le dixieme de degre n'a aucun sens visuel sur une image,
 * et ferait vibrer l'affichage sous le doigt pendant un glissement.
 */
export function formatDegrees(degrees: number, locale: string): string {
  const value = Number.isFinite(degrees) ? Math.round(degrees) : 0;
  // `Object.is` distingue -0 de 0: sans cela, une inclinaison ramenee a zero par
  // la gauche afficherait « -0° ».
  return `${formatInteger(Object.is(value, -0) ? 0 : value, locale)}°`;
}

export function formatBytes(bytes: number, locale: string): string {
  const table = locale.startsWith('fr')
    ? ['o', 'ko', 'Mo', 'Go']
    : ['B', 'kB', 'MB', 'GB'];

  let value = Math.max(0, bytes);
  let unitIndex = 0;
  while (value >= 1000 && unitIndex < table.length - 1) {
    value /= 1000;
    unitIndex += 1;
  }

  const formatted = new Intl.NumberFormat(locale, {
    maximumFractionDigits: value < 10 && unitIndex > 0 ? 1 : 0,
  }).format(value);
  return `${formatted}${NBSP}${table[unitIndex]}`;
}

export function formatPercent(fraction: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: 0,
  }).format(Math.max(0, Math.min(1, fraction)));
}

export function formatInteger(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
}

/**
 * Vitesse de lecture, sous la forme « 1x », « 0,5x ».
 *
 * Le separateur decimal vient de la locale (0,5 en francais, 0.5 en anglais);
 * seul le « x » est litteral, et c'est un symbole universel qui n'a pas a etre
 * traduit. `maximumFractionDigits: 2` couvre 0,25 sans afficher « 1,00 » pour la
 * vitesse normale.
 */
export function formatRate(rate: number, locale: string): string {
  const value = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(rate);
  return `${value}x`;
}
