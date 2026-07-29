/**
 * Cadrage du plan sous la tete de lecture, pour les reperes de l'apercu.
 *
 * Le piege que ce hook evite: `usePlaybackStore((s) => s.time)` re-rendrait
 * l'apercu SOIXANTE fois par seconde pendant la lecture, alors que le plan
 * courant, lui, ne change qu'aux coupes.
 *
 * `useSyncExternalStore` est le bon outil, et pas seulement une preference de
 * style: il LIT la valeur au moment du rendu au lieu de la recopier dans un
 * etat, ce qui supprime a la fois le rendu superflu et le risque de desaccord
 * entre la tete de lecture reelle et celle qu'on croyait avoir memorisee. Un
 * premier essai passait par `useState` + `subscribe`, et devait recaler l'etat
 * dans un effet — exactement le motif que la regle `set-state-in-effect`
 * signale.
 */

import { useCallback, useSyncExternalStore } from 'react';

import { framingOf, type FramingInfo } from '../../domain/framing';
import { splitRotation } from '../../domain/project';
import { clipIndexAt } from '../../domain/timeline';
import { usePlaybackStore } from '../../store/usePlaybackStore';
import type { Project } from '../../domain/types';

export function useFraming(project: Project, enabled: boolean): FramingInfo | null {
  /*
    L'instantane est l'INDEX du clip, jamais le temps.

    C'est ce qui borne les rendus: pendant un scrub, le temps change a chaque
    frame mais l'index ne bouge qu'en franchissant une coupe. React compare
    l'instantane par egalite stricte et ne re-rend donc que la.
  */
  const subscribe = useCallback((onChange: () => void) => {
    return usePlaybackStore.subscribe(onChange);
  }, []);

  const getSnapshot = useCallback(
    () => clipIndexAt(project.videoTrack, usePlaybackStore.getState().time),
    [project.videoTrack],
  );

  const index = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  if (!enabled) return null;

  const clip = index >= 0 ? project.videoTrack.clips[index] : undefined;
  if (!clip) return null;

  const asset = project.assets[clip.assetId];
  // Sans dimensions sondees, `framingOf` suppose le cadre plein et ne signale
  // rien: mieux vaut ne rien dire que d'alerter sur un media inconnu.
  const source =
    asset?.width !== undefined && asset.height !== undefined
      ? { width: asset.width, height: asset.height }
      : undefined;

  return framingOf(
    clip,
    source,
    project.frame,
    splitRotation(clip.transform.rotation).quarters,
  );
}
