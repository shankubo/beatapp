/**
 * Detection de la plateforme, pour ouvrir la bonne procedure d'installation.
 *
 * Module PUR: la chaine d'agent utilisateur est passee en argument, jamais lue
 * depuis `navigator` ici — c'est ce qui rend la fonction testable.
 *
 * Sert UNIQUEMENT a preselectionner un onglet. Aucune fonctionnalite n'en
 * depend, et les trois procedures restent accessibles: se tromper d'onglet est
 * sans consequence, ce qui autorise une heuristique simple la ou une detection
 * fiable n'existe pas.
 */

export type Platform = 'ios' | 'android' | 'desktop';

/**
 * Devine la plateforme a partir de l'agent utilisateur.
 *
 * Piege connu: depuis iPadOS 13, l'iPad annonce « Macintosh » et se distingue
 * d'un Mac par la presence du tactile. Sans ce rattrapage, un iPad recevrait la
 * procedure « ordinateur », qui ne correspond a rien sur Safari iPad.
 */
export function detectPlatform(
  userAgent: string,
  maxTouchPoints: number = typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints,
): Platform {
  const ua = userAgent.toLowerCase();

  if (/iphone|ipod|ipad/.test(ua)) return 'ios';
  // iPad moderne: « Macintosh » + un ecran tactile.
  if (ua.includes('macintosh') && maxTouchPoints > 1) return 'ios';
  if (ua.includes('android')) return 'android';

  return 'desktop';
}
