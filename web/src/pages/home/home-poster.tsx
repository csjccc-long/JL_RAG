import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PageContainer } from '@/layouts/components/page-container';

import { HomeHero } from './home-hero';
import { HomeQuickAccess } from './home-quick-access';
import { MarkPetals } from './mark-petals';
import './home-poster.css';

type MarkView = { pitch: number; yaw: number; distance: number };
type ShardTune = {
  angle: number;
  radius: number;
  rotation: number;
  scale: number;
  z: number;
};

const DEFAULT_VIEW: MarkView = { pitch: -55, yaw: 29, distance: 0.65 };
const DEFAULT_SHARD: ShardTune = { angle: 0, radius: 0.39, rotation: 79, scale: 1.49, z: 0 };
const VIEW_KEY = 'jl-home-mark-view-v2';
const SHARD_KEY = 'jl-home-mark-shards-v2';

const makeDefaultShards = () =>
  Array.from({ length: 6 }, () => ({ ...DEFAULT_SHARD }));

const finite = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const VIEW_COPY = {
  zh: {
    toggle: '视角',
    shard: '碎片',
    pitch: '俯仰',
    yaw: '左右',
    distance: '距离',
    angle: '角度',
    radius: '半径',
    facing: '朝向',
    scale: '大小',
    depth: '前后',
    reset: '重置',
    resetShard: '重置本片',
    resetAll: '全部',
    copy: '复制参数',
    copied: '已复制',
  },
  en: {
    toggle: 'View',
    shard: 'Piece',
    pitch: 'Pitch',
    yaw: 'Yaw',
    distance: 'Distance',
    angle: 'Angle',
    radius: 'Radius',
    facing: 'Facing',
    scale: 'Scale',
    depth: 'Depth',
    reset: 'Reset',
    resetShard: 'Reset piece',
    resetAll: 'All',
    copy: 'Copy values',
    copied: 'Copied',
  },
};

