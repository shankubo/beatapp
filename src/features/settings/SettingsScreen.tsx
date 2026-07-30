/**
 * Ecran de reglages: tout ce qui configure l'application, en un seul endroit.
 *
 * Plein ecran comme l'export, et non un panneau d'outil: ce sont des reglages de
 * PROJET et d'application, pas une edition de plan. Les onglets du bas restent
 * dedies a ce qu'on fabrique.
 */

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useProjectStore } from '../../store/useProjectStore';
import { usePreferencesStore } from '../../store/usePreferencesStore';
import { useUiStore } from '../../store/useUiStore';
import { IconButton } from '../../components/ui/IconButton';
import { Segmented } from '../../components/ui/Segmented';
import { CloseIcon } from '../../components/ui/icons';
import { SUPPORTED_LANGUAGES, setLanguage, type Language } from '../../i18n';
import {
  ASPECT_RATIOS,
  MAX_FRAME_SIDE,
  MIN_FRAME_SIDE,
  PLATFORM_PRESETS,
  PLATFORM_LIMITS,
  aspectRatioOf,
  clampFrameSide,
  frameOrientation,
  ratioLabel,
  type AspectRatioId,
  type FrameOrientation,
  type PlatformPresetId,
} from '../../domain/types';
import { fitRect } from '../../engine/Compositor';
import { qualityDimensions, QUALITY_HIGH } from '../../export/webcodecs';
import { videoDuration } from '../../domain/timeline';
import { formatDurationLimit } from '../../lib/format';

/** Destinations, dans l'ordre d'affichage. */
const PLATFORMS: readonly PlatformPresetId[] = [
  'instagramReel',
  'instagramPost',
  'instagramFeed',
  'tiktok',
  'youtubeShorts',
  'youtube',
  'facebookReel',
  'facebookFeed',
];

/** Formats, du plus vertical au plus horizontal. */
const ASPECTS: readonly AspectRatioId[] = [
  'reel',
  'classicPortrait',
  'portrait',
  'square',
  'classic',
  'landscape',
];

/**
 * Gabarit de la vignette, en pixels.
 *
 * 9:19,5 est le rapport d'un telephone moderne. La hauteur de 60 px a ete choisie
 * sous deux contraintes mesurees en 390 px de large: la grille a deux colonnes
 * laisse 127 px au texte a cote de la vignette, et la bande la plus fine (16:9)
 * fait encore 14 px de haut — donc lisible et non confondue avec une bordure.
 */
const PHONE_HEIGHT = 60;
const PHONE_WIDTH = Math.round((PHONE_HEIGHT * 9) / 19.5);
/** Epaisseur de la coque, de chaque cote. */
const PHONE_BEZEL = 2;

/**
 * Vignette: un format DANS un telephone, et non un rectangle nu.
 *
 * La difference porte tout le sens. Un rectangle isole donne la forme du cadre;
 * pose dans un telephone, il montre la PLACE REELLEMENT OCCUPEE a l'ecran. Un
 * 16:9 horizontal ne remplit que 24 % de l'ecran quand un 9:16 en occupe 76 %,
 * et ce contraste est precisement ce qu'aucun chiffre ne transmet.
 *
 * La zone video est calculee par `fitRect` en mode `contain`, c'est-a-dire par la
 * MEME geometrie que le rendu reel: la vignette ne peut donc pas mentir sur ce
 * que produira l'export.
 */
function PhonePreview({
  frame,
  active,
}: {
  frame: { width: number; height: number };
  active: boolean;
}) {
  const screenWidth = PHONE_WIDTH - PHONE_BEZEL * 2;
  const screenHeight = PHONE_HEIGHT - PHONE_BEZEL * 2;
  const rect = fitRect(frame.width, frame.height, screenWidth, screenHeight, 'contain');

  return (
    // `aria-hidden`: la vignette redit visuellement le texte place a cote d'elle,
    // et l'annoncer deux fois gênerait un lecteur d'ecran.
    <div
      aria-hidden="true"
      style={{ width: PHONE_WIDTH, height: PHONE_HEIGHT }}
      className={[
        'relative shrink-0 rounded-[6px] border bg-ink-900',
        active ? 'border-media-400' : 'border-ink-600',
      ].join(' ')}
    >
      {/* Encoche: deux pixels suffisent a faire lire la forme comme un
          telephone plutot que comme un cadre quelconque. */}
      <span className="absolute left-1/2 top-[2px] h-[2px] w-2 -translate-x-1/2 rounded-full bg-ink-700" />
      <span
        style={{
          position: 'absolute',
          left: PHONE_BEZEL + rect.x,
          top: PHONE_BEZEL + rect.y,
          width: rect.width,
          height: rect.height,
        }}
        // Le vide autour reste le fond du telephone: c'est lui qui rend visible
        // la place perdue, donc il ne doit surtout pas etre colore.
        className={active ? 'bg-media-400' : 'bg-ink-500'}
      />
    </div>
  );
}

/**
 * Interrupteur avec son explication.
 *
 * L'explication n'est pas decorative: chacune de ces options agit a l'insu de
 * l'utilisateur, sur des imports futurs. Sans un mot sur ce qu'elle fait, un
 * reglage silencieux devient un comportement inexplicable.
 */
function ToggleRow({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      className={[
        'flex items-start justify-between gap-3 rounded-xl border border-ink-600 bg-ink-850 p-3',
        disabled ? 'opacity-60' : '',
      ].join(' ')}
    >
      <span className="min-w-0">
        <span className="block text-sm text-ink-200">{label}</span>
        <span className="mt-0.5 block text-[11px] leading-snug text-ink-400">{hint}</span>
      </span>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-5 shrink-0 accent-[var(--color-media-400)]"
      />
    </label>
  );
}

/** Ratio pret a afficher, ou chaine vide si aucun ratio connu ne decrit la frame. */
function ratioText(frame: { width: number; height: number }): string {
  const label = ratioLabel(frame);
  if (!label) return '';
  // Le « ≈ » est une decision d'AFFICHAGE: le domaine renvoie un drapeau.
  return label.approximate ? `≈ ${label.text}` : label.text;
}

/** Cles completes, pour rester verifiables a la compilation. */
function orientationLabelKey(orientation: FrameOrientation) {
  switch (orientation) {
    case 'horizontal':
      return 'settings:orientation.horizontal' as const;
    case 'square':
      return 'settings:orientation.square' as const;
    case 'vertical':
      return 'settings:orientation.vertical' as const;
  }
}


