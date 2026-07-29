/**
 * Blobs des medias de la bibliotheque, charges depuis le stockage.
 *
 * POURQUOI un chemin separe de `MediaProvider`.
 *
 * `MediaProvider` ne charge que les medias du projet COURANT, et « Nouveau reel »
 * vide son cache. « Mes medias » n'affichait donc plus aucune vignette apres un
 * nouveau reel: les metadonnees etaient bien la, mais plus un seul blob —
 * mesure a 93 vignettes dont 93 sans image.
 *
 * Elargir `MediaProvider` a la bibliotheque aurait ete pire: il alimente aussi
 * le cache de frames et les buffers audio de la LECTURE, et y verser des dizaines
 * de medias non montes gonflerait la memoire pour rien. La bibliotheque n'a besoin
 * que d'une vignette.
 *
 * Le chargement est donc paresseux et borne: on ne lit un blob que pour les
 * medias reellement affiches, et on garde le resultat pour la session.
 */

import { useEffect, useState } from 'react';

import { getMedia } from '../../storage/mediaStore';
import type { Id, MediaAsset } from '../../domain/types';

/**
 * Cache de session, hors React.
 *
 * Partage entre tous les composants qui affichent la bibliotheque: ouvrir puis
 * refermer le panneau Media ne doit pas relire IndexedDB. Une `Map` simple
 * suffit — les blobs de la bibliotheque doivent justement survivre a
 * `MediaProvider.reset()`.
 */
const CACHE = new Map<Id, Blob>();

/** Medias dont la lecture a echoue: on ne retente pas a chaque rendu. */
const MISSING = new Set<Id>();

/**
 * Renvoie les blobs disponibles pour `assets`, en chargeant ceux qui manquent.
 *
 * Les blobs deja fournis par ailleurs (`MediaProvider`, pour un media du projet
 * en cours) sont passes en `known` et ne sont pas relus: c'est le cas courant
 * juste apres un import.
 */
export function useLibraryBlobs(
  assets: readonly MediaAsset[],
  known: ReadonlyMap<Id, Blob>,
): ReadonlyMap<Id, Blob> {
  /**
   * Compteur de chargements acheves.
   *
   * On ne stocke pas les blobs dans l'etat: `CACHE` les detient deja, et les y
   * dupliquer ferait diverger les deux sources. Cet entier ne sert qu'a
   * redemander un rendu quand un blob vient d'entrer dans le cache.
   */
  const [, setLoaded] = useState(0);

  // Clef stable de la liste a charger: sans elle, l'effet se relancerait a
  // chaque rendu puisque le tableau d'assets est recree a chaque fois.
  const pending = assets
    .filter((asset) => !known.has(asset.id) && !CACHE.has(asset.id) && !MISSING.has(asset.id))
    .map((asset) => asset.id);
  const pendingKey = pending.join(',');

  useEffect(() => {
    if (pendingKey.length === 0) return;

    let cancelled = false;

    void (async () => {
      // Sequentiel et non parallele: une bibliotheque de cent medias lancerait
      // cent lectures concurrentes et saturerait IndexedDB sur mobile.
      for (const id of pendingKey.split(',')) {
        if (cancelled) return;

        const asset = assets.find((candidate) => candidate.id === id);
        if (!asset) continue;

        try {
          const blob = await getMedia(asset.storage);
          if (blob) CACHE.set(id, blob);
          // Blob disparu du stockage: l'entree de bibliotheque est perimee, mais
          // ce n'est pas a ce hook de la supprimer — il ne fait que lire.
          else MISSING.add(id);
        } catch {
          MISSING.add(id);
        }

        // Rendu apres CHAQUE media: les vignettes apparaissent au fil du
        // chargement plutot que toutes d'un coup a la fin.
        if (!cancelled) setLoaded((count) => count + 1);
      }
    })();

    return () => {
      cancelled = true;
    };
    // `assets` est volontairement exclu: `pendingKey` en resume le contenu utile,
    // et l'inclure relancerait l'effet a chaque rendu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingKey]);

  // La vue combine les deux sources, `known` prioritaire: un media du projet en
  // cours a deja son blob en memoire, inutile de preferer une copie du cache.
  const merged = new Map<Id, Blob>();
  for (const asset of assets) {
    const blob = known.get(asset.id) ?? CACHE.get(asset.id);
    if (blob) merged.set(asset.id, blob);
  }
  return merged;
}

/** Oublie un media du cache. A appeler quand il quitte la bibliotheque. */
export function forgetLibraryBlob(assetId: Id): void {
  CACHE.delete(assetId);
  MISSING.delete(assetId);
}
