import type { CSSProperties, ReactElement } from 'react';

export type CrystalizedBallMotion = 'rise' | 'fall' | 'drift' | 'orbit';
export type CrystalizedBallShape = 'square' | 'round';
export type CrystalizedBallPreset =
  | 'plasma'
  | 'aurora'
  | 'nebula'
  | 'ember'
  | 'frost'
  | 'solar'
  | 'eclipse'
  | 'abyss';

export interface CrystalizedBallProps {
  preset?: CrystalizedBallPreset;
  color?: string;
  theme?: 'dark' | 'light';
  size?: number;
  strands?: number;
  crackle?: number;
  flares?: number;
  glow?: number;
  sparks?: number;
  particleCount?: number;
  fill?: number;
  motion?: CrystalizedBallMotion;
  particleShape?: CrystalizedBallShape;
  depth?: number;
  sway?: number;
  twinkle?: number;
  haze?: number;
  speed?: number;
  dustSpeed?: number;
  interactive?: boolean;
  hoverStrength?: number;
  intro?: boolean;
  paused?: boolean;
  burstOnClick?: boolean;
  className?: string;
  style?: CSSProperties;
}

declare function CrystalizedBall(props: CrystalizedBallProps): ReactElement;

export default CrystalizedBall;
