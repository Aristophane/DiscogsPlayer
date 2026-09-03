import Image from 'next/image';

import logo from '../../../public/logo.png';

/**
 * Logo (choisi par l'utilisateur, 2026-09-03) : un « D » dont le corps porte un
 * triangle de lecture en négatif — Dig, lecteur de collection Discogs.
 *
 * Asset local (`public/logo.png`, noir sur fond transparent) plutôt qu'un tracé refait à
 * la main : la fidélité à l'image fournie l'exige, ce qu'une approximation SVG n'aurait
 * pas garanti. `next/image` s'applique ici (contrairement à `AlbumCover`, qui l'évite
 * exprès) : c'est un fichier local optimisable, pas une image Discogs distante protégée
 * contre le hotlinking (SPEC-GAPS G-03).
 *
 * `.logo-image` (globals.css) inverse le noir en blanc en thème sombre — un aplat noir
 * fixe serait invisible sur le fond sombre de l'application, contrairement à
 * `VinylSpinner`, dont le tracé SVG suit `fill-foreground` nativement.
 */
/** Ratio réel du fichier (366×400) : `size` fixe la hauteur, la largeur en découle. */
const ASPECT_RATIO = 366 / 400;

export function Logo({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <Image
      src={logo}
      alt=""
      height={size}
      width={Math.round(size * ASPECT_RATIO)}
      className={`logo-image ${className ?? ''}`}
    />
  );
}
