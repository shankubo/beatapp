/**
 * Reperes de cadrage poses sur l'apercu.
 *
 * Ce qui n'est PAS dessine, et pourquoi: un cadre autour de l'image. Le canvas
 * porte deja exactement le ratio de la frame — son bord EST le cadre de sortie.
 * En tracer un second n'apprendrait rien et masquerait quelques pixels de
 * l'image.
 *
 * Ce que l'apercu ne peut pas montrer, en revanche, c'est ce qui tombe DEHORS.
 * On dessine donc l'emprise du plan telle que le compositeur la calcule: quand
 * elle deborde, on voit de combien on rogne; quand elle laisse du vide, on voit
 * ou le fond apparaitra. Les reperes ne s'affichent que dans ces deux cas — un
 * plan qui epouse le cadre n'a rien a signaler, et une alerte permanente cesse
 * d'etre lue.
 */

import { useTranslation } from 'react-i18next';

import type { FramingInfo } from '../../domain/framing';

export function FramingGuides({ framing }: { framing: FramingInfo }) {
  const { t } = useTranslation('editor');

  // Rien a dire: le plan remplit exactement le cadre.
  if (!framing.overflows && !framing.underfills) return null;

  const { content } = framing;

  // Pourcentages: le repere suit le canvas quelle que soit sa taille reelle,
  // sans jamais avoir a mesurer le DOM ni ecouter un redimensionnement.
  const box = {
    left: `${content.x * 100}%`,
    top: `${content.y * 100}%`,
    width: `${content.width * 100}%`,
    height: `${content.height * 100}%`,
  };

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {/*
        Emprise du plan. En pointilles pour ne pas se confondre avec un bord
        d'image, et en `media-400` — le bleu de la famille image/video. Le
        chartreuse reste reserve au rythme.
      */}
      <div
        aria-hidden="true"
        style={box}
        className="absolute border border-dashed border-media-400/70"
      />

      {/*
        Le vide se colore, le debordement non. Un plan qui deborde est le cas
        NORMAL d'un `cover`: le souligner en rouge crierait au probleme la ou il
        n'y en a pas. Le vide, lui, est presque toujours une surprise — c'est du
        fond qui sortira dans le MP4.
      */}
      {framing.underfills && (
        <div
          aria-hidden="true"
          className="absolute inset-0 ring-1 ring-inset ring-danger-500/50"
        />
      )}

      <p
        // `role="status"`: l'information est utile a qui ne voit pas l'image, et
        // c'est une mise a jour discrete, pas une alerte a interrompre.
        role="status"
        className="absolute inset-x-0 bottom-0 bg-ink-950/70 px-2 py-1 text-center text-[11px] text-ink-200"
      >
        {framing.underfills
          ? t('preview.framingGap', { percent: Math.round((1 - framing.coverage) * 100) })
          : t('preview.framingCrop')}
      </p>
    </div>
  );
}
