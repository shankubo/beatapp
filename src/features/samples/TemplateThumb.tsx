/**
 * Vignette d'un modele: l'illustration, avec le schema de coupe pose dessus.
 *
 * Les deux, et non l'un OU l'autre. L'illustration donne l'INTENTION du modele
 * — un voyage, un avant/apres — ce qu'un diagramme ne saura jamais evoquer.
 * Le schema, lui, dit la CADENCE reelle des coupes et le type de transition,
 * que l'illustration ne peut pas promettre sans mentir (voir l'en-tete de
 * `TemplateSchematic`: les photos de l'utilisateur n'existent pas encore).
 *
 * Le schema est donc conserve, en surimpression sur un degrade qui le detache
 * du bas de l'image. Il reste exact, et la carte gagne le visuel qui lui
 * manquait.
 */

import { TemplateSchematic } from './TemplateSchematic';
import type { Template } from '../../domain/template';

export function TemplateThumb({ template }: { template: Template }) {
  // Chemin prefixe par `import.meta.env.BASE_URL`: sous un sous-chemin, une
  // racine « /steps/… » viserait le domaine et l'image manquerait.
  const base = `${import.meta.env.BASE_URL}steps/${template.thumb}`;

  return (
    <span className="relative block overflow-hidden rounded-lg bg-ink-900">
      {/*
        Ratio fige a celui des sources recadrees (~2,7:1), sinon la grille
        sauterait au chargement de chaque vignette.

        `alt` vide: la carte porte deja le nom et la description du modele en
        texte traduit. Decrire l'illustration ferait tout lire deux fois.
      */}
      <img
        src={`${base}-640.webp`}
        srcSet={`${base}-320.webp 320w, ${base}-640.webp 640w`}
        sizes="(min-width: 640px) 20rem, 45vw"
        alt=""
        aria-hidden="true"
        loading="lazy"
        decoding="async"
        className="aspect-[420/152] w-full object-cover"
      />

      {/*
        Bandeau du schema: une bande BASSE et sombre, pas un calque sur toute la
        vignette.

        Mesure: en couvrant les deux tiers de la hauteur, le schema masquait
        l'illustration qu'il etait cense accompagner — les deux se genaient au
        lieu de se completer. Reduit a une reglette de 10 px sur fond opaque, il
        se lit d'un coup et laisse l'image intacte au-dessus.
      */}
      <span className="absolute inset-x-0 bottom-0 block bg-ink-950/85 px-1.5 py-1 backdrop-blur-[2px]">
        <TemplateSchematic template={template} className="h-2.5 w-full" />
      </span>
    </span>
  );
}
