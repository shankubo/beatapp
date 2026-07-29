/**
 * Cadenas et aimant en tete de chaque piste de la timeline.
 *
 * Deux commandes, deux roles distincts:
 *
 * - **cadenas**: la piste refuse le decoupage et la suppression. Elle reste
 *   lisible et jouable — verrouiller protege un montage, ce n'est pas un masquage.
 * - **aimant**: decide de ce qui arrive au temps libere par une suppression.
 *   Actif, les morceaux suivants se recollent; inactif, un vide reste en place et
 *   rien ne se decale.
 *
 * Poses en tete de ligne et non dans un panneau: l'etat d'une piste doit se lire
 * sans quitter la timeline, sinon on decoupe sans savoir qu'une piste est
 * verrouillee.
 */

import { useTranslation } from 'react-i18next';

import { LockIcon, MagnetIcon, UnlockIcon } from '../../components/ui/icons';

/**
 * Largeur de la colonne de tete.
 *
 * Reduite au strict necessaire: sur 390 px, chaque pixel pris ici est un pixel
 * de moins pour voir le montage. Deux icones de 20 px et leurs marges suffisent.
 */
export const CONTROLS_W = 44;

interface TrackControlsProps {
  locked: boolean;
  onToggleLock: () => void;
  /**
   * Etat de l'aimant. `null` = la piste n'en a pas.
   *
   * La piste image en affiche un, mais son sens differe: elle est contigue par
   * construction (`ripple`, `assertTrackInvariants`), donc son aimant ne peut
   * pas y laisser de vide — il fait suivre les AUTRES pistes. Voir
   * `magnetFollowsOthers`.
   */
  magnet: boolean | null;
  onToggleMagnet?: () => void;
  /** Nom de la piste, pour les libelles d'accessibilite. */
  trackLabel: string;
  /**
   * L'aimant de CETTE piste fait suivre les autres, au lieu de refermer un trou.
   *
   * C'est le cas de la piste image, contigue par construction: aucun vide n'y
   * est possible (`ripple`, `assertTrackInvariants`). Son aimant decide donc si
   * le SON et le TEXTE se decalent avec l'image quand un plan est supprime. Le
   * libeller « aimant » comme les autres laissait croire qu'il empechait les
   * plans suivants de se recoller — ce qu'aucun reglage ne peut faire ici.
   */
  magnetFollowsOthers?: boolean;
}

export function TrackControls({
  locked,
  onToggleLock,
  magnet,
  onToggleMagnet,
  trackLabel,
  magnetFollowsOthers = false,
}: TrackControlsProps) {
  const { t } = useTranslation('editor');

  return (
    /*
      `z-20`: au-dessus des blocs, qui defilent sous cette colonne.
      Fond opaque: les blocs passent derriere sans transparaitre.

      La colonne s'arrete a la hauteur de SA ligne (`inset-y-0` du parent) et non
      de toute la timeline: les commandes ne recouvrent donc plus les boutons
      poses en bas de la zone, comme les ciseaux.
    */
    <div
      className="absolute inset-y-0 left-0 z-20 flex items-center justify-center gap-px border-r border-ink-700 bg-ink-950"
      style={{ width: CONTROLS_W }}
    >
      <button
        type="button"
        /**
         * On agit sur `pointerdown`, pas sur `click`.
         *
         * Le geste de scrub de la timeline s'empare du pointeur des le
         * `pointerdown` natif: le `click` de synthese n'arrivait alors jamais
         * jusqu'a React. Invisible au tactile — `pointer.touch` route le geste
         * par les evenements tactiles — et bloquant au clavier-souris, d'ou un
         * bouton mort sur PC et vivant sur iPhone.
         *
         * C'est le meme remede que celui deja applique aux ciseaux, et pour la
         * meme raison.
         */
        onPointerDown={(event) => {
          event.stopPropagation();
          event.preventDefault();
          onToggleLock();
        }}
        aria-pressed={locked}
        aria-label={
          locked
            ? t('timeline.unlockTrack', { track: trackLabel })
            : t('timeline.lockTrack', { track: trackLabel })
        }
        className={[
          'flex size-5 items-center justify-center rounded [&>svg]:size-3',
          locked ? 'bg-danger-500/20 text-danger-500' : 'text-ink-500 active:bg-ink-800',
        ].join(' ')}
      >
        {locked ? <LockIcon /> : <UnlockIcon />}
      </button>

      {magnet !== null && (
        <button
          type="button"
          // Meme raison que le cadenas ci-dessus: `pointerdown` et non `click`.
          onPointerDown={(event) => {
            event.stopPropagation();
            event.preventDefault();
            onToggleMagnet?.();
          }}
          aria-pressed={magnet}
          aria-label={
            magnetFollowsOthers
              ? magnet
                ? t('timeline.followOff')
                : t('timeline.followOn')
              : magnet
                ? t('timeline.magnetOff', { track: trackLabel })
                : t('timeline.magnetOn', { track: trackLabel })
          }
          className={[
            'flex size-5 items-center justify-center rounded [&>svg]:size-3',
            magnet ? 'bg-beat-400/20 text-beat-400' : 'text-ink-500 active:bg-ink-800',
          ].join(' ')}
        >
          <MagnetIcon />
        </button>
      )}
    </div>
  );
}
