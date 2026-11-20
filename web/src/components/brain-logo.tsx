// Brain glyph (top view: two hemispheres, central fissure, brain stem).
// Path geometry derived from the Lucide "brain" icon (ISC licensed).
// The paths are exported so the memory dot field can trace the same glyph.
export const BRAIN_LOGO_PATHS = [
  'M12 18V5',
  'M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4',
  'M17.707 6.294A3 3 0 1 0 12 5a3 3 0 1 0-5.707 1.294',
  'M17.996 5.125a4 4 0 0 1 2.526 5.77',
  'M18 18a4 4 0 0 0 2-7.465',
  'M19.967 17.482a4 4 0 1 1-7.967.517 4 4 0 1 1-7.967-.517',
  'M6 18a4 4 0 0 1-2-7.465',
  'M6.004 5.125a4 4 0 0 0-2.526 5.77',
];

export const BRAIN_LOGO_STROKE = 1.8;

export function BrainLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={BRAIN_LOGO_STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {BRAIN_LOGO_PATHS.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
