import { RefObject, useEffect } from 'react';

// 卡片内的“液面跟随”：指针在卡片上移动时，液体被吸向指针并随其拖拽，
// 边缘的液体因此鼓起、拉长，为离开卡片时被带走做铺垫。
export function useLiquidPull(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let raf = 0;
    let running = false;
    let last = 0;
    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;
    let targetOn = 0;
    let currentOn = 0;
    let primed = false;

    const render = () => {
      el.style.setProperty('--liquid-pull-x', `${currentX.toFixed(1)}px`);
      el.style.setProperty('--liquid-pull-y', `${currentY.toFixed(1)}px`);
      el.style.setProperty('--liquid-pull-on', currentOn.toFixed(3));
    };

    const frame = (now: number) => {
      raf = 0;
      if (!last) last = now;
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      last = now;
      // 液体的黏滞感：位置滞后约一帧多一点点，尺寸回弹更慢
      const follow = 1 - Math.pow(1 - 0.34, dt * 60);
      const swell = 1 - Math.pow(1 - 0.22, dt * 60);
      currentX += (targetX - currentX) * follow;
      currentY += (targetY - currentY) * follow;
      currentOn += (targetOn - currentOn) * swell;
      render();

      const busy =
        Math.abs(targetX - currentX) + Math.abs(targetY - currentY) > 0.4 ||
        Math.abs(targetOn - currentOn) > 0.004;
      if (busy) {
        raf = requestAnimationFrame(frame);
      } else {
        running = false;
        last = 0;
      }
    };

    const start = () => {
      if (running) return;
      running = true;
      last = 0;
      raf = requestAnimationFrame(frame);
    };

    const handleEnter = (event: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      targetX = event.clientX - rect.left;
      targetY = event.clientY - rect.top;
      if (!primed) {
        primed = true;
        currentX = targetX;
        currentY = targetY;
      }
      targetOn = 1;
      // 液面从指针进入的位置漫开，而不是固定从左上角
      el.style.setProperty(
        '--liquid-origin',
        `${Math.round(targetX)}px ${Math.round(targetY)}px`,
      );
      start();
    };

    const handleMove = (event: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      targetX = event.clientX - rect.left;
      targetY = event.clientY - rect.top;
      targetOn = 1;
      start();
    };

    const handleLeave = () => {
      targetOn = 0;
      primed = false;
      start();
    };

    el.addEventListener('pointerenter', handleEnter);
    el.addEventListener('pointermove', handleMove);
    el.addEventListener('pointerleave', handleLeave);
    el.addEventListener('pointercancel', handleLeave);

    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('pointerenter', handleEnter);
      el.removeEventListener('pointermove', handleMove);
      el.removeEventListener('pointerleave', handleLeave);
      el.removeEventListener('pointercancel', handleLeave);
    };
  }, [ref]);
}
