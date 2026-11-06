import { useEffect, useRef } from 'react';

import { useTheme } from '@/components/theme-provider';

import './mark-petals.css';

type MarkApi = {
  setLight: (v: boolean) => void;
  trigger: () => void;
  destroy: () => void;
};

let loader: Promise<void> | null = null;

function loadMark() {
  if ((window as unknown as { MarkPetals?: unknown }).MarkPetals) {
    return Promise.resolve();
  }
  if (loader) return loader;
  loader = new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = '/mark-petals.js?v=20261106p';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('mark-petals load failed'));
    document.head.appendChild(script);
  });
  return loader;
}

export function MarkPetals() {
  const host = useRef<HTMLDivElement>(null);
  const api = useRef<MarkApi | null>(null);
  const { theme } = useTheme();
  const light = theme === 'light';
  const lightRef = useRef(light);
  lightRef.current = light;

  useEffect(() => {
    let dead = false;
    const el = host.current;
    if (!el) return;
    loadMark()
      .then(() => {
        if (dead || !el) return;
        const factory = (
          window as unknown as {
            MarkPetals?: {
              mount: (
                node: HTMLElement,
                opts: { light: boolean },
              ) => MarkApi | null;
            };
          }
        ).MarkPetals;
        const instance = factory?.mount(el, { light: lightRef.current }) ?? null;
        api.current = instance;
        el.dataset.fallback = instance ? 'false' : 'true';
      })
      .catch(() => {
        if (!dead) el.dataset.fallback = 'true';
      });
    return () => {
      dead = true;
      api.current?.destroy();
      api.current = null;
    };
  }, []);

  useEffect(() => {
    api.current?.setLight(light);
  }, [light]);

  return (
    <div className="mark-petals" ref={host} role="presentation">
      <img className="mark-petals__fallback" src="/mark-3d.png" alt="" />
    </div>
  );
}