/**
 * Ecran d'export: plein ecran, car c'est une operation longue qui merite
 * l'attention exclusive de l'utilisateur (et l'ecran doit rester allume).
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  useExport,
  useExportCapability,
  QUALITY_TIERS,
  type QualityChoice,
} from './useExport';
import { useProjectStore } from '../../store/useProjectStore';
import { Segmented } from '../../components/ui/Segmented';
import { IconButton } from '../../components/ui/IconButton';
import { CloseIcon, DownloadIcon, ShareIcon } from '../../components/ui/icons';
import { videoDuration } from '../../domain/timeline';
import { qualityDimensions, tierAppliesTo, type ExportPhase } from '../../export/webcodecs';
import { formatDuration, formatPercent } from '../../lib/format';

export function ExportScreen({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation(['export', 'errors', 'common', 'editor']);

  const project = useProjectStore((state) => state.project);
  const { state, start, cancel, reset } = useExport();
  const { capability, supported, probe } = useExportCapability();

  const [requestedQuality, setQuality] = useState<QualityChoice>('high');

  /**
   * Qualite effective: si l'appareil ne sait pas encoder le 1080x1920, la
   * demande retombe sur la qualite moyenne.
   *
   * Derivee et non stockee: un effet qui corrigerait l'etat provoquerait un
   * rendu en cascade, et surtout l'etat pourrait rester incoherent le temps d'un
   * rendu — avec un bouton d'export promettant une qualite indisponible.
   */
  const quality: QualityChoice =
    requestedQuality !== 'medium' && !supported[requestedQuality]
      ? 'medium'
      : requestedQuality;

  useEffect(() => {
    void probe();
  }, [probe]);

  /*
    Dimensions reelles: le palier donne la hauteur, le FORMAT du projet donne la
    largeur. On appelle la meme fonction que l'encodeur, donc l'affichage ne peut
    pas diverger de ce qui sera reellement produit.
  */
  const dimensions = useMemo(
    () => qualityDimensions(QUALITY_TIERS[quality], project.frame),
    [quality, project.frame],
  );

  /*
    Les libelles portent les dimensions, qui varient avec le format: on ne peut
    donc pas les figer dans les traductions. Un palier non encodable par
    l'appareil n'est pas propose du tout.
  */
  const qualityOptions = useMemo(
    () =>
      (['uhd', 'ultra', 'high', 'medium'] as const)
        // Deux filtres distincts: ce que l'APPAREIL sait encoder, et ce qui a du
        // sens pour le FORMAT choisi. Le 4K n'est propose qu'en paysage.
        .filter((choice) => supported[choice] && tierAppliesTo(QUALITY_TIERS[choice], project.frame))
        .map((choice) => {
          const size = qualityDimensions(QUALITY_TIERS[choice], project.frame);
          return {
            value: choice,
            label: t(`export:quality.${choice}`, {
              width: size.width,
              height: size.height,
            }),
          };
        }),
    [supported, project.frame, t],
  );


  const duration = videoDuration(project.videoTrack);
  const clipCount = project.videoTrack.clips.length;

  // --- Navigateur incapable d'encoder: on le dit clairement, avec la marche a suivre.
  if (capability === 'none' || capability === 'webm-only') {
    return (
      <Shell title={t('export:title')} onClose={onClose}>
        <div className="space-y-3 rounded-xl border border-danger-500/40 bg-ink-850 p-4">
          <h3 className="text-sm font-semibold text-danger-400">
            {t('errors:export.unsupportedBrowser.title')}
          </h3>
          <p className="text-sm leading-relaxed text-ink-200">
            {t('errors:export.unsupportedBrowser.body')}
          </p>
          {capability === 'webm-only' && (
            <p className="text-xs leading-relaxed text-ink-400">
              {t('errors:export.unsupportedBrowser.fallbackNote')}
            </p>
          )}
        </div>
      </Shell>
    );
  }

  // --- Export termine.
  if (state.status === 'done' && state.result) {
    return (
      <Shell title={t('export:result.title')} onClose={onClose}>
        <div className="space-y-4">
          <video
            src={state.result.url}
            controls
            playsInline
            className="mx-auto max-h-[42vh] w-auto rounded-xl bg-black"
          />

          <ShareButtons blob={state.result.blob} url={state.result.url} name={project.name} />

          <button
            type="button"
            onClick={reset}
            className="min-h-12 w-full surface rounded-xl border border-ink-600 bg-ink-850 text-sm font-medium text-ink-200 active:bg-ink-800"
          >
            {t('export:result.newExport')}
          </button>
        </div>
      </Shell>
    );
  }

  // --- Export en cours.
  if (state.status === 'running') {
    const fraction = state.progress?.fraction ?? 0;
    const eta = state.progress?.etaSeconds;

    return (
      <Shell title={t('export:title')} onClose={onClose} hideClose>
        <div className="space-y-5 py-6">
          <ProgressRing fraction={fraction} label={formatPercent(fraction, i18n.language)} />

          <p className="text-center text-sm text-ink-200">
            {t(phaseLabelKey(state.progress?.phase ?? 'preparing'))}
          </p>

          {eta !== null && eta !== undefined && eta > 1 && (
            <p className="tnum text-center text-xs text-ink-400">
              {t('export:progress.remaining', { seconds: Math.ceil(eta) })}
            </p>
          )}

          <p className="text-center text-xs text-ink-400">{t('export:progress.keepOpen')}</p>

          <button
            type="button"
            onClick={cancel}
            className="min-h-12 w-full surface rounded-xl border border-ink-600 bg-ink-850 text-sm font-medium text-ink-200 active:bg-ink-800"
          >
            {t('export:cancel')}
          </button>
        </div>
      </Shell>
    );
  }

  // --- Ecran de depart (et erreurs).
  return (
    <Shell title={t('export:title')} onClose={onClose}>
      <div className="space-y-5">
        {state.errorKey && (
          <p className="rounded-xl border border-danger-500/40 bg-ink-850 p-3 text-sm text-danger-400">
            {t(state.errorKey)}
          </p>
        )}

        <dl className="space-y-2 rounded-xl border border-ink-600 bg-ink-850 p-4 text-sm">
          <Row label={t('export:summary.duration')} value={formatDuration(duration, i18n.language)} />
          <Row
            label={t('export:summary.clips')}
            value={t('common:unit.clipCount', { count: clipCount })}
          />
          <Row
            label={t('export:summary.resolution')}
            // Calcule par la MEME fonction que l'encodeur: la ligne ne peut donc
            // pas mentir, meme apres un changement de format ou de palier.
            value={`${dimensions.width} × ${dimensions.height}`}
          />
        </dl>

        <div className="space-y-2">
          <span className="block text-xs font-medium uppercase tracking-wide text-ink-400">
            {t('export:quality.label')}
          </span>
          <Segmented
            label={t('export:quality.label')}
            options={qualityOptions}
            value={quality}
            onChange={setQuality}
          />
          <p className="text-xs text-ink-400">
            {!supported.high
              ? t('export:quality.highUnavailable')
              : quality === 'uhd'
                ? t('export:quality.uhdHint')
                : quality === 'ultra'
                  ? // Dire franchement ce que le palier haut ne donne pas: au-dela
                    // de 1080x1920 les plateformes re-encodent, donc le poids
                    // augmente sans gain visible chez le spectateur.
                    t('export:quality.ultraHint')
                  : t('export:quality.hint')}
          </p>
        </div>

        <button
          type="button"
          onClick={() => void start(quality)}
          disabled={clipCount === 0}
          className="min-h-14 w-full rounded-xl bg-beat-400 text-sm font-semibold text-ink-950 active:bg-beat-500 disabled:opacity-60"
        >
          {t('export:start')}
        </button>
      </div>
    </Shell>
  );
}

