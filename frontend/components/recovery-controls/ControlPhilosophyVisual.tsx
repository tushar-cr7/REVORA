import Image from 'next/image';

/**
 * Renders the supplied hero artwork exactly as provided — no redraw, no
 * CSS/SVG recreation, no filters that alter its appearance. The image
 * (frontend/public/assets/recovery-controls/control-philosophy-hero.png)
 * was verified before integration to carry a genuine alpha channel (not a
 * baked-in checkerboard), so it blends directly into the dark hero surface.
 * The container is locked to the asset's real aspect ratio so it can scale
 * responsively without ever cropping or distorting the artwork.
 */
export function ControlPhilosophyVisual() {
  return (
    <div className="relative w-full max-w-[480px] aspect-[1944/809] mx-auto shrink-0">
      <Image
        src="/assets/recovery-controls/control-philosophy-hero.png"
        alt="REVORA's autonomous recovery model: the AI suggests an action, a central control gate decides, and the merchant's rules stay in control."
        fill
        sizes="(min-width: 1280px) 480px, 90vw"
        className="object-contain"
        priority
      />
    </div>
  );
}
