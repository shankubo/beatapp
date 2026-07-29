/**
 * Verrou d'ecran pendant l'export.
 *
 * Sans cela, le telephone s'endort au milieu d'un encodage de 30 secondes, le
 * navigateur suspend la boucle, et l'utilisateur retrouve un export bloque.
 */

import { useCallback, useEffect, useRef } from 'react';

type WakeLockSentinelLike = { release: () => Promise<void>; released: boolean };

export function useWakeLock(): { acquire: () => Promise<void>; release: () => void } {
  const sentinel = useRef<WakeLockSentinelLike | null>(null);

  const release = useCallback(() => {
    void sentinel.current?.release().catch(() => undefined);
    sentinel.current = null;
  }, []);

  const acquire = useCallback(async () => {
    const wakeLock = navigator.wakeLock;
    if (!wakeLock) return;
    if (sentinel.current && !sentinel.current.released) return;

    try {
      sentinel.current = (await wakeLock.request('screen')) as unknown as WakeLockSentinelLike;
    } catch {
      // Refuse (onglet en arriere-plan, batterie faible): l'export continue,
      // simplement sans garantie que l'ecran reste allume.
    }
  }, []);

  // Filet de securite: liberer si le composant disparait pendant l'export.
  useEffect(() => release, [release]);

  return { acquire, release };
}