function Shell({
  title,
  onClose,
  hideClose,
  children,
}: {
  title: string;
  onClose: () => void;
  hideClose?: boolean;
  children: React.ReactNode;
}) {
  const { t } = useTranslation('common');

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-ink-950">
      <header className="appbar-top flex shrink-0 items-center justify-between border-b border-ink-700 pl-4 pr-1">
        <h2 className="text-sm font-semibold text-ink-50">{title}</h2>
        {!hideClose && (
          <IconButton label={t('action.close')} onClick={onClose} size="sm">
            <CloseIcon />
          </IconButton>
        )}
      </header>
      <div className="scrollbar-none safe-pb min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
    </div>
  );
}

/** Cles completes des phases: verifiees a la compilation. */
function phaseLabelKey(phase: ExportPhase) {
  switch (phase) {
    case 'preparing':
      return 'export:progress.preparing' as const;
    case 'mixingAudio':
      return 'export:progress.mixingAudio' as const;
    case 'encodingVideo':
      return 'export:progress.encodingVideo' as const;
    case 'finalizing':
      return 'export:progress.finalizing' as const;
  }
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-ink-400">{label}</dt>
      <dd className="tnum text-ink-50">{value}</dd>
    </div>
  );
}

/** Anneau de progression en SVG: pas de dependance, et animation fluide. */
function ProgressRing({ fraction, label }: { fraction: number; label: string }) {
  const radius = 52;
  const circumference = 2 * Math.PI * radius;

  return (
    <div className="relative mx-auto size-36">
      <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden="true">
        <circle cx="60" cy="60" r={radius} fill="none" stroke="var(--color-ink-800)" strokeWidth="8" />
        <circle
          cx="60"
          cy="60"
          r={radius}
          fill="none"
          stroke="var(--color-beat-400)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - fraction)}
          // Transition courte: la barre suit la realite sans paraitre saccadee.
          style={{ transition: 'stroke-dashoffset 200ms linear' }}
        />
      </svg>
      <span className="tnum absolute inset-0 flex items-center justify-center text-xl font-semibold text-ink-50">
        {label}
      </span>
    </div>
  );
}

