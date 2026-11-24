/*
 *  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

/**
 * The two sounds this interface makes: a small glass bell when the constellation
 * joins up, and the soft "sent" of a message when the chat is touched.
 *
 * One AudioContext serves the whole page. It is created on the first sound
 * rather than at import, so nothing is allocated until something actually
 * plays, and it is never closed: a closed context cannot be reused, and the
 * bell and the whoosh have to share one.
 */

/** A bell is a fundamental plus a short stack of inharmonic partials. */
const BELL: [ratio: number, weight: number][] = [
  [1, 1],
  [2.01, 0.3],
  [3.02, 0.13],
  [4.98, 0.05],
];

let audio: AudioContext | null = null;

const context = () => {
  if (audio) {
    if (audio.state === 'suspended') void audio.resume();
    return audio;
  }
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Ctor) return null;
    audio = new Ctor();
    if (audio.state === 'suspended') void audio.resume();
    return audio;
  } catch {
    return null;
  }
};

/**
 * The chat list is a hover away, but a browser will not let a page make noise
 * until the visitor has touched it once. The click that opened this page is
 * that touch, so the context is armed on it: otherwise the first sweep over a
 * card would be silent and later ones would not, which reads as a bug.
 */
const UNLOCK = ['pointerdown', 'keydown', 'touchend'] as const;
let armed = false;

const arm = () => {
  if (armed) return;
  armed = true;
  for (const type of UNLOCK) window.removeEventListener(type, arm);
  const ctx = context();
  if (ctx && ctx.state === 'suspended') void ctx.resume();
};

if (typeof window !== 'undefined') {
  for (const type of UNLOCK) {
    window.addEventListener(type, arm, { passive: true });
  }
}

/** Readers who asked the system for less motion also get less noise. */
const quiet = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Development only: makes a sound testable without ears. */
const note = (name: string, freq?: number) => {
  if (!import.meta.env.DEV) return;
  const store = window as unknown as { __sounds?: string[] };
  store.__sounds = [
    ...(store.__sounds ?? []),
    freq === undefined ? name : `${name}:${Math.round(freq)}`,
  ];
};

/**
 * A bell, not a beep: the partials are what make it crisp, so the note keeps
 * ringing after the fundamental has gone and the whole thing is over in a
 * third of a second instead of lingering.
 */
export const chime = (freq: number, level = 0.05) => {
  if (quiet()) return;
  note('chime', freq);
  const ctx = context();
  if (!ctx) return;
  try {
    const at = ctx.currentTime + 0.004;
    const ring = 0.34;
    BELL.forEach(([ratio, weight]) => {
      const osc = ctx.createOscillator();
      const amp = ctx.createGain();
      osc.type = 'sine';
      // A hair sharp, so the partials beat against each other and the note
      // shimmers rather than sitting there as one flat tone.
      osc.frequency.setValueAtTime(freq * ratio * 1.0015, at);
      osc.frequency.exponentialRampToValueAtTime(freq * ratio, at + ring);
      amp.gain.setValueAtTime(0.0001, at);
      amp.gain.exponentialRampToValueAtTime(level * weight, at + 0.004);
      amp.gain.exponentialRampToValueAtTime(0.0001, at + ring);
      osc.connect(amp);
      amp.connect(ctx.destination);
      osc.start(at);
      osc.stop(at + ring + 0.02);
    });
  } catch {
    // No audio here: the constellation still draws itself.
  }
};
