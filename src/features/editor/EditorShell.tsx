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

import { Suspense, lazy, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { PreviewCanvas } from '../preview/PreviewCanvas';
import { TimelineScroller } from '../timeline/TimelineScroller';
import { BottomSheet } from '../../components/ui/BottomSheet';
import { IconButton } from '../../components/ui/IconButton';
import { CloseIcon, SparkIcon } from '../../components/ui/icons';
import { CollapseHandle } from '../../components/ui/CollapseHandle';
import { FloatingBar } from './FloatingBar';
import { ToolRail } from './ToolRail';
import { MainMenu } from './MainMenu';
import { PreviewControls } from '../preview/PreviewControls';
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

const AudioStudio = lazy(() =>
  import('../audio/AudioStudio').then((module) => ({ default: module.AudioStudio })),
);

const InstallScreen = lazy(() =>
  import('../install/InstallScreen').then((module) => ({ default: module.InstallScreen })),
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
  full: 'calc(100% - var(--spacing-appbar) - env(safe-area-inset-bottom, 0px))',
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
  const installOpen = useUiStore((state) => state.installOpen);
  const setInstallOpen = useUiStore((state) => state.setInstallOpen);
  const onboardingOpen = useUiStore((state) => state.onboardingOpen);
  const setOnboardingOpen = useUiStore((state) => state.setOnboardingOpen);
  const audioStudioOpen = useUiStore((state) => state.audioStudioOpen);
  const setAudioStudioOpen = useUiStore((state) => state.setAudioStudioOpen);
  const menuOpen = useUiStore((state) => state.menuOpen);
  const setMenuOpen = useUiStore((state) => state.setMenuOpen);
  const fullscreen = useUiStore((state) => state.fullscreen);
  const setFullscreen = useUiStore((state) => state.setFullscreen);
  const timelineCollapsed = useUiStore((state) => state.timelineCollapsed);
  const setTimelineCollapsed = useUiStore((state) => state.setTimelineCollapsed);

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
      {/*
        L'apercu est le seul element extensible: `min-h-0` est indispensable
        pour qu'un enfant flex puisse rapetisser sous sa taille de contenu.

        Il porte desormais TOUTES les commandes en surimpression — plus aucune
        barre ne prend de hauteur. Mesure sur iPhone 15 (393 x 852): la barre du
        haut, celle de transport et les onglets pesaient ensemble 144 px, sur
        l'axe meme qui contraint un apercu 9:16.
      */}
      {/*
        L'apercu se REDUIT quand un panneau s'ouvre, au lieu d'etre recouvert.

        Bug mesure: le panneau est pose en absolu par-dessus l'apercu. A 58 % de
        hauteur il n'en laissait qu'un bandeau, si bien qu'on reglait un zoom ou
        un filtre en ne voyant qu'une tranche de l'image — precisement ce qu'on
        essaie de juger. En bornant la hauteur de l'apercu a l'espace restant,
        le cadre entier reste visible, simplement plus petit.

        `maxHeight` et non `height`: hors panneau, l'apercu doit continuer a
        prendre toute la place disponible.
      */}
      <main
        className={[
          'relative flex min-h-0 flex-1 flex-col transition-[max-height] duration-200 ease-out',
          fullscreen ? 'bg-black' : '',
        ].join(' ')}
        style={
          sheetOpen && !fullscreen
            ? { maxHeight: `calc(100% - ${SHEET_HEIGHT[sheetSnap]})` }
            : undefined
        }
      >
        <PreviewCanvas />

        {/* En plein ecran, seule la lecture subsiste: le reste ferait revenir
            le decor qu'on vient justement de retirer. */}
        {!fullscreen && <FloatingBar />}
        <PreviewControls />
        {/*
          Le rail s'efface quand un panneau est ouvert.

          Piege mesure: le rail est colle au bord droit, exactement ou le
          panneau pose sa croix de fermeture — les deux se superposaient, et la
          croix devenait difficile a viser. Le rail ne sert de toute facon a
          rien pendant qu'on travaille dans un panneau: on en change par la
          croix ou par le menu.
        */}
        {!fullscreen && !sheetOpen && <ToolRail />}
      </main>

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
          // Ancre au bas de l'ecran: la barre d'onglets qui servait d'appui a
          // disparu au profit du rail lateral, qui ne prend aucune hauteur.
          // Seule la zone sure du bas reste a respecter.
          bottom: 'env(safe-area-inset-bottom, 0px)',
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

      {audioStudioOpen && (
        <Suspense fallback={<div className="absolute inset-0 z-40 bg-ink-950" />}>
          <AudioStudio onClose={() => setAudioStudioOpen(false)} />
        </Suspense>
      )}

      {menuOpen && <MainMenu onClose={() => setMenuOpen(false)} />}

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

      {installOpen && (
        <Suspense fallback={<div className="absolute inset-0 z-40 bg-ink-950" />}>
          <InstallScreen onClose={() => setInstallOpen(false)} />
        </Suspense>
      )}

      {/* Charge normalement et non a la demande: cet ecran est sur le chemin du
          premier rendu, et un repli `Suspense` produirait un flash noir. */}
      {onboardingOpen && <OnboardingScreen onClose={() => setOnboardingOpen(false)} />}
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
