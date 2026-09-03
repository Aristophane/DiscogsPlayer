/**
 * Animation de chargement en forme de disque vinyle qui tourne (Lot 6bis).
 *
 * Purement décorative (`aria-hidden`) : le texte porté par le composant appelant est ce
 * que lit un lecteur d'écran, jamais cette icône seule. `animate-spin` est neutralisée
 * par `prefers-reduced-motion` globalement (globals.css), sans rien à faire ici.
 */
export function VinylSpinner({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      aria-hidden="true"
      className={`animate-spin motion-reduce:animate-none ${className ?? ''}`}
    >
      <circle className="fill-foreground" cx="20" cy="20" r="19" />
      <circle
        className="stroke-background"
        cx="20"
        cy="20"
        r="14"
        fill="none"
        strokeWidth="1"
        strokeOpacity="0.35"
      />
      <circle
        className="stroke-background"
        cx="20"
        cy="20"
        r="9"
        fill="none"
        strokeWidth="1"
        strokeOpacity="0.35"
      />
      <circle className="fill-background" cx="20" cy="20" r="4" />
      <circle className="fill-foreground" cx="20" cy="20" r="1.4" />
    </svg>
  );
}
