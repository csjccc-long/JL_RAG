import { CSSProperties } from 'react';

/* A face on the crew row: a few vivid pairs rather than the whole wheel, and
   the seed only picks a slot, so a worker keeps its colour. There are no
   letters on the dot — the dot is the identity, and the name is right below it
   in the list. */
const FACES: Array<[number, number]> = [
  [186, 214], // cyan → blue
  [8, 32], // red → orange
  [330, 288], // pink → magenta
  [150, 190], // green → teal
  [44, 18], // amber → vermilion
  [268, 306], // violet → orchid
];

export const faceTint = (seed: string): CSSProperties => {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) % 100000;
  }
  const [from, to] = FACES[hash % FACES.length];
  return {
    backgroundImage: `linear-gradient(152deg, hsl(${from} 92% 63%), hsl(${to} 96% 56%))`,
  };
};