/**
 * Partage et telechargement.
 *
 * `navigator.share` avec un fichier est la voie native vers Instagram et
 * WhatsApp sur mobile: c'est le chemin le plus court entre l'export et la
 * publication. Le telechargement reste propose en repli.
 */
function ShareButtons({ blob, url, name }: { blob: Blob; url: string; name: string }) {
  const { t } = useTranslation('export');

  const fileName = `${sanitizeForFileName(name)}.mp4`;

  // Derive et non stocke: la capacite de partage ne depend que du fichier, donc
  // un etat n'apporterait qu'un rendu supplementaire.
  const canShare = useMemo(() => {
    if (typeof navigator.canShare !== 'function') return false;
    return navigator.canShare({ files: [new File([blob], fileName, { type: 'video/mp4' })] });
  }, [blob, fileName]);

  const share = async () => {
    const file = new File([blob], fileName, { type: 'video/mp4' });
    try {
      await navigator.share({ files: [file], title: name });
    } catch {
      // Partage annule par l'utilisateur: rien a signaler.
    }
  };

  return (
    <div className="space-y-2">
      {canShare && (
        <>
          <button
            type="button"
            onClick={() => void share()}
            className="flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-beat-400 text-sm font-semibold text-ink-950 active:bg-beat-500 [&>svg]:size-5"
          >
            <ShareIcon />
            {t('result.share')}
          </button>
          <p className="text-center text-xs text-ink-400">{t('result.shareHint')}</p>
        </>
      )}

      <a
        href={url}
        download={fileName}
        className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-ink-600 text-sm font-medium text-ink-50 active:bg-ink-800 [&>svg]:size-4"
      >
        <DownloadIcon />
        {t('result.download')}
      </a>
    </div>
  );
}

/** Nom de fichier sur: on ne laisse passer que des caracteres inoffensifs. */
function sanitizeForFileName(name: string): string {
  const cleaned = name.replace(/[^\p{L}\p{N}\-_ ]/gu, '').trim().slice(0, 60);
  return cleaned.length > 0 ? cleaned : 'reel';
}
