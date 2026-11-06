import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

const ReducedMotion = '(prefers-reduced-motion: reduce)';

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.(ReducedMotion).matches ?? false);

type RowMetric = { top: number; height: number };

type MarqueeState = { x: number; part: number; spin: number; covered: boolean };

type BandState = {
  top: number;
  bottom: number;
  vTop: number;
  vBottom: number;
  toTop: number;
  toBottom: number;
  lead: 1 | -1;
  shown: boolean;
  index: number;
  rest: number;
};

type FlowingBandOptions = {
  duration?: number;
  stretch?: number;
  magnet?: number;
  speed?: number;
  followCursor?: number;
};

/**
 * Hover band for the staggered menu: a single rectangle whose two edges are
 * driven by springs, so it flows from row to row, stretches while travelling
 * and leans towards the pointer. Each row paints its own slice of that
 * rectangle and scrolls a repeated label inside it.
 */
export function useFlowingBand({
  duration = 0.5,
  stretch = 0.6,
  magnet = 0.16,
  speed = 60,
  followCursor = 0.4,
}: FlowingBandOptions = {}) {
  const listRef = useRef<HTMLUListElement | null>(null);
  const rowRefs = useRef<Array<HTMLLIElement | null>>([]);
  const bandRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const trackRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const [copies, setCopies] = useState<number[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);

  const settings = useRef({ duration, stretch, magnet, speed, followCursor });
  settings.current = { duration, stretch, magnet, speed, followCursor };

  const engine = useRef({
    band: {
      top: 0,
      bottom: 0,
      vTop: 0,
      vBottom: 0,
      toTop: 0,
      toBottom: 0,
      lead: 1 as 1 | -1,
      shown: false,
      index: -1,
      rest: 0,
    } as BandState,
    metrics: [] as Array<RowMetric | null>,
    marquees: [] as MarqueeState[],
    cursor: { x: 0, y: null as number | null, t: 0, vx: 0 },
    raf: 0,
    last: 0,
  });

  function marqueeAt(index: number) {
    const marquees = engine.current.marquees;
    if (!marquees[index]) {
      marquees[index] = { x: 0, part: 0, spin: 0, covered: false };
    }
    return marquees[index];
  }

  function paint() {
    const state = engine.current;
    const band = state.band;
    rowRefs.current.forEach((row, index) => {
      const metric = state.metrics[index];
      const bandEl = bandRefs.current[index];
      if (!row || !metric || !bandEl) return;
      const marquee = marqueeAt(index);
      const from = Math.max(band.top, metric.top);
      const to = Math.min(band.bottom, metric.top + metric.height);
      if (!band.shown || to - from < 0.25) {
        bandEl.style.visibility = 'hidden';
        marquee.covered = false;
      } else {
        const topInset = Math.max(0, band.top - metric.top);
        const bottomInset = Math.max(0, metric.top + metric.height - band.bottom);
        bandEl.style.visibility = 'visible';
        bandEl.style.clipPath = `inset(${topInset.toFixed(2)}px 0 ${bottomInset.toFixed(2)}px 0)`;
        marquee.covered = (to - from) / metric.height > 0.04;
      }
      const track = trackRefs.current[index];
      if (track) {
        track.style.transform = `translate3d(${marquee.x.toFixed(2)}px, 0, 0)`;
      }
    });
  }

  function frame(now: number) {
    const state = engine.current;
    const opts = settings.current;
    state.raf = 0;
    const elapsed = clamp((now - state.last) / 1000, 0, 1 / 20);
    state.last = now;
    const reduced = prefersReducedMotion();
    const band = state.band;
    let busy = false;

    state.cursor.vx *= Math.exp(-elapsed / 0.3);

    if (band.shown) {
      const metric = band.index >= 0 ? state.metrics[band.index] : null;
      if (metric) {
        const lean =
          state.cursor.y === null
            ? 0
            : clamp(
                (state.cursor.y - (metric.top + metric.height / 2)) * opts.magnet,
                -metric.height * 0.18,
                metric.height * 0.18,
              );
        band.toTop = metric.top + lean;
        band.toBottom = metric.top + metric.height + lean;
      } else if (band.index < 0) {
        band.toTop = band.rest;
        band.toBottom = band.rest;
      }

      const gap = (band.toTop + band.toBottom) / 2 - (band.top + band.bottom) / 2;
      if (Math.abs(gap) > 2) band.lead = gap > 0 ? 1 : -1;

      if (reduced) {
        band.top = band.toTop;
        band.bottom = band.toBottom;
        band.vTop = 0;
        band.vBottom = 0;
      } else {
        const omega = (Math.PI * 2) / Math.max(0.1, opts.duration);
        const fast = omega * (1 + 1.1 * opts.stretch);
        const slow = omega * (1 - 0.4 * opts.stretch);
        const zeta = 1 - 0.3 * opts.stretch;
        const wTop = band.lead > 0 ? slow : fast;
        const wBottom = band.lead > 0 ? fast : slow;
        const steps = Math.max(1, Math.ceil(elapsed / (1 / 240)));
        const dt = elapsed / steps;
        for (let step = 0; step < steps; step++) {
          band.vTop +=
            (-wTop * wTop * (band.top - band.toTop) - 2 * zeta * wTop * band.vTop) * dt;
          band.vBottom +=
            (-wBottom * wBottom * (band.bottom - band.toBottom) -
              2 * zeta * wBottom * band.vBottom) *
            dt;
          band.top += band.vTop * dt;
          band.bottom += band.vBottom * dt;
          if (band.bottom < band.top) {
            const middle = (band.top + band.bottom) / 2;
            const velocity = (band.vTop + band.vBottom) / 2;
            band.top = middle;
            band.bottom = middle;
            band.vTop = velocity;
            band.vBottom = velocity;
          }
        }
      }

      const resting =
        Math.abs(band.top - band.toTop) < 0.1 &&
        Math.abs(band.bottom - band.toBottom) < 0.1 &&
        Math.abs(band.vTop) < 2 &&
        Math.abs(band.vBottom) < 2;
      if (resting) {
        band.top = band.toTop;
        band.bottom = band.toBottom;
        band.vTop = 0;
        band.vBottom = 0;
        if (band.index < 0 && band.bottom - band.top < 0.5) band.shown = false;
      } else {
        busy = true;
      }

      const push = clamp(
        state.cursor.vx * opts.followCursor * 0.55,
        -1600,
        1600,
      );
      state.marquees.forEach((marquee) => {
        if (!marquee) return;
        const goal = marquee.covered ? 1 : 0;
        marquee.spin += (goal - marquee.spin) * (1 - Math.exp(-elapsed / 0.35));
        if (Math.abs(goal - marquee.spin) < 0.002) marquee.spin = goal;
        if (!marquee.covered && marquee.spin === 0) return;
        busy = true;
        if (marquee.part <= 0 || reduced) return;
        marquee.x += (-opts.speed + push) * marquee.spin * elapsed;
        marquee.x =
          (((marquee.x % marquee.part) + marquee.part) % marquee.part) - marquee.part;
      });
    }

    paint();
    if (busy) state.raf = requestAnimationFrame(frame);
  }

  function kick() {
    const state = engine.current;
    if (state.raf || typeof window === 'undefined') return;
    state.last = performance.now();
    state.raf = requestAnimationFrame(frame);
  }

  function goTo(index: number, from: 'top' | 'bottom') {
    const state = engine.current;
    const metric = state.metrics[index];
    if (!metric) return;
    const band = state.band;
    const top = metric.top;
    const bottom = metric.top + metric.height;
    if (!band.shown) {
      const start = from === 'bottom' ? bottom : top;
      band.top = start;
      band.bottom = start;
      band.vTop = 0;
      band.vBottom = 0;
      band.shown = true;
    }
    const shift = (top + bottom) / 2 - (band.top + band.bottom) / 2;
    if (Math.abs(shift) > 0.5) band.lead = shift > 0 ? 1 : -1;
    else band.lead = from === 'bottom' ? -1 : 1;
    band.toTop = top;
    band.toBottom = bottom;
    band.index = index;
    setActiveIndex(index);
    kick();
  }

  function release(toward: 'top' | 'bottom') {
    const state = engine.current;
    const band = state.band;
    if (!band.shown) return;
    const point = toward === 'top' ? band.toTop : band.toBottom;
    band.lead = toward === 'top' ? -1 : 1;
    band.rest = point;
    band.toTop = point;
    band.toBottom = point;
    band.index = -1;
    setActiveIndex(-1);
    state.cursor.y = null;
    kick();
  }

  function rowAt(clientY: number) {
    const list = listRef.current;
    if (!list) return -1;
    const y = clientY - list.getBoundingClientRect().top;
    return engine.current.metrics.findIndex(
      (metric) => metric !== null && y >= metric.top && y < metric.top + metric.height,
    );
  }

  function halfOf(clientY: number, index: number): 'top' | 'bottom' {
    const list = listRef.current;
    const metric = engine.current.metrics[index];
    if (!list || !metric) return 'top';
    const y = clientY - list.getBoundingClientRect().top - metric.top;
    return y < metric.height / 2 ? 'top' : 'bottom';
  }

  function measure() {
    const list = listRef.current;
    if (!list) return;
    const state = engine.current;
    state.metrics = rowRefs.current.map((row) =>
      row ? { top: row.offsetTop, height: row.offsetHeight } : null,
    );
    const width = list.clientWidth;
    const next = rowRefs.current.map((_, index) => {
      const part = trackRefs.current[index]?.firstElementChild;
      const partWidth = part?.getBoundingClientRect().width ?? 0;
      const marquee = marqueeAt(index);
      if (partWidth > 0) {
        marquee.part = partWidth;
        marquee.x =
          (((marquee.x % partWidth) + partWidth) % partWidth) - partWidth;
      }
      return partWidth > 0 ? Math.max(2, Math.ceil(width / partWidth) + 1) : 3;
    });
    setCopies((current) =>
      current.length === next.length &&
      current.every((value, index) => value === next[index])
        ? current
        : next,
    );
    const band = state.band;
    if (band.shown && band.index >= 0) {
      const metric = state.metrics[band.index];
      if (metric) {
        band.toTop = metric.top;
        band.toBottom = metric.top + metric.height;
      }
    }
    paint();
    kick();
  }

  const reset = useCallback(() => {
    const state = engine.current;
    cancelAnimationFrame(state.raf);
    state.raf = 0;
    state.band.shown = false;
    state.band.index = -1;
    state.cursor.y = null;
    setActiveIndex(-1);
    state.marquees.forEach((marquee) => {
      if (!marquee) return;
      marquee.spin = 0;
      marquee.covered = false;
    });
    paint();
  }, []);

  const handlePointerMove = (event: ReactPointerEvent<HTMLUListElement>) => {
    if (event.pointerType === 'touch') return;
    const list = listRef.current;
    if (!list) return;
    const cursor = engine.current.cursor;
    const now = performance.now();
    const gap = (now - cursor.t) / 1000;
    if (gap > 0 && gap < 0.1) {
      const instant = (event.clientX - cursor.x) / gap;
      cursor.vx += (instant - cursor.vx) * (1 - Math.exp(-gap / 0.08));
    }
    cursor.x = event.clientX;
    cursor.t = now;
    cursor.y = event.clientY - list.getBoundingClientRect().top;
    const index = rowAt(event.clientY);
    if (index >= 0 && index !== engine.current.band.index) {
      goTo(index, halfOf(event.clientY, index));
    } else {
      kick();
    }
  };

  const handlePointerLeave = (event: ReactPointerEvent<HTMLUListElement>) => {
    if (event.pointerType === 'touch') return;
    const list = listRef.current;
    const band = engine.current.band;
    if (!list || band.index < 0) return;
    const rect = list.getBoundingClientRect();
    if (event.clientY <= rect.top) release('top');
    else if (event.clientY >= rect.bottom) release('bottom');
    else release(halfOf(event.clientY, band.index));
  };

  const handleFocus = (event: ReactFocusEvent<HTMLUListElement>) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>(
      '[data-sm-index]',
    );
    if (!button || !button.matches(':focus-visible')) return;
    const index = Number(button.dataset.smIndex);
    if (!Number.isNaN(index)) goTo(index, 'top');
  };

  const handleBlur = (event: ReactFocusEvent<HTMLUListElement>) => {
    const next = event.relatedTarget as Node | null;
    if (next && listRef.current?.contains(next)) return;
    release('bottom');
  };

  const registerRow = (index: number) => (node: HTMLLIElement | null) => {
    rowRefs.current[index] = node;
  };

  const registerBand = (index: number) => (node: HTMLSpanElement | null) => {
    bandRefs.current[index] = node;
  };

  const registerTrack = (index: number) => (node: HTMLSpanElement | null) => {
    trackRefs.current[index] = node;
  };

  useLayoutEffect(() => {
    measure();
  });

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => measure());
    observer.observe(list);
    rowRefs.current.forEach((row, index) => {
      if (row) observer.observe(row);
      const part = trackRefs.current[index]?.firstElementChild;
      if (part) observer.observe(part);
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => cancelAnimationFrame(engine.current.raf), []);

  return {
    listRef,
    copies,
    activeIndex,
    registerRow,
    registerBand,
    registerTrack,
    reset,
    handlePointerMove,
    handlePointerLeave,
    handleFocus,
    handleBlur,
  };
}
