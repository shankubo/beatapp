/**
 * URL de vignette pour un media, image ou video.
 *
 * Pour une image, l'URL est celle du blob. Pour une video, on decode une frame
 * (`extractVideoThumbnail`) puis on sert l'URL de cette frame: un element
 * `<video>` seul reste noir sur mobile tant que la lecture n'a pas demarre.
 *
 * Les frames decodees sont mises en cache par blob pour toute la duree de la
 * session: sans cela, chaque ouverture du panneau Media redecoderait toutes les
 * videos de la bibliotheque.
 */

import { useEffect, useState } from 'react';

import { extractVideoThumbnail } from './videoThumbnail';
import { useObjectUrl } from '../../hooks/useObjectUrl';
import type { MediaKind } from '../../domain/types';

/**
 * Cache des vignettes deja decodees, clef par blob.
 *
 * `WeakMap`: quand le blob n'est plus reference nulle part, son entree
 * disparait avec lui — un cache par identifiant fuirait a chaque suppression.
 */
const CACHE = new WeakMap<Blob, Blob>();

/** Blobs dont le decodage a echoue: on ne retente pas a chaque rendu. */
const FAILED = new WeakSet<Blob>();

export function useThumbnail(
  blob: Blob | undefined,
  /**
   * Type du media. Prioritaire sur `blob.type` car les blobs lus depuis OPFS
   * ont souvent `type = ""`: sans ce parametre, une video OPFS serait traitee
   * comme une image et l'element `<img>` resterait vide.
   */
  kind?: MediaKind,
): {
  url: string | null;
  loading: boolean;
} {
  /**
   * Compteur de decodages acheves.
   *
   * On ne stocke PAS la vignette dans l'etat: le cache la detient deja, et l'y
   * dupliquer ferait diverger les deux. Cet entier ne sert qu'a redemander un
   * rendu quand une frame vient d'entrer dans le cache — c'est la seule chose
   * que React ne peut pas apprendre autrement d'une `WeakMap`.
   */
  const [, setDecoded] = useState(0);

  // `kind` est prioritaire: un blob OPFS a `type = ""` et serait faussement
  // traite comme une image sans ce fallback explicite.
  const isVideo = kind === 'video' || (kind === undefined && (blob?.type.startsWith('video/') ?? false));

  // Tout est DERIVE du cache pendant le rendu: pas de `setState` dans un effet
  // pour les cas deja connus, donc pas de rendu en cascade.
  const cached = blob && isVideo ? CACHE.get(blob) : undefined;
  const failed = blob !== undefined && isVideo && FAILED.has(blob);
  const needsDecode = blob !== undefined && isVideo && !cached && !failed;

  useEffect(() => {
    if (!needsDecode || !blob) return;

    // `cancelled` protege du demontage pendant le decodage: poser l'etat apres
    // coup afficherait la vignette d'un media qui n'est plus a l'ecran.
    let cancelled = false;

    void extractVideoThumbnail(blob).then((frame) => {
      if (frame) CACHE.set(blob, frame);
      else FAILED.add(blob);
      // Le resultat est deja dans le cache: ce compteur ne fait que reveiller
      // le rendu, qui ira l'y relire.
      if (!cancelled) setDecoded((count) => count + 1);
    });

    return () => {
      cancelled = true;
    };
  }, [blob, needsDecode]);

  // Une image se sert directement; une video attend sa frame decodee.
  const source = isVideo ? (cached ?? null) : (blob ?? null);

  // L'URL est DERIVEE du blob, jamais stockee dans un etat: c'est la convention
  // de `useObjectUrl`, et elle garantit que l'URL rendue correspond toujours au
  // blob courant.
  const url = useObjectUrl(source);

  return { url, loading: needsDecode };
}
