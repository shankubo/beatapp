/**
 * Schema d'un modele: une bande de montage vue de dessus.
 *
 * Pourquoi un schema plutot qu'une image de reel: au moment du choix, les
 * photos de l'utilisateur n'existent pas encore. Une vignette animee promettant
 * un resultat que le montage n'aura pas serait pire qu'un diagramme honnete —
 * elle mentirait sur le cadrage, et sur des geometries que le DOM ne sait pas
 * reproduire (`flash`, `zoomIn`, `shutter`).
 *
 * Ce que le schema dit, lui, est exact: la CADENCE des coupes et le TYPE de
 * transition, qui sont precisement ce que le modele va appliquer.
 *
 * Les bornes viennent de `templateCutMarks`, dans le domaine, partagees avec
 * l'apercu anime: deux calculs separes divergeraient.
 */

import { templateCutMarks, type Template } from '../../domain/template';

/** Boite de dessin. Le SVG s'etire ensuite a la largeur de sa carte. */
const VIEW_WIDTH = 100;
const VIEW_HEIGHT = 28;

/** Marge laissee aux extremites, pour que les blocs ne touchent pas le bord. */
const INSET = 1;

export function TemplateSchematic({
  template,
  className = 'h-7 w-full',
}: {
  template: Template;
  /** Surcharge la taille: la vignette pose le schema en reglette basse. */
  className?: string;
}) {
  const marks = templateCutMarks(template);

  /*
    Bornes des blocs: 0, les coupes, puis 1.

    `templateCutMarks` ne rend que les jointures INTERNES — les bords de la bande
    n'en sont pas. On les rajoute ici pour former les segments.
  */
  const edges = [0, ...marks, 1];
  const segments = edges.slice(0, -1).map((from, index) => ({
    from,
    to: edges[index + 1]!,
  }));

  const transitionType = template.transition.type;

  return (
    <svg
      viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
      // Le schema redit visuellement ce que le texte de la carte annonce; le
      // faire lire deux fois generait un lecteur d'ecran.
      aria-hidden="true"
      className={className}
      preserveAspectRatio="none"
    >
      {/*
        Les blocs en `media-400`: c'est la famille image/video, et un plan EST
        une image. Le chartreuse est reserve au rythme, et sert plus bas pour
        les coupes — qui, elles, en sont.
      */}
      {segments.map((segment) => {
        const x = INSET + segment.from * (VIEW_WIDTH - INSET * 2);
        const width = (segment.to - segment.from) * (VIEW_WIDTH - INSET * 2);
        return (
          <rect
            key={segment.from}
            x={x}
            y={4}
            // Une largeur nulle ne dessinerait rien: un modele a 16 plans
            // produit des blocs tres fins, qui doivent rester visibles.
            width={Math.max(0.8, width - 1)}
            height={VIEW_HEIGHT - 8}
            rx={1.5}
            className="fill-media-400/70"
          />
        );
      })}

      {/*
        Marque de coupe. Sa FORME dit la transition, ce qui differencie deux
        modeles de meme cadence — « Coupes rapides » et un fondu serre n'ont pas
        le meme rendu, et le schema doit le montrer.
      */}
      {marks.map((mark) => {
        const x = INSET + mark * (VIEW_WIDTH - INSET * 2);
        return <CutMark key={mark} x={x} type={transitionType} />;
      })}
    </svg>
  );
}

function CutMark({ x, type }: { x: number; type: Template['transition']['type'] }) {
  // Coupe franche: un trait net, pleine hauteur.
  if (type === 'none') {
    return (
      <rect x={x - 0.3} y={2} width={0.6} height={VIEW_HEIGHT - 4} className="fill-beat-400" />
    );
  }

  // Flash: un halo clair, comme le voile blanc qu'il produit reellement.
  if (type === 'flash') {
    return (
      <>
        <rect x={x - 1.6} y={2} width={3.2} height={VIEW_HEIGHT - 4} className="fill-beat-400/30" />
        <rect x={x - 0.4} y={1} width={0.8} height={VIEW_HEIGHT - 2} className="fill-beat-400" />
      </>
    );
  }

  // Zoom: un chevron, qui dit le mouvement vers l'avant.
  if (type === 'zoomIn') {
    const half = VIEW_HEIGHT / 2;
    return (
      <path
        d={`M${x - 1.4} 5 L${x + 1.2} ${half} L${x - 1.4} ${VIEW_HEIGHT - 5}`}
        className="stroke-beat-400"
        strokeWidth={0.9}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  }

  // Fondu et glissements: une zone de recouvrement, plus large quand la
  // transition est longue.
  return (
    <rect x={x - 1.1} y={4} width={2.2} height={VIEW_HEIGHT - 8} className="fill-beat-400/45" />
  );
}
