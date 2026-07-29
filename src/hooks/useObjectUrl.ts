/**
 * Cycle de vie des objectURL.
 *
 * Chaque `createObjectURL` non revoque garde son blob en memoire jusqu'a la
 * fermeture de l'onglet: sur des videos de plusieurs dizaines de mega-octets,
 * la fuite est immediate et fatale sur mobile. Ces hooks en detiennent la
 * propriete exclusive, ce qui rend la fuite structurellement impossible.
 *
 * IMPORTANT: L'URL est creee dans un `useEffect`, pas dans un `useMemo`.
 * En React StrictMode (developpement), le cleanup d'un effet est rejoue
 * immediatement apres le montage: si l'URL etait creee dans `useMemo`, elle
 * serait revoquee avant que le re-run de l'effet puisse en creer une nouvelle —
 * `useMemo` renverrait la valeur en cache (deja revoquee) et l'image resterait
 * definitivement brisee. En creant l'URL dans l'effet, le re-run fabrique une
 * nouvelle URL valide.
 */

import { useEffect, useState } from 'react';

export function useObjectUrl(blob: Blob | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!blob) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- voir l'en-tete
      setUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(blob);
    // L'appel est DANS l'effet a dessein: c'est le seul endroit ou le cycle de
    // vie de l'URL et celui du composant coincident. Voir l'en-tete du module.
    setUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [blob]);

  return url;
}

/** Variante pour plusieurs blobs (grille de vignettes). */
export function useObjectUrls(blobs: ReadonlyMap<string, Blob>): ReadonlyMap<string, string> {
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(() => new Map());

  useEffect(() => {
    const created = new Map<string, string>();
    for (const [id, blob] of blobs) created.set(id, URL.createObjectURL(blob));
    // Meme raison que ci-dessus: l'URL doit naitre et mourir avec l'effet.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- voir l'en-tete
    setUrls(created);
    return () => {
      for (const url of created.values()) URL.revokeObjectURL(url);
    };
  }, [blobs]);

  return urls;
}