export function HomePoster() {
  const { i18n } = useTranslation();
  const language = i18n.language?.startsWith('en') ? 'en' : 'zh';

  const viewCopy = VIEW_COPY[language];
  // The tuning panel is an authoring tool: it stays out of the shipped page and
  // only appears in dev builds or when ?markdebug is set.
  const showTuning =
    import.meta.env.DEV ||
    (typeof window !== 'undefined' &&
      new URLSearchParams(window.location.search).has('markdebug'));
  const [view, setView] = useState<MarkView>(DEFAULT_VIEW);
  const [viewOpen, setViewOpen] = useState(false);
  const [shards, setShards] = useState<ShardTune[]>(makeDefaultShards);
  const [shardOpen, setShardOpen] = useState(false);
  const [shardIndex, setShardIndex] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(VIEW_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<MarkView>;
      setView({
        pitch: typeof saved.pitch === 'number' && Number.isFinite(saved.pitch) ? saved.pitch : 0,
        yaw: typeof saved.yaw === 'number' && Number.isFinite(saved.yaw) ? saved.yaw : 0,
        distance:
          typeof saved.distance === 'number' && Number.isFinite(saved.distance)
            ? saved.distance
            : 1,
      });
    } catch {
      // ignore storage failures
    }
  }, []);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SHARD_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<ShardTune>[];
      if (!Array.isArray(saved)) return;
      setShards(
        Array.from({ length: 6 }, (_, index) => {
          const item = saved[index];
          return {
            angle: finite(item?.angle, 0),
            radius: finite(item?.radius, 0),
            rotation: finite(item?.rotation, 0),
            scale: finite(item?.scale, 1),
            z: finite(item?.z, 0),
          };
        }),
      );
    } catch {
      // ignore storage failures
    }
  }, []);

  useEffect(() => {
    const payload = { ...view };
    Object.assign(window, { __markView: payload });
    window.dispatchEvent(new CustomEvent('mark-petals:view', { detail: payload }));
    try {
      window.localStorage.setItem(VIEW_KEY, JSON.stringify(payload));
    } catch {
      // ignore storage failures
    }
  }, [view]);

  useEffect(() => {
    Object.assign(window, { __markShards: shards });
    window.dispatchEvent(new CustomEvent('mark-petals:shards', { detail: shards }));
    try {
      window.localStorage.setItem(SHARD_KEY, JSON.stringify(shards));
    } catch {
      // ignore storage failures
    }
  }, [shards]);

  const setViewValue = (key: keyof MarkView, value: number) => {
    setView((prev) => ({ ...prev, [key]: value }));
  };

  const currentShard = shards[shardIndex];
  const setShardValue = (key: keyof ShardTune, value: number) => {
    setShards((prev) =>
      prev.map((item, index) =>
        index === shardIndex ? { ...item, [key]: value } : item,
      ),
    );
  };

  const resetShard = () => {
    setShards((prev) =>
      prev.map((item, index) =>
        index === shardIndex ? { ...DEFAULT_SHARD } : item,
      ),
    );
  };

  const copyShards = async () => {
    const payload = JSON.stringify(shards);
    const markCopied = () => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    };
    try {
      await navigator.clipboard.writeText(payload);
      markCopied();
      return;
    } catch {
      // fall back to a selection copy for browsers without clipboard permission
    }
    try {
      const area = document.createElement('textarea');
      area.value = payload;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      const copied = document.execCommand('copy');
      area.remove();
      if (copied) {
        markCopied();
        return;
      }
    } catch {
      // fall through to the prompt
    }
    window.prompt('复制这些参数', payload);
  };

  return (
    <PageContainer className="home-poster-page !px-0 !py-0">
      <section className="home-poster" data-lang={language}>
        <div className="home-poster__stage" aria-hidden="true">
          <MarkPetals />
        </div>

        <HomeHero />

        <div className="home-poster__quick">
          <HomeQuickAccess />
        </div>

        {showTuning && (
        <div className="home-poster__view">
          <div className="home-poster__view-row">
            <button
              type="button"
              className="home-poster__view-toggle"
              aria-expanded={shardOpen}
              onClick={() => {
                setShardOpen((open) => !open);
                setViewOpen(false);
              }}
            >
              {viewCopy.shard}
            </button>
            <button
              type="button"
              className="home-poster__view-toggle"
              aria-expanded={viewOpen}
              onClick={() => {
                setViewOpen((open) => !open);
                setShardOpen(false);
              }}
            >
              {viewCopy.toggle}
            </button>
          </div>
          {shardOpen && (
            <div className="home-poster__view-panel home-poster__shard-panel">
              <div className="home-poster__shard-pick">
                <span>{viewCopy.shard}</span>
                <select
                  aria-label={viewCopy.shard}
                  value={shardIndex}
                  onChange={(event) => setShardIndex(Number(event.target.value))}
                >
                  {Array.from({ length: 6 }, (_, index) => (
                    <option key={index} value={index}>
                      #{index + 1}
                    </option>
                  ))}
                </select>
              </div>
              <label>
                <span>{viewCopy.angle}</span>
                <input
                  type="range"
                  min={-60}
                  max={60}
                  step={1}
                  value={currentShard.angle}
                  onChange={(event) =>
                    setShardValue('angle', Number(event.target.value))
                  }
                />
                <em>{Math.round(currentShard.angle)}°</em>
              </label>
              <label>
                <span>{viewCopy.radius}</span>
                <input
                  type="range"
                  min={-0.6}
                  max={0.6}
                  step={0.01}
                  value={currentShard.radius}
                  onChange={(event) =>
                    setShardValue('radius', Number(event.target.value))
                  }
                />
                <em>{Math.round(currentShard.radius * 100)}%</em>
              </label>
              <label>
                <span>{viewCopy.facing}</span>
                <input
                  type="range"
                  min={-180}
                  max={180}
                  step={1}
                  value={currentShard.rotation}
                  onChange={(event) =>
                    setShardValue('rotation', Number(event.target.value))
                  }
                />
                <em>{Math.round(currentShard.rotation)}°</em>
              </label>
              <label>
                <span>{viewCopy.scale}</span>
                <input
                  type="range"
                  min={0.4}
                  max={1.6}
                  step={0.01}
                  value={currentShard.scale}
                  onChange={(event) =>
                    setShardValue('scale', Number(event.target.value))
                  }
                />
                <em>{currentShard.scale.toFixed(2)}</em>
              </label>
              <label>
                <span>{viewCopy.depth}</span>
                <input
                  type="range"
                  min={-0.8}
                  max={0.8}
                  step={0.01}
                  value={currentShard.z}
                  onChange={(event) =>
                    setShardValue('z', Number(event.target.value))
                  }
                />
                <em>{currentShard.z.toFixed(2)}</em>
              </label>
              <div className="home-poster__shard-actions">
                <button
                  type="button"
                  className="home-poster__view-reset"
                  onClick={resetShard}
                >
                  {viewCopy.resetShard}
                </button>
                <button
                  type="button"
                  className="home-poster__view-reset"
                  onClick={() => setShards(makeDefaultShards())}
                >
                  {viewCopy.resetAll}
                </button>
                <button
                  type="button"
                  className="home-poster__view-reset home-poster__shard-copy"
                  onClick={copyShards}
                >
                  {copied ? viewCopy.copied : viewCopy.copy}
                </button>
              </div>
            </div>
          )}
          {viewOpen && (
            <div className="home-poster__view-panel">
              <label>
                <span>{viewCopy.pitch}</span>
                <input
                  type="range"
                  min={-55}
                  max={55}
                  step={1}
                  value={view.pitch}
                  onChange={(event) =>
                    setViewValue('pitch', Number(event.target.value))
                  }
                />
                <em>{Math.round(view.pitch)}°</em>
              </label>
              <label>
                <span>{viewCopy.yaw}</span>
                <input
                  type="range"
                  min={-70}
                  max={70}
                  step={1}
                  value={view.yaw}
                  onChange={(event) =>
                    setViewValue('yaw', Number(event.target.value))
                  }
                />
                <em>{Math.round(view.yaw)}°</em>
              </label>
              <label>
                <span>{viewCopy.distance}</span>
                <input
                  type="range"
                  min={0.65}
                  max={1.8}
                  step={0.01}
                  value={view.distance}
                  onChange={(event) =>
                    setViewValue('distance', Number(event.target.value))
                  }
                />
                <em>{view.distance.toFixed(2)}</em>
              </label>
              <button
                type="button"
                className="home-poster__view-reset"
                onClick={() => setView(DEFAULT_VIEW)}
              >
                {viewCopy.reset}
              </button>
            </div>
          )}
        </div>
        )}

      </section>
    </PageContainer>
  );
}