import { useCallback, useEffect, useRef, useState } from 'react';
import {
  motion,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from 'framer-motion';

import { HomeFlowerO } from './home-flower-o';
import './home-hero.css';

/* Editorial hero for the home poster: the ink-splash intro, the letter masks,
   and the ink spotlight are a front-end transcription of the Elias layout
   reference the user supplied — same beats, same easing, this project's tokens. */

const EASE = [0.16, 1, 0.3, 1] as const;
const SWEEP_EASE = [0.76, 0, 0.24, 1] as const;

const LETTER_STAGGER = 0.05;
const LETTER_DURATION = 1.05;

const SPLASH = {
  drawAt: 0.1,
  drawDuration: 0.8,
  floodAt: 0.72,
  floodDuration: 0.7,
  openAt: 1.5,
  openDuration: 0.9,
  fontTimeout: 1.2,
};

const LINE_A = 'KNOWLEDGE';
const LINE_B = 'BECOMES ANSWERS';

const SPOT_RADIUS = 150;

type MaskedWordProps = {
  text: string;
  className: string;
  started: boolean;
  from: 'below' | 'above';
  delay: number;
  reverse?: boolean;
  still?: boolean;
  /** Index of the letter the bloom replaces, if any. */
  flowerAt?: number;
};

function MaskedWord({
  text,
  className,
  started,
  from,
  delay,
  reverse = false,
  still = false,
  flowerAt = -1,
}: MaskedWordProps) {
  const letters = Array.from(text);
  return (
    <span className={className}>
      {letters.map((char, index) => {
        const order = reverse ? letters.length - 1 - index : index;
        const offset = from === 'below' ? '108%' : '-108%';
        const bloom = index === flowerAt && !still;
        const content = bloom ? (
          <HomeFlowerO />
        ) : char === ' ' ? (
          '\u00A0'
        ) : (
          char
        );
        return (
          <span className="home-hero__mask" key={index}>
            {still ? (
              <span className="home-hero__letter">{char === ' ' ? '\u00A0' : char}</span>
            ) : (
              <motion.span
                className={bloom ? 'home-hero__letter home-hero__letter--o' : 'home-hero__letter'}
                initial={{ y: offset }}
                animate={started ? { y: '0%' } : { y: offset }}
                transition={{
                  delay: delay + order * LETTER_STAGGER,
                  duration: LETTER_DURATION,
                  ease: EASE,
                }}
              >
                {content}
              </motion.span>
            )}
          </span>
        );
      })}
    </span>
  );
}

function InkSplash({ onOpen }: { onOpen: () => void }) {
  const [tracing, setTracing] = useState(false);
  const [done, setDone] = useState(false);
  const openedRef = useRef(false);
  const hole = useMotionValue(0);
  const holeEdge = useTransform(hole, (value) => Math.max(0, value - 1));
  const maskImage = useMotionTemplate`radial-gradient(circle ${hole}px at 50% 50%, transparent ${holeEdge}px, #000 ${hole}px)`;

  const open = useCallback(() => {
    if (openedRef.current) return;
    openedRef.current = true;
    // The name starts rising under the curtain, so the reveal hands over to a
    // moving page instead of an empty one.
    onOpen();
    const radius = Math.hypot(window.innerWidth, window.innerHeight) / 2 + 24;
    const started = performance.now();
    const step = () => {
      const t = Math.min((performance.now() - started) / (SPLASH.openDuration * 1000), 1);
      const eased = 1 - Math.pow(1 - t, 3);
      hole.set(radius * eased);
      if (t < 1) {
        window.requestAnimationFrame(step);
        return;
      }
      setDone(true);
    };
    window.requestAnimationFrame(step);
  }, [hole, onOpen]);

  useEffect(() => {
    const body = document.body;
    const previous = body.style.overflow;
    body.style.overflow = 'hidden';
    return () => {
      body.style.overflow = previous;
    };
  }, []);

  useEffect(() => {
    // Draw immediately: the splash sets the typeface explicitly, so a slow
    // webfont must not leave the plate blank while it loads.
    const timer = window.setTimeout(() => setTracing(true), 40);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(open, SPLASH.openAt * 1000);
    const skip = () => open();
    window.addEventListener('keydown', skip);
    window.addEventListener('pointerdown', skip);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('keydown', skip);
      window.removeEventListener('pointerdown', skip);
    };
  }, [open]);

  if (done) return null;

  return (
    <motion.div
      className="home-hero__splash"
      style={{ maskImage, WebkitMaskImage: maskImage }}
      aria-hidden="true"
    >
      <svg className="home-hero__splash-svg" viewBox="0 0 1000 560" role="presentation">
        <defs>
          <filter id="home-hero-outline" x="-20%" y="-30%" width="140%" height="160%">
            <feMorphology in="SourceAlpha" operator="erode" radius="2" result="shrunk" />
            <feComposite in="SourceGraphic" in2="shrunk" operator="out" />
          </filter>
        </defs>
        <motion.g
          style={{ filter: 'url(#home-hero-outline)' }}
          initial={{ clipPath: 'inset(-20% 100% -20% 0%)' }}
          animate={{ clipPath: tracing ? 'inset(-20% 0% -20% 0%)' : 'inset(-20% 100% -20% 0%)' }}
          transition={{ delay: SPLASH.drawAt, duration: SPLASH.drawDuration, ease: SWEEP_EASE }}
        >
          <text className="home-hero__splash-line home-hero__splash-line--a" x="500" y="252">
            {LINE_A}
          </text>
          <text className="home-hero__splash-line home-hero__splash-line--b" x="500" y="452">
            {LINE_B}
          </text>
        </motion.g>
        <motion.g
          initial={{ clipPath: 'inset(-20% 100% -20% 0%)' }}
          animate={{ clipPath: tracing ? 'inset(-20% 0% -20% 0%)' : 'inset(-20% 100% -20% 0%)' }}
          transition={{ delay: SPLASH.floodAt, duration: SPLASH.floodDuration, ease: SWEEP_EASE }}
        >
          <text className="home-hero__splash-line home-hero__splash-line--a" x="500" y="252">
            {LINE_A}
          </text>
          <text className="home-hero__splash-line home-hero__splash-line--b" x="500" y="452">
            {LINE_B}
          </text>
        </motion.g>
      </svg>
    </motion.div>
  );
}