export function SettingsScreen({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation(['settings', 'common', 'editor', 'about', 'install']);
  const setAboutOpen = useUiStore((state) => state.setAboutOpen);
  const setInstallOpen = useUiStore((state) => state.setInstallOpen);

  const project = useProjectStore((state) => state.project);
  const setFrameAspect = useProjectStore((state) => state.setFrameAspect);
  const setFrameSize = useProjectStore((state) => state.setFrameSize);
  const setBackground = useProjectStore((state) => state.setBackground);
  const importPreferences = usePreferencesStore((state) => state.importPreferences);
  const setImportPreferences = usePreferencesStore((state) => state.setImportPreferences);

  const frame = project.frame;
  const currentAspect = aspectRatioOf(frame);

  /*
    Mode libre: deduit du fait que les dimensions ne correspondent a AUCUN format
    connu, plutot que stocke. Un drapeau separe pourrait mentir — par exemple
    apres une annulation qui restaure un format nomme.
  */
  const [customOpen, setCustomOpen] = useState(currentAspect === null);

  const currentLanguage = (i18n.resolvedLanguage ?? 'fr') as Language;

  // Ce que l'export produira reellement: meme fonction que l'encodeur.
  const output = useMemo(
    () => qualityDimensions(QUALITY_HIGH, frame),
    [frame],
  );

  /*
    Duree du montage, pour confronter les limites au projet REEL.

    Sans elle, la limite serait une note d'encyclopedie. Avec elle, l'utilisateur
    voit immediatement quelle destination refuserait sa video.
  */
  const duration = videoDuration(project.videoTrack);

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-ink-950">
      <header className="safe-pt flex h-appbar shrink-0 items-center justify-between border-b border-ink-700 pl-4 pr-1">
        <h2 className="text-sm font-semibold text-ink-50">{t('settings:title')}</h2>
        <IconButton label={t('common:action.close')} onClick={onClose} size="sm">
          <CloseIcon />
        </IconButton>
      </header>

      <div className="scrollbar-none safe-pb min-h-0 flex-1 space-y-6 overflow-y-auto p-4">
        {/* --- Destination */}
        <section className="space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-ink-400">
            {t('settings:platform.label')}
          </h3>
          <p className="text-xs text-ink-400">{t('settings:platform.hint')}</p>
          {duration > 0 && (
            <p className="tnum text-xs text-ink-400">
              {t('settings:limits.projectDuration', {
                value: formatDurationLimit(duration, i18n.language),
              })}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            {PLATFORMS.map((id) => {
              const aspect = PLATFORM_PRESETS[id];
              const size = ASPECT_RATIOS[aspect];
              const active = !customOpen && currentAspect === aspect;
              const limits = PLATFORM_LIMITS[id];
              // Depassement signale seulement s'il y a un montage: sur un projet
              // vide, une alerte n'aurait aucun sens.
              const tooLong = duration > 0 && duration > limits.maxDuration;
              return (
                <button
                  key={id}
                  type="button"
                  onPointerDown={(event) => {
                    // `onPointerDown` et non `onClick`: mesure faite sur ce depot,
                    // un `preventDefault` en amont peut tuer le clic synthetise
                    // sur PC alors qu'il passe sur iPhone.
                    event.stopPropagation();
                    event.preventDefault();
                    setCustomOpen(false);
                    setFrameAspect(aspect);
                  }}
                  aria-pressed={active}
                  className={[
                    'flex min-h-14 items-center gap-2 rounded-lg border p-2 text-left',
                    active
                      ? 'border-media-400 text-media-400'
                      : 'border-ink-600 text-ink-200 active:bg-ink-800',
                  ].join(' ')}
                >
                  <PhonePreview frame={size} active={active} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium">
                      {t(platformLabelKey(id))}
                    </span>
                    <span className="tnum mt-0.5 block text-[11px] text-ink-400">
                      {ratioText(size)} · {size.width} × {size.height}
                    </span>
                    <span
                      className={[
                        'tnum block text-[11px]',
                        // Le depassement est la seule information ACTIONNABLE de
                        // ce bloc: il merite la couleur reservee aux alertes.
                        tooLong ? 'font-medium text-danger-500' : 'text-ink-400',
                      ].join(' ')}
                    >
                      {t('settings:limits.maxDuration', {
                        value: formatDurationLimit(limits.maxDuration, i18n.language),
                      })}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          {/*
            Dire d'ou viennent ces chiffres et ce qu'ils valent. Ce sont des faits
            publies par des tiers, qui changent sans que ce code en soit averti:
            les presenter comme une regle appliquee par l'application serait une
            promesse qu'elle ne peut pas tenir.
          */}
          <p className="text-[11px] leading-snug text-ink-400">{t('settings:limits.note')}</p>
        </section>

        {/*
          Les FORMATS, classes par ratio et non par usage.

          Section distincte des destinations: on choisit ici une forme d'image,
          sans passer par une plateforme. Le 4:3 et le 3:4 n'existent que la, car
          aucun reseau ne les recommande.
        */}
        <section className="space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-ink-400">
            {t('settings:aspect.label')}
          </h3>
          <p className="text-xs text-ink-400">{t('settings:aspect.hint')}</p>
          <div className="grid grid-cols-3 gap-2">
            {ASPECTS.map((id) => {
              const size = ASPECT_RATIOS[id];
              const active = !customOpen && currentAspect === id;
              return (
                <button
                  key={id}
                  type="button"
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    event.preventDefault();
                    setCustomOpen(false);
                    setFrameAspect(id);
                  }}
                  aria-pressed={active}
                  className={[
                    'flex flex-col items-center gap-1.5 rounded-lg border p-2',
                    active
                      ? 'border-media-400 text-media-400'
                      : 'border-ink-600 text-ink-200 active:bg-ink-800',
                  ].join(' ')}
                >
                  <PhonePreview frame={size} active={active} />
                  <span className="tnum text-xs font-medium">{ratioText(size)}</span>
                  <span className="text-[11px] text-ink-400">
                    {t(orientationLabelKey(frameOrientation(size)))}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* --- Format libre */}
        <section className="space-y-2">
          <button
            type="button"
            onPointerDown={(event) => {
              event.stopPropagation();
              event.preventDefault();
              setCustomOpen((open) => !open);
            }}
            aria-pressed={customOpen}
            aria-expanded={customOpen}
            className={[
              'min-h-11 w-full rounded-lg border px-3 text-xs font-medium',
              customOpen
                ? 'border-media-400 text-media-400'
                : 'border-ink-600 text-ink-200 active:bg-ink-800',
            ].join(' ')}
          >
            {t('settings:custom.label')}
          </button>

          {customOpen && (
            <div className="space-y-2 rounded-xl border border-ink-600 bg-ink-850 p-3">
              <p className="text-xs text-ink-400">
                {t('settings:custom.hint', { min: MIN_FRAME_SIDE, max: MAX_FRAME_SIDE })}
              </p>
              <div className="flex items-center gap-2">
                <SideInput
                  label={t('settings:custom.width')}
                  value={frame.width}
                  onCommit={(width) => setFrameSize({ width, height: frame.height })}
                />
                <span aria-hidden="true" className="pt-5 text-ink-400">
                  ×
                </span>
                <SideInput
                  label={t('settings:custom.height')}
                  value={frame.height}
                  onCommit={(height) => setFrameSize({ width: frame.width, height })}
                />
              </div>
            </div>
          )}
        </section>

        {/*
          Import par lot.

          Pose APRES le format: chaque option se juge par rapport au cadre, et un
          « redresser automatiquement » n'a de sens qu'une fois qu'on sait vers
          quelle orientation redresser.
        */}
        <section className="space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-ink-400">
            {t('settings:import.label')}
          </h3>
          <p className="text-xs text-ink-400">{t('settings:import.hint')}</p>

          <Segmented
            label={t('settings:import.fit')}
            options={[
              { value: 'cover' as const, label: t('settings:import.fitCover') },
              { value: 'contain' as const, label: t('settings:import.fitContain') },
            ]}
            value={importPreferences.fit}
            onChange={(fit) => setImportPreferences({ fit })}
          />

          <ToggleRow
            label={t('settings:import.autoRotate')}
            hint={t('settings:import.autoRotateHint')}
            checked={importPreferences.autoRotate}
            onChange={(autoRotate) => setImportPreferences({ autoRotate })}
          />
          <ToggleRow
            label={t('settings:import.autoZoom')}
            hint={t('settings:import.autoZoomHint')}
            checked={importPreferences.autoZoom}
            // Sans bandes a combler, l'option n'a aucun effet: la desactiver est
            // plus honnete que de la laisser cocher pour rien.
            disabled={importPreferences.fit !== 'contain'}
            onChange={(autoZoom) => setImportPreferences({ autoZoom })}
          />
          <ToggleRow
            label={t('settings:import.autoCenter')}
            hint={t('settings:import.autoCenterHint')}
            checked={importPreferences.autoCenter}
            onChange={(autoCenter) => setImportPreferences({ autoCenter })}
          />

          <p className="text-[11px] leading-snug text-ink-400">
            {t('settings:import.note')}
          </p>
        </section>

        {/*
          Reperes de cadrage.

          Section a part et non rangee avec l'import: ces options ne modifient
          aucun plan, elles ne changent que ce qu'on VOIT pendant le montage. Les
          melanger a « redresser » et « recentrer », qui ecrivent dans le projet,
          laisserait croire que cocher la case retouche les images.
        */}
        <section className="space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-ink-400">
            {t('settings:guides.label')}
          </h3>
          <p className="text-xs text-ink-400">{t('settings:guides.hint')}</p>

          <ToggleRow
            label={t('settings:guides.framing')}
            hint={t('settings:guides.framingHint')}
            checked={importPreferences.showFramingGuides}
            onChange={(showFramingGuides) => setImportPreferences({ showFramingGuides })}
          />
        </section>

        {/* --- Fond, pour les plans qui ne remplissent pas le cadre */}
        <section className="space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-ink-400">
            {t('settings:background.label')}
          </h3>
          <p className="text-xs text-ink-400">{t('settings:background.hint')}</p>
          <Segmented
            label={t('settings:background.label')}
            options={[
              { value: 'color' as const, label: t('settings:background.color') },
              { value: 'blur' as const, label: t('settings:background.blur') },
            ]}
            value={project.background.type}
            onChange={(type) =>
              setBackground(
                type === 'blur'
                  ? // 0,04 de la largeur: ~43 px en 1080. En dessous le fond reste
                    // lisible et concurrence le sujet; au-dela il devient une
                    // bouillie uniforme qui ne vaut plus mieux qu'une couleur.
                    { type: 'blur', amount: 0.04 }
                  : { type: 'color', color: '#000000' },
              )
            }
          />
        </section>

        {/* --- Langue */}
        <section className="space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-ink-400">
            {t('common:language.label')}
          </h3>
          <Segmented
            label={t('common:language.label')}
            options={SUPPORTED_LANGUAGES.map((code) => ({
              value: code,
              label: t(`common:language.${code}`),
            }))}
            value={currentLanguage}
            onChange={(code) => void setLanguage(code)}
          />
        </section>

        {/* --- Recapitulatif: ce qui sortira reellement */}
        <section className="space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-ink-400">
            {t('settings:output.label')}
          </h3>
          <div className="rounded-xl border border-ink-600 bg-ink-850 p-3">
            <div className="flex items-center gap-3">
              <PhonePreview frame={frame} active />
              <div className="min-w-0">
                <p className="tnum text-lg font-semibold leading-none text-ink-50">
                  {output.width} × {output.height}
                </p>
                <p className="tnum mt-1 text-xs text-ink-400">
                  {[ratioText(frame), t(orientationLabelKey(frameOrientation(frame)))]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
            </div>
            <p className="mt-2 text-xs text-ink-400">{t('settings:output.hint')}</p>
          </div>
        </section>

        {/*
          « A propos » en PIED de page.

          Convention des applications mobiles: ce qui decrit l'application vient
          apres ce qui la configure. Ouvrir l'ecran referme les reglages — deux
          ecrans pleins empiles laisseraient une pile a defaire a rebours.
        */}
        <button
          type="button"
          onClick={() => {
            onClose();
            setInstallOpen(true);
          }}
          className="surface flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-ink-600 bg-ink-850 px-3 text-sm font-medium text-ink-200 active:bg-ink-800"
        >
          <span>{t('install:open')}</span>
          <span aria-hidden="true" className="text-ink-400">
            ›
          </span>
        </button>

        <button
          type="button"
          onClick={() => {
            onClose();
            setAboutOpen(true);
          }}
          className="surface flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-ink-600 bg-ink-850 px-3 text-sm font-medium text-ink-200 active:bg-ink-800"
        >
          <span>{t('about:open')}</span>
          <span aria-hidden="true" className="text-ink-400">
            ›
          </span>
        </button>
      </div>
    </div>
  );
}

/**
 * Champ d'un cote, valide a la SORTIE du champ et non a la frappe.
 *
 * Assainir a chaque touche rendrait la saisie impossible: taper « 1080 » passe
 * par « 1 », que le plancher remonterait aussitot a 240. On garde donc le texte
 * brut pendant l'edition et on ne le confie au domaine qu'au `blur` ou a Entree.
 */
function SideInput({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    onCommit(clampFrameSide(Number(draft)));
    setDraft(null);
  };

  return (
    <label className="min-w-0 flex-1">
      <span className="mb-1 block text-[11px] text-ink-400">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={MIN_FRAME_SIDE}
        max={MAX_FRAME_SIDE}
        value={draft ?? value}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
        className="tnum min-h-11 w-full rounded-lg border border-ink-600 bg-ink-900 px-2 text-sm text-ink-50 outline-none focus:border-media-400"
      />
    </label>
  );
}

/** Cles completes, pour rester verifiables a la compilation. */
function platformLabelKey(id: PlatformPresetId) {
  switch (id) {
    case 'instagramReel':
      return 'settings:platform.instagramReel' as const;
    case 'instagramPost':
      return 'settings:platform.instagramPost' as const;
    case 'instagramFeed':
      return 'settings:platform.instagramFeed' as const;
    case 'tiktok':
      return 'settings:platform.tiktok' as const;
    case 'youtubeShorts':
      return 'settings:platform.youtubeShorts' as const;
    case 'youtube':
      return 'settings:platform.youtube' as const;
    case 'facebookReel':
      return 'settings:platform.facebookReel' as const;
    case 'facebookFeed':
      return 'settings:platform.facebookFeed' as const;
  }
}

/** Format nomme correspondant a une destination, ou `null` en format libre. */
export function aspectForPlatform(id: PlatformPresetId): AspectRatioId {
  return PLATFORM_PRESETS[id];
}
