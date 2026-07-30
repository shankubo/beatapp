/**
 * QR code rendu en SVG.
 *
 * SVG et non canvas: net a toutes les tailles et a toutes les densites d'ecran,
 * sans avoir a gerer le `devicePixelRatio`. Un QR code flou ne se scanne pas.
 *
 * Fond CLAIR impose, meme si l'application est sombre. Mesure connue des
 * lecteurs: l'inversion (modules clairs sur fond sombre) n'est pas garantie par
 * la norme, et plusieurs appareils photo de telephone refusent de la lire. La
 * vignette blanche est donc une contrainte de fonctionnement, pas un choix
 * esthetique.
 */

import { useMemo } from 'react';

import { encodeQr, qrPath } from '../../domain/qrcode';

interface QrCodeProps {
  /** Contenu encode. */
  value: string;
  /** Description pour les lecteurs d'ecran. */
  label: string;
  className?: string;
}

/**
 * Marge blanche autour du code, en modules.
 *
 * Quatre est le minimum de la norme: en dessous, le lecteur ne distingue plus
 * le code de ce qui l'entoure.
 */
const QUIET_ZONE = 4;

export function QrCode({ value, label, className }: QrCodeProps) {
  // L'encodage est deterministe et couteux au regard d'un rendu: on ne le
  // refait que si l'adresse change, ce qui n'arrive jamais en pratique.
  const { path, side } = useMemo(() => {
    const matrix = encodeQr(value);
    return { path: qrPath(matrix), side: matrix.size + QUIET_ZONE * 2 };
  }, [value]);

  return (
    <svg
      viewBox={`0 0 ${side} ${side}`}
      role="img"
      aria-label={label}
      className={className}
      // `crispEdges` desactive l'antialiasing: un module a demi teinte brouille
      // la frontiere que le lecteur cherche justement a trancher.
      shapeRendering="crispEdges"
    >
      <rect width={side} height={side} fill="#ffffff" />
      <path d={path} fill="#000000" transform={`translate(${QUIET_ZONE} ${QUIET_ZONE})`} />
    </svg>
  );
}
