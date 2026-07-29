/**
 * Coquille de l'editeur: la mise en page mobile.
 *
 * Structure en grille verticale, hauteurs fixes sauf l'apercu qui absorbe
 * l'espace restant. Ouvrir un panneau REDUIT l'apercu au lieu de le recouvrir:
 * l'utilisateur voit toujours ce qu'il edite.
 *
 * Aucun defilement de page: tout tient dans la hauteur visible (`100dvh`), et
 * seuls les contenus de panneau defilent.
 */

import { Suspense, lazy, useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { PreviewCanvas } from '../preview/PreviewCanvas';
import { TransportBar } from '../preview/TransportBar';
import { TimelineScroller } from '../timeline/TimelineScroller';
import { ToolTabs } from './ToolTabs';
import { AppBar } from './AppBar';
import { BottomSheet } from '../../components/ui/BottomSheet';
import { IconButton } from '../../components/ui/IconButton';
import { CloseIcon, SparkIcon } from '../../components/ui/icons';
import { CollapseHandle } from '../../components/ui/CollapseHandle';
import { Toaster } from '../../components/ui/Toaster';
import { MediaSheet } from '../import/MediaSheet';
import { EditSheet } from '../edit/EditSheet';
import { AudioSheet } from '../audio/AudioSheet';
import { BeatSheet } from '../audio/BeatSheet';
import { TextSheet } from '../text/TextSheet';
import { EffectsSheet } from '../effects/EffectsSheet';
import { OnboardingScreen } from '../onboarding/OnboardingScreen';
import { useUiStore, type SheetSnap, type ToolTab } from '../../store/useUiStore';

/**
 * L'ecran d'export est charge a la demande: il entraine tout le pipeline
 * mediabunny (plusieurs centaines de kilo-octets), inutile pour qui ouvre
 * simplement l'application pour monter un reel.
 */
const ExportScreen = lazy(() =>
  import('../export/ExportScreen').then((module) => ({ default: module.ExportScreen })),
);

const AboutScreen = lazy(() =>
  import('../about/AboutScreen').then((module) => ({ default: module.AboutScreen })),
);
const SettingsScreen = lazy(() =>
  import('../settings/SettingsScreen').then((module) => ({ default: module.SettingsScreen })),
);

/**
 * La galerie de modeles est chargee a la demande elle aussi: elle entraine le
 * graphe de scene et le compositeur pour son apercu anime, alors qu'ouvrir
 * l'editeur n'en a pas besoin.
 */
const TemplatesScreen = lazy(() =>
  import('../samples/TemplatesScreen').then((module) => ({ default: module.TemplatesScreen })),
);

/**
 * Hauteur d'un panneau, selon son cran.
 *
 * Exprimee en fraction de la hauteur VISIBLE moins la barre d'onglets, car le
 * panneau est pose au-dessus de la timeline et non a cote d'elle. L'ancienne
 * version reservait jusqu'a 78 % de l'ecran a un panneau AJOUTE aux 252 px de
 * rangees fixes (barre, transport, regle, bande, onglets): le total depassait la
 * hauteur disponible, le conteneur flex rognait le panneau, et le bas de son
 * contenu devenait inatteignable — la liste des medias paraissait tronquee.
 */
const SHEET_HEIGHT: Record<SheetSnap, string> = {
  closed: '0px',
  peek: '30%',
  half: '58%',
  /**
   * Cran haut: tout l'espace SAUF la barre d'onglets et un bandeau de titre.
   *
   * Le pourcentage se rapporte a la coquille entiere, alors que le panneau est
   * ancre au-dessus de la barre d'onglets: il faut donc retrancher cette barre
   * EN PLUS du bandeau, sinon le haut du panneau — coins arrondis et poignee
   * comprises — depasse au-dessus de la zone visible. Mesure avant correction:
   * `top: -12px`.
   */
  full: 'calc(100% - var(--spacing-appbar) - var(--spacing-tabs) - env(safe-area-inset-bottom, 0px))',
};

/**
 * Cran a partir duquel la timeline s'efface.
 *
 * Seulement au cran le plus haut. Elle s'effacait des « half », ce qui retirait
 * la piste texte au moment precis ou l'on edite du texte — le panneau Texte
 * s'ouvre justement a « half ». A ce cran la timeline reste visible sous le
 * panneau, donc on la garde.
 */
const HIDES_TIMELINE: readonly SheetSnap[] = ['full'];

/**
 * Hauteur occupee par la timeline et la barre d'onglets, en mode compact.
 *
 * Le transport s'ancre juste au-dessus: pose en bas d'ecran il passerait sous la
 * timeline, et le laisser flotter au milieu de l'image le rendrait plus difficile
 * a viser au pouce qu'avant.
 */
/** Hauteur d'une poignee de pliage. Doit suivre `CollapseHandle`. */
const HANDLE_HEIGHT = '18px';

/**
 * Ou poser le transport superpose: juste au-dessus de tout ce qui suit.
 *
 * Calcule et non code en dur, car deux elements peuvent se replier
 * independamment. Un offset fige laissait le transport flotter au milieu de
 * l'image des qu'on repliait la timeline.
 */
function transportOffset(timelineCollapsed: boolean, tabsCollapsed: boolean): string {
  const parts = [HANDLE_HEIGHT, 'env(safe-area-inset-bottom, 0px)'];
  // La poignee de la timeline reste visible meme repliee.
  parts.push(HANDLE_HEIGHT);
  if (!timelineCollapsed) {
    parts.push('var(--spacing-ruler)', '2 * var(--spacing-strip)');
  }
  if (!tabsCollapsed) parts.push('var(--spacing-tabs)');
  return `calc(${parts.join(' + ')})`;
}

export function EditorShell() {
  const { t } = useTranslation(['editor', 'common']);

  const activeTab = useUiStore((state) => state.activeTab);
  const sheetSnap = useUiStore((state) => state.sheetSnap);
  const setSheetSnap = useUiStore((state) => state.setSheetSnap);
  const closeSheet = useUiStore((state) => state.closeSheet);
  const exportOpen = useUiStore((state) => state.exportOpen);
  const setExportOpen = useUiStore((state) => state.setExportOpen);
  const settingsOpen = useUiStore((state) => state.settingsOpen);
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen);
  const templatesOpen = useUiStore((state) => state.templatesOpen);
  const setTemplatesOpen = useUiStore((state) => state.setTemplatesOpen);
  const aboutOpen = useUiStore((state) => state.aboutOpen);
  const setAboutOpen = useUiStore((state) => state.setAboutOpen);
  const onboardingOpen = useUiStore((state) => state.onboardingOpen);
  const setOnboardingOpen = useUiStore((state) => state.setOnboardingOpen);
  const fullscreen = useUiStore((state) => state.fullscreen);
  const setFullscreen = useUiStore((state) => state.setFullscreen);
  const compactChrome = useUiStore((state) => state.compactChrome);
  const timelineCollapsed = useUiStore((state) => state.timelineCollapsed);
  const setTimelineCollapsed = useUiStore((state) => state.setTimelineCollapsed);
  const appBarCollapsed = useUiStore((state) => state.appBarCollapsed);
  const setAppBarCollapsed = useUiStore((state) => state.setAppBarCollapsed);
  const transportCollapsed = useUiStore((state) => state.transportCollapsed);
  const setTransportCollapsed = useUiStore((state) => state.setTransportCollapsed);
  const tabsCollapsed = useUiStore((state) => state.tabsCollapsed);
  const setTabsCollapsed = useUiStore((state) => state.setTabsCollapsed);

  const sheetOpen = activeTab !== null && sheetSnap !== 'closed';

  // Echap quitte le plein ecran: geste attendu partout.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [fullscreen, setFullscreen]);

  return (
    <div className="relative flex h-dvh flex-col overflow-hidden bg-ink-950">
      {/*
        Le plein ecran est un MODE DE MISE EN PAGE, pas une superposition avec
        son propre apercu. Monter un second `PreviewCanvas` creerait un second
        `Player`, et les deux planifieraient leur audio dans la meme destination:
        le son serait double. Ici, le canvas reste unique et c'est le decor
        autour de lui qui s'efface.
      */}
      {/*
        En mode compact, la barre de titre passe en SUPERPOSITION.

        Mesure faite sur 390x844: la rendre simplement translucide ne gagnerait
        rien du tout — une barre translucide occupe toujours sa hauteur, et
        l'apercu resterait a 291 px de large. C'est le fait de la sortir du flux
        qui rend les 44 px a l'image.
      */}
      {!fullscreen && (
        // En superposition ou dans le flux, la barre et sa poignee restent
        // solidaires: seul le conteneur change.
        <Chrome overlay={compactChrome} position="top">
          {!appBarCollapsed && <AppBar translucent={compactChrome} />}
          <CollapseHandle
            side="top"
            collapsed={appBarCollapsed}
            onToggle={() => setAppBarCollapsed(!appBarCollapsed)}
            label={t(appBarCollapsed ? 'editor:chrome.expandBar' : 'editor:chrome.collapseBar')}
          />
        </Chrome>
      )}

      {/*
        L'apercu est le seul element extensible: `min-h-0` est indispensable
        pour qu'un enfant flex puisse rapetisser sous sa taille de contenu.
      */}
      <main className={['flex min-h-0 flex-1 flex-col', fullscreen ? 'bg-black' : ''].join(' ')}>
        <PreviewCanvas />
      </main>

      {/* Le transport survit au plein ecran: un apercu qu'on ne peut ni lancer
          ni mettre en pause ne servirait qu'a regarder une image fixe. */}
      {fullscreen ? (
        <div className="safe-pb shrink-0">
          <TransportBar />
        </div>
      ) : (
        /*
          En superposition, le transport s'ancre AU-DESSUS de la timeline, qui
          garde sa place dans le flux: il doit rester atteignable au pouce, pas
          fuir en bas d'ecran.

          L'ancrage suit l'etat plie de la timeline ET des onglets: sans cela,
          replier la timeline laissait le transport flotter 182 px trop haut, au
          milieu de l'image.
        */
        <Chrome
          overlay={compactChrome}
          position="bottom"
          bottomOffset={transportOffset(timelineCollapsed, tabsCollapsed)}
        >
          <CollapseHandle
            side="bottom"
            collapsed={transportCollapsed}
            onToggle={() => setTransportCollapsed(!transportCollapsed)}
            label={t(
              transportCollapsed
                ? 'editor:chrome.expandTransport'
                : 'editor:chrome.collapseTransport',
            )}
          />
          {!transportCollapsed && <TransportBar translucent={compactChrome} />}
        </Chrome>
      )}

      {/* La timeline s'efface sous un panneau haut: la laisser depasser a
          moitie derriere le panneau n'apporterait rien. */}
      {!fullscreen && !(sheetOpen && HIDES_TIMELINE.includes(sheetSnap)) && (
        <>
          {/* Le plus gros gain des quatre: la timeline pese 182 px, soit plus
              que toutes les autres barres reunies. */}
          <CollapseHandle
            side="bottom"
            collapsed={timelineCollapsed}
            onToggle={() => setTimelineCollapsed(!timelineCollapsed)}
            label={t(
              timelineCollapsed ? 'editor:timeline.expand' : 'editor:timeline.collapse',
            )}
          />
          {!timelineCollapsed && <TimelineScroller />}
        </>
      )}

      {fullscreen && (
        <div className="safe-pt pointer-events-none absolute inset-x-0 top-0 z-30 flex justify-end p-2">
          <div className="pointer-events-auto rounded-full bg-ink-950/60 backdrop-blur-sm">
            <IconButton
              label={t('editor:preview.exitFullscreen')}
              onClick={() => setFullscreen(false)}
              size="sm"
            >
              <CloseIcon />
            </IconButton>
          </div>
        </div>
      )}

      {/*
        Le panneau est pose AU-DESSUS de la timeline, ancre juste au-dessus de la
        barre d'onglets — et non insere dans la colonne comme une rangee de plus.

        C'est ce qui permet a un panneau d'occuper presque tout l'ecran: en
        rangee, sa hauteur s'ajoutait aux 252 px de rangees fixes et le total
        depassait la hauteur visible, si bien que le contenu se faisait rogner
        par le bas.
      */}
      <div
        className="absolute inset-x-0 z-20 overflow-hidden transition-[height] duration-200 ease-out"
        style={{
          // La barre d'onglets porte `safe-pb`: sa hauteur reelle inclut la zone
          // sure du bas, qu'il faut donc ajouter ici pour poser le panneau
          // exactement dessus.
          bottom: 'calc(var(--spacing-tabs) + env(safe-area-inset-bottom, 0px))',
          height: sheetOpen ? SHEET_HEIGHT[sheetSnap] : '0px',
        }}
      >
        {activeTab && (
          <BottomSheet
            open={sheetOpen}
            snap={sheetSnap}
            onSnapChange={setSheetSnap}
            onClose={closeSheet}
            title={t(`editor:tabs.${activeTab}`)}
            closeLabel={t('common:action.close')}
          >
            <SheetContent tab={activeTab} />
          </BottomSheet>
        )}
      </div>

      {!fullscreen && (
        <>
          {/*
            Replier les onglets n'agrandit PAS l'apercu.

            Mesure sur 390x844: une fois la timeline repliee, le chrome tombe
            sous 151 px et l'apercu 9:16 devient limite par la LARGEUR de l'ecran
            (390 px). Les 56 px des onglets rendent donc de la hauteur que
            personne ne voit. La poignee reste utile pour degager la vue — pas
            pour agrandir l'image, et l'interface ne le promet pas.
          */}
          <CollapseHandle
            side="bottom"
            collapsed={tabsCollapsed}
            onToggle={() => setTabsCollapsed(!tabsCollapsed)}
            label={t(tabsCollapsed ? 'editor:chrome.expandTabs' : 'editor:chrome.collapseTabs')}
          />
          {!tabsCollapsed && <ToolTabs />}
        </>
      )}

      <Toaster />

      {exportOpen && (
        // Le repli est un simple voile: le chargement du chunk est bref, et un
        // indicateur plus voyant clignoterait pour rien.
        <Suspense fallback={<div className="absolute inset-0 z-40 bg-ink-950" />}>
          <ExportScreen onClose={() => setExportOpen(false)} />
        </Suspense>
      )}

      {settingsOpen && (
        // Meme chargement differe que l'export: les reglages ne sont pas sur le
        // chemin du premier rendu.
        <Suspense fallback={<div className="absolute inset-0 z-40 bg-ink-950" />}>
          <SettingsScreen onClose={() => setSettingsOpen(false)} />
        </Suspense>
      )}

      {templatesOpen && (
        <Suspense fallback={<div className="absolute inset-0 z-40 bg-ink-950" />}>
          <TemplatesScreen onClose={() => setTemplatesOpen(false)} />
        </Suspense>
      )}

      {aboutOpen && (
        // Chargement differe comme les autres ecrans pleins: une page de texte
        // n'a rien a faire dans le bundle du premier rendu.
        <Suspense fallback={<div className="absolute inset-0 z-40 bg-ink-950" />}>
          <AboutScreen onClose={() => setAboutOpen(false)} />
        </Suspense>
      )}

      {/* Charge normalement et non a la demande: cet ecran est sur le chemin du
          premier rendu, et un repli `Suspense` produirait un flash noir. */}
      {onboardingOpen && <OnboardingScreen onClose={() => setOnboardingOpen(false)} />}
    </div>
  );
}

