/*
 * Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { useEffect, useRef, useState } from 'react';
import { createFlowerScene, type FlowerSceneApi, type FlowerTheme } from './scene';
import './mark-flower.css';

const MarkFlower = () => {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<FlowerSceneApi | null>(null);
  const [theme, setTheme] = useState<FlowerTheme>('dark');
  const [spin, setSpin] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    try {
      sceneRef.current = createFlowerScene(host, { theme: 'dark', spin: true });
    } catch (error) {
      console.error('mark-flower: failed to start WebGL scene', error);
      setFailed(true);
    }
    return () => {
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setTheme(theme);
  }, [theme]);

  useEffect(() => {
    sceneRef.current?.setSpin(spin);
  }, [spin]);

  return (
    <div className="mark-flower" data-theme={theme}>
      <div className="mark-flower__glow" aria-hidden />
      <div className="mark-flower__rings" aria-hidden />
      <div
        ref={hostRef}
        className="mark-flower__stage"
        onDoubleClick={() => sceneRef.current?.reset()}
      >
        {failed && (
          <img
            className="mark-flower__fallback"
            src="/mark-3d.png"
            alt="金流 RAG 花瓣"
          />
        )}
      </div>

      <header className="mark-flower__brand">
        <img className="mark-flower__logo" src="/logo-mark.png" alt="" />
        <div className="mark-flower__brand-text">
          <span className="mark-flower__wordmark">金流 RAG</span>
          <span className="mark-flower__subtitle">花瓣 · 3D</span>
        </div>
      </header>

      <div className="mark-flower__toolbar">
        <button
          type="button"
          className="mark-flower__button"
          data-active={spin || undefined}
          onClick={() => setSpin((value) => !value)}
        >
          {spin ? '自动旋转' : '已暂停'}
        </button>
        <button
          type="button"
          className="mark-flower__button"
          onClick={() => sceneRef.current?.reset()}
        >
          复位视角
        </button>
        <button
          type="button"
          className="mark-flower__button"
          onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        >
          {theme === 'dark' ? '月光' : '日光'}
        </button>
      </div>

      <p className="mark-flower__hint">拖拽旋转 · 滚轮缩放 · 双击复位</p>
    </div>
  );
};

export default MarkFlower;
