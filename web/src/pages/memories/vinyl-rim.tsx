import {
  ART_PRESETS,
  ArtPreset,
  createArtJob,
  hashString,
} from '@/components/glass-folder/glass-folder';
import { useEffect, useRef, useState } from 'react';

// glacier is nearly white and would read as a broken disc on the dark shelf
const PRESETS: ArtPreset[] = ['aurora', 'ember', 'dusk', 'verdant'];

/** Copies of the artwork laid over each other to drag it along the groove. */
const SMEAR_STEPS = 40;
/** How far the smear travels, in radians. Wide enough to read as a streak,
 *  short enough to keep the stains from averaging into plain rings. */
const SMEAR_ARC = 0.62;

/**
 * The dyed rim of the record.
 *
 * The artwork is painted with the same recipe the folder cards use, then spun
 * a few degrees around the centre so every stain is dragged into an arc: the
 * dye keeps the folder's colour and grain but runs along the grooves instead
 * of across them. Each memory is seeded by its id, so no two records match.
 */
export function VinylRim({ seed }: { seed: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const hash = hashString(seed);
    const preset = PRESETS[hash % PRESETS.length];
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const px = Math.round(196 * dpr);

    // paint the folder artwork
    const job = createArtJob(px, px, ART_PRESETS[preset], (hash % 997) + 1);
    job.step(px);
    const art = document.createElement('canvas');
    art.width = px;
    art.height = px;
    art
      .getContext('2d')
      ?.putImageData(
        new ImageData(job.pixels as Uint8ClampedArray<ArrayBuffer>, px, px),
        0,
        0,
      );

    // spin it: the same field laid down at small rotations around the centre,
    // so each stain smears along its own groove
    const spun = document.createElement('canvas');
    spun.width = px;
    spun.height = px;
    const spin = spun.getContext('2d');
    if (!spin) return;
    spin.globalCompositeOperation = 'lighter';
    spin.globalAlpha = 1 / SMEAR_STEPS;
    for (let i = 0; i < SMEAR_STEPS; i += 1) {
      const turn = (i / (SMEAR_STEPS - 1) - 0.5) * SMEAR_ARC;
      spin.save();
      spin.translate(px / 2, px / 2);
      spin.rotate(turn);
      spin.drawImage(art, -px / 2, -px / 2);
      spin.restore();
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    canvas.width = px;
    canvas.height = px;
    ctx.filter = 'saturate(1.45) contrast(1.08) brightness(1.06)';
    ctx.drawImage(spun, 0, 0);
    setReady(true);
  }, [seed]);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      data-ready={ready || undefined}
      className="absolute inset-0 h-full w-full opacity-0 transition-opacity duration-500 data-[ready]:opacity-100"
    />
  );
}