/**
 * Enveloppe d'une barre de decor.
 *
 * `overlay` la sort du flux pour qu'elle se pose SUR l'apercu. Sans cette
 * bascule, chaque barre devait etre ecrite deux fois — une version dans le flux,
 * une version superposee — et la poignee de pliage avec elle.
 */
function Chrome({
  overlay,
  position,
  bottomOffset,
  children,
}: {
  overlay: boolean;
  position: 'top' | 'bottom';
  /** Ancre du bas en mode superpose: la barre doit rester au-dessus du reste. */
  bottomOffset?: string;
  children: ReactNode;
}) {
  if (!overlay) return <>{children}</>;

  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-30"
      style={position === 'top' ? { top: 0 } : { bottom: bottomOffset ?? 0 }}
    >
      <div className="pointer-events-auto">{children}</div>
    </div>
  );
}

function SheetContent({ tab }: { tab: ToolTab }) {
  switch (tab) {
    case 'media':
      return (
        <div className="space-y-6">
          <MediaSheet />
          {/*
            Un bouton vers la page, et non la galerie elle-meme.

            Elle etait rendue ici, sous TOUTE la liste des medias: invisible en
            pratique. Un lien depuis l'onglet Media garde le point d'entree — on
            arrive ici apres avoir importe, donc au moment ou un modele sert le
            plus — sans enterrer le contenu.
          */}
          <TemplatesLink />
        </div>
      );
    case 'edit':
      return <EditSheet />;
    case 'audio':
      return <AudioSheet />;
    case 'text':
      return <TextSheet />;
    case 'effects':
      return <EffectsSheet />;
    case 'beat':
      return <BeatSheet />;
  }
}

/** Entree vers la galerie de modeles, depuis l'onglet Media. */
function TemplatesLink() {
  const { t } = useTranslation(['samples']);
  const setTemplatesOpen = useUiStore((state) => state.setTemplatesOpen);

  return (
    <button
      type="button"
      onClick={() => setTemplatesOpen(true)}
      className="surface flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-ink-600 bg-ink-850 text-sm font-medium text-ink-200 active:bg-ink-800 [&>svg]:size-4"
    >
      <SparkIcon />
      {t('samples:templates.open')}
    </button>
  );
}
