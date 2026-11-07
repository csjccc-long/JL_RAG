/**
 * Brain print used as a watermark on the memory tile: two hemispheres with a
 * central fissure, a scalloped cortex edge, gyri folds and a cerebellum arc.
 */
const BRAIN_PATHS = [
  'M12 17.8V5.2',
  'M15 12.9a4.2 4.2 0 0 1-3-3.9 4.2 4.2 0 0 1-3 3.9',
  'M17.7 6.3A3 3 0 1 0 12 5a3 3 0 1 0-5.7 1.3',
  'M18 5.1a4 4 0 0 1 2.5 5.8',
  'M18 18a4 4 0 0 0 2-7.5',
  'M6 18a4 4 0 0 1-2-7.5',
  'M6 5.1a4 4 0 0 0-2.5 5.8',
  'M20 17.5a4 4 0 1 1-8 0 4 4 0 1 1-8 0',
  'M5.6 9.2c1.1-.5 2.4-.2 3.2.7',
  'M5.2 12.2c1.2-.5 2.6-.2 3.5.8',
  'M6.6 15.2c.9-.5 2-.4 2.8.3',
  'M18.4 9.2c-1.1-.5-2.4-.2-3.2.7',
  'M18.8 12.2c-1.2-.5-2.6-.2-3.5.8',
  'M17.4 15.2c-.9-.5-2-.4-2.8.3',
  'M9.2 6.6c.8.3 1.4 1 1.6 1.9',
  'M7.2 10.3c.5.7.6 1.5.4 2.3',
  'M8.3 13.8c.8.2 1.4.8 1.6 1.6',
  'M14.8 6.6c-.8.3-1.4 1-1.6 1.9',
  'M16.8 10.3c-.5.7-.6 1.5-.4 2.3',
  'M15.7 13.8c-.8.2-1.4.8-1.6 1.6',
];

export function MemoryBrainWatermark({ size = 88 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={44 / size}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-text-primary opacity-[0.12] transition-opacity duration-300 group-hover:opacity-[0.18]"
    >
      {BRAIN_PATHS.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