export function HomeHero() {
  const [started, setStarted] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const reduced = useReducedMotion();
  const spotX = useMotionValue(-999);
  const spotY = useMotionValue(-999);
  const spot = useSpring(0, { stiffness: 380, damping: 36, mass: 0.6 });
  const depthX = useSpring(0, { stiffness: 50, damping: 18, mass: 0.9 });
  const depthY = useSpring(0, { stiffness: 50, damping: 18, mass: 0.9 });

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const unsubscribeSpot = spot.on('change', (value) => {
      root.style.setProperty('--hero-spot-r', `${value}px`);
    });
    const unsubscribeX = spotX.on('change', (value) => {
      root.style.setProperty('--hero-spot-x', `${value}px`);
    });
    const unsubscribeY = spotY.on('change', (value) => {
      root.style.setProperty('--hero-spot-y', `${value}px`);
    });
    const unsubscribeDepthX = depthX.on('change', (value) => {
      root.style.setProperty('--hero-depth-x', `${value}px`);
    });
    const unsubscribeDepthY = depthY.on('change', (value) => {
      root.style.setProperty('--hero-depth-y', `${value}px`);
    });
    return () => {
      unsubscribeSpot();
      unsubscribeX();
      unsubscribeY();
      unsubscribeDepthX();
      unsubscribeDepthY();
    };
  }, [depthX, depthY, spot, spotX, spotY]);

  useEffect(() => {
    if (reduced) return undefined;
    const root = rootRef.current;
    if (!root) return undefined;
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
    const wide = window.matchMedia('(min-width: 1024px)');
    const onMove = (event: PointerEvent) => {
      const rect = root.getBoundingClientRect();
      spotX.set(event.clientX - rect.left);
      spotY.set(event.clientY - rect.top);
      if (fine.matches && wide.matches) spot.set(SPOT_RADIUS);
      const nx = (event.clientX / window.innerWidth) * 2 - 1;
      const ny = (event.clientY / window.innerHeight) * 2 - 1;
      depthX.set(-nx * 7);
      depthY.set(-ny * 5);
    };
    const onLeave = () => {
      spot.set(0);
      depthX.set(0);
      depthY.set(0);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onMove);
      document.removeEventListener('pointerleave', onLeave);
    };
  }, [depthX, depthY, reduced, spot, spotX, spotY]);

  const baseName = (still: boolean) => (
    <h1 className={still ? 'home-hero__name home-hero__name--ink' : 'home-hero__name'}>
      <MaskedWord
        text={LINE_A}
        className="home-hero__line home-hero__line--a"
        started={started}
        from="below"
        delay={0.1}
        still={still}
        flowerAt={2}
      />
      <MaskedWord
        text={LINE_B}
        className="home-hero__line home-hero__line--b"
        started={started}
        from="above"
        delay={0.26}
        reverse
        still={still}
      />
    </h1>
  );

  return (
    <div className="home-hero" ref={rootRef}>
      <div className="home-hero__layer home-hero__layer--base">{baseName(false)}</div>
      <div className="home-hero__layer home-hero__layer--ink" aria-hidden="true">
        {baseName(true)}
      </div>
      <InkSplash onOpen={() => setStarted(true)} />
    </div>
  );
}
