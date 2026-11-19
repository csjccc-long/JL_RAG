'use client';

import { Check, FolderUp, Upload, Volume2, VolumeX, X } from 'lucide-react';
import * as React from 'react';
import { useTranslation } from 'react-i18next';

import { cn, formatBytes } from '@/lib/utils';
import './tray.css';
import { isSoundMuted, playSound, setSoundMuted } from './sound';
import { clampProgress, extLabel, toneFor, totalBytes } from './utils';

export interface TrayRejection {
  /** Changes on every rejection so the same message shakes again. */
  id: number;
  key: string;
  values: Record<string, string | number>;
}

export interface UploadDropAreaProps {
  files: File[];
  progresses?: Record<string, number>;
  /** Files whose upload has already finished, keyed by file name. */
  completed?: Record<string, boolean>;
  rejection?: TrayRejection | null;
  isDragActive?: boolean;
  disabled?: boolean;
  isFolderMode?: boolean;
  maxFileCount: number;
  maxSize?: number;
  title?: React.ReactNode;
  description?: React.ReactNode;
  className?: string;
  rootRef?: React.Ref<HTMLDivElement>;
  rootProps?: React.HTMLAttributes<HTMLDivElement>;
  inputProps?: React.InputHTMLAttributes<HTMLInputElement> & {
    ref?: React.Ref<HTMLInputElement>;
  };
  onActivate?: () => void;
  onRemove: (index: number) => void;
  onClear?: () => void;
}

/** Height the box holds when it is idle, so what follows never shifts. */
const STAGE_HEIGHT = 208;
const SHAKE_MS = 480;
const REFUSE_COOLDOWN_MS = 8000;
/** How long a finished file is held in the box so its tick is seen landing. */
const TICK_HOLD_MS = 900;

/**
 * Said when the same file is refused again in a row. The first refusal carries
 * the real reason; after that the box stops being diplomatic, the way a person
 * would.
 */
const SNARK: Array<{ key: string; fallback: string }> = [
  { key: 'fileManager.refuseStill', fallback: '还是同一个文件，大小没变' },
  { key: 'fileManager.refuseHarder', fallback: '再拖一次也不会变小' },
  { key: 'fileManager.refuseCompress', fallback: '要不要先压缩一下？' },
  { key: 'fileManager.refuseFull', fallback: '这个盒子装不下它' },
  { key: 'fileManager.refuseNo', fallback: '不行。' },
];

const prefersStillness = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const usePrevious = <T,>(value: T): T | undefined => {
  const ref = React.useRef<T | undefined>(undefined);
  React.useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref.current;
};

/** The percentage, drawn as odometer strips: each digit rolls to its place.
 *  The roll is a CSS transition on the strip, so the number always shows the
 *  live value: an easing hook on top of it lagged a tick behind the upload and
 *  the box disagreed with the tray card beside it. */
function Roll({ value }: { value: number }) {
  const digits = String(Math.max(0, Math.min(100, Math.round(value))));
  return (
    <span className="upl-roll" aria-hidden="true">
      {digits.split('').map((digit, index) => (
        <span className="upl-roll-col" key={digits.length + '-' + index}>
          <span
            className="upl-roll-strip"
            /* rows are 16px tall, the font is 12px: an em offset left every
               digit straddling two rows, so the box never showed a clean
               number — it showed the seam between 3 and 4 at "53". */
            style={{ transform: 'translateY(-' + Number(digit) * 16 + 'px)' }}
          >
            {'0123456789'.split('').map((number) => (
              <span key={number}>{number}</span>
            ))}
          </span>
        </span>
      ))}
      %
    </span>
  );
}

export function UploadDropArea({
  files,
  progresses,
  completed,
  rejection,
  isDragActive = false,
  disabled = false,
  isFolderMode = false,
  maxFileCount,
  title,
  description,
  className,
  rootRef,
  rootProps,
  inputProps,
  onActivate,
  onRemove,
  onClear,
}: UploadDropAreaProps) {
  const { t } = useTranslation();

  const [shaking, setShaking] = React.useState(false);
  const [gulp, setGulp] = React.useState(false);
  const [intaking, setIntaking] = React.useState(false);
  const [lateRefusal, setLateRefusal] = React.useState<string | null>(null);
  const [box, setBox] = React.useState<{
    width: number;
    height: number;
  } | null>(null);
  const [soundOn, setSoundOn] = React.useState(() => !isSoundMuted());
  const [lingering, setLingering] = React.useState<string | null>(null);

  const zoneRef = React.useRef<HTMLDivElement | null>(null);
  const rowRef = React.useRef<HTMLDivElement | null>(null);
  const tileRefs = React.useRef<Record<string, HTMLLIElement | null>>({});
  const tries = React.useRef(0);
  const cooldown = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const intakeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const gulpTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const doneOnce = React.useRef(false);

  const setZoneRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      zoneRef.current = node;
      if (typeof rootRef === 'function') {
        rootRef(node);
      } else if (rootRef && 'current' in rootRef) {
        (rootRef as React.MutableRefObject<HTMLDivElement | null>).current =
          node;
      }
    },
    [rootRef],
  );

  /* ---- the file in the box -------------------------------------- */

  /* The first file still going. A file that has finished drops out at once,
     so the box moves on to the next one — except the last one, which is held
     for a beat: a tick nobody sees is a tick that never happened. */
  const pendingName = React.useMemo(() => {
    if (!files.length || !progresses) return null;
    const next = files.find(
      (file) =>
        !completed?.[file.name] && typeof progresses[file.name] === 'number',
    );
    return next?.name ?? null;
  }, [files, progresses, completed]);

  const lastFinished = React.useMemo(() => {
    if (!files.length) return null;
    const finished = files.filter((file) => completed?.[file.name]);
    return finished.length ? finished[finished.length - 1].name : null;
  }, [files, completed]);

  React.useEffect(() => {
    if (pendingName || !lastFinished) {
      setLingering(null);
      return;
    }
    setLingering(lastFinished);
    const timer = setTimeout(() => setLingering(null), TICK_HOLD_MS);
    return () => clearTimeout(timer);
  }, [pendingName, lastFinished]);

  const activeName = pendingName ?? lingering;

  const active = React.useMemo(
    () => files.find((file) => file.name === activeName) ?? null,
    [files, activeName],
  );

  /* Picking files is already the end of the idle box: the first one that
     still has to go moves into the box at once. It is held there with an
     empty bar — nothing leaves this machine until 保存 is pressed. */
  const stagedName = React.useMemo(() => {
    if (activeName) return null;
    const next = files.find((file) => !completed?.[file.name]);
    return next?.name ?? null;
  }, [files, completed, activeName]);

  const staged = React.useMemo(
    () => files.find((file) => file.name === stagedName) ?? null,
    [files, stagedName],
  );

  /* what the box holds: the file being sent, or the one waiting for 保存 */
  const shown = active ?? staged;

  const percent = active ? clampProgress(progresses?.[active.name]) : 0;
  const done = percent >= 100;

  /* ---- the box swallows: the card is pulled into it --------------- */

  React.useEffect(() => {
    if (!shown) {
      setBox(null);
      return;
    }
    /* 100% arrives in the same update that clears the pending file, so the
     * active name can leave and come straight back (it is the file being
     * lingered on). By then the card already reads "已上传" — cloning it a
     * second time flew a finished card into a box that was showing the tick. */
    if (active && done) return;
    const tile = tileRefs.current[shown.name];
    const zone = zoneRef.current;
    playSound('suck');

    if (tile && zone && typeof document !== 'undefined' && !prefersStillness()) {
      const from = tile.getBoundingClientRect();
      const to = zone.getBoundingClientRect();
      if (from.width > 0 && to.width > 0) {
        const ghost = tile.cloneNode(true) as HTMLElement;
        ghost.className = 'upl-ghost';
        ghost.removeAttribute('style');
        ghost.style.left = from.left + 'px';
        ghost.style.top = from.top + 'px';
        ghost.style.width = from.width + 'px';
        ghost.style.height = from.height + 'px';
        document.body.appendChild(ghost);

        const dx = to.left + to.width / 2 - (from.left + from.width / 2);
        const dy = to.top + to.height / 2 - (from.top + from.height / 2);
        /* drawn out along the pull, never turned: up or down it goes tall,
           sideways it goes wide, and a pull too short to have a direction
           only shrinks */
        const squeeze =
          Math.hypot(dx, dy) < 24
            ? 'scale(0.16)'
            : Math.abs(dy) >= Math.abs(dx)
              ? 'scale(0.14, 0.34)'
              : 'scale(0.34, 0.14)';

        if (typeof ghost.animate === 'function') {
          const flight = ghost.animate(
            [
              { transform: 'translate(0, 0) scale(1)', opacity: '1' },
              {
                transform:
                  'translate(' + dx + 'px, ' + dy + 'px) ' + squeeze,
                opacity: '0',
              },
            ],
            {
              duration: 380,
              easing: 'cubic-bezier(0.55, 0, 0.85, 0.3)',
              fill: 'forwards',
            },
          );
          flight.onfinish = () => ghost.remove();
        } else {
          ghost.remove();
        }

        gulpTimer.current = setTimeout(() => {
          setGulp(true);
          playSound('gulp');
          window.setTimeout(() => setGulp(false), 460);
        }, 200);
        return () => {
          if (gulpTimer.current) clearTimeout(gulpTimer.current);
          ghost.remove();
        };
      }
    }

    /* no tile to lift (a keyboard-driven upload): the box still gulps */
    gulpTimer.current = setTimeout(() => {
      setGulp(true);
      window.setTimeout(() => setGulp(false), 460);
    }, 120);
    return () => {
      if (gulpTimer.current) clearTimeout(gulpTimer.current);
    };
  }, [shown?.name, done]);

  /* the tick lands with a small noise, once per file */
  React.useEffect(() => {
    if (!active) {
      doneOnce.current = false;
      return;
    }
    if (done && !doneOnce.current) {
      doneOnce.current = true;
      playSound('tick');
    }
  }, [done, active?.name]);

  /* ---- the box hugs the row while it works, then opens out again -- */

  React.useLayoutEffect(() => {
    if (!shown) {
      setBox(null);
      return;
    }
    const row = rowRef.current;
    if (!row) return;
    setBox({ width: row.offsetWidth + 32, height: row.offsetHeight + 28 });
  }, [shown?.name, done]);

  /* ---- files that just landed get a sweep and a click ------------- */

  const previousCount = usePrevious(files.length);
  React.useEffect(() => {
    const before = previousCount ?? files.length;
    if (files.length <= before) return;
    setIntaking(true);
    if (intakeTimer.current) clearTimeout(intakeTimer.current);
    intakeTimer.current = setTimeout(() => setIntaking(false), 760);
  }, [files.length, previousCount]);

  React.useEffect(() => {
    return () => {
      if (intakeTimer.current) clearTimeout(intakeTimer.current);
      if (gulpTimer.current) clearTimeout(gulpTimer.current);
      if (cooldown.current) clearTimeout(cooldown.current);
    };
  }, []);

  /* ---- refusals: the reason first, then the box stops being polite - */

  React.useEffect(() => {
    if (!rejection) {
      setLateRefusal(null);
      return;
    }
    const attempt = tries.current;
    tries.current = attempt + 1;
    if (attempt > 0) {
      const line = SNARK[Math.min(attempt - 1, SNARK.length - 1)];
      setLateRefusal(t(line.key, line.fallback));
    } else {
      setLateRefusal(null);
    }
    setShaking(true);
    playSound('refuse');
    const timer = setTimeout(() => setShaking(false), SHAKE_MS);
    if (cooldown.current) clearTimeout(cooldown.current);
    cooldown.current = setTimeout(() => {
      tries.current = 0;
    }, REFUSE_COOLDOWN_MS);
    return () => clearTimeout(timer);
  }, [rejection?.id]);

  const atLimit = files.length >= maxFileCount;

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    /* while a file is in the box it is not a drop target, it is a workspace */
    if (shown) return;
    if (isFolderMode) {
      event.preventDefault();
      onActivate?.();
      return;
    }
    rootProps?.onClick?.(event);
  };

  const makeRemoveHandler = (index: number) => () => onRemove(index);

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    setSoundMuted(!next);
    if (next) playSound('drop');
  };

  const soundLabel = soundOn
    ? t('fileManager.soundOff', '关闭音效')
    : t('fileManager.soundOn', '开启音效');

  return (
    <div className="upl">
      <div
        className="upl-stage"
        style={{ height: box ? Math.max(box.height, 96) : STAGE_HEIGHT }}
      >
        <div
          {...rootProps}
          ref={setZoneRef}
          className={cn('upl-box', className)}
          style={box ? { width: box.width, height: box.height } : undefined}
          data-drag={isDragActive && !isFolderMode ? 'true' : 'false'}
          data-disabled={disabled ? 'true' : 'false'}
          data-shake={shaking ? 'true' : 'false'}
          data-intaking={intaking ? 'true' : 'false'}
          data-busy={shown ? 'true' : 'false'}
          data-gulp={gulp ? 'true' : 'false'}
          data-compact={
            files.length > 0 && !isDragActive && !shown ? 'true' : 'false'
          }
          aria-disabled={disabled || undefined}
          onClick={handleClick}
        >
          {inputProps ? <input {...inputProps} /> : null}

          {shown ? (
            <div className="upl-now" key={shown.name} ref={rowRef}>
              <span
                className={cn('upl-page', 'upl-tone-' + toneFor(shown.name))}
                aria-hidden="true"
              >
                <span className="upl-ext">{extLabel(shown.name)}</span>
              </span>
              <span className="upl-now-text">
                <span className="upl-now-name" title={shown.name}>
                  {shown.name}
                </span>
                <span className="upl-now-meta">
                  {formatBytes(shown.size)}
                  {' · '}
                  {active ? (
                    done ? (
                      t('fileManager.uploaded', '已上传')
                    ) : (
                      <Roll value={percent} />
                    )
                  ) : (
                    t('fileManager.pendingUpload', '待上传')
                  )}
                  {active && !done && (
                    <span className="upl-sr-only">{percent}%</span>
                  )}
                </span>
                <span className="upl-track" aria-hidden="true">
                  <i
                    style={{
                      width: (active ? (done ? 100 : percent) : 0) + '%',
                    }}
                  />
                </span>
              </span>
              <span className="upl-end">
                {active && done && (
                  <span className="upl-tick">
                    <Check className="size-3.5" strokeWidth={3} />
                  </span>
                )}
              </span>
            </div>
          ) : isDragActive && !isFolderMode ? (
            <>
              <Upload className="upl-icon" aria-hidden="true" />
              <p className="upl-title">
                {t('fileManager.dropNow', '松手即可放入')}
              </p>
              <p className="upl-desc">
                {t(
                  'fileManager.dropNowHint',
                  '文件会进入下方托盘，确认后再一起提交',
                )}
              </p>
            </>
          ) : (
            <>
              {isFolderMode ? (
                <FolderUp className="upl-icon" aria-hidden="true" />
              ) : (
                <Upload className="upl-icon" aria-hidden="true" />
              )}
              <p className="upl-title">
                {title ||
                  (isFolderMode
                    ? t('fileManager.uploadFolderTitle', '上传文件夹')
                    : t('knowledgeDetails.uploadTitle'))}
              </p>
              <p className="upl-desc">
                {description ||
                  (isFolderMode
                    ? t(
                        'knowledgeDetails.uploadDescription',
                        '选择文件夹，里面的文件会全部加入托盘',
                      )
                    : t('knowledgeDetails.uploadDescription'))}
              </p>
              <p className="upl-hint">
                {atLimit
                  ? t('fileManager.countLimit', '已选 {{count}}/{{max}} 个文件', {
                      count: files.length,
                      max: maxFileCount,
                    })
                  : t('fileManager.uploadHint', '拖拽、点击选择，或整目录导入')}
              </p>
            </>
          )}

          {!active && rejection ? (
            <p className="upl-refuse" role="alert" key={rejection.id}>
              {lateRefusal ?? t(rejection.key, rejection.values)}
            </p>
          ) : null}
        </div>
      </div>

      {files.length > 0 && (
        <div className="upl-tray">
          <div className="upl-tray-head">
            <span>
              {t('fileManager.selectedFiles', '已选 {{count}} 个文件 · {{size}}', {
                count: files.length,
                size: formatBytes(totalBytes(files)),
              })}
            </span>
            <span className="upl-tray-actions">
              <button
                type="button"
                className="upl-sound"
                onClick={toggleSound}
                aria-pressed={soundOn}
                aria-label={soundLabel}
                title={soundLabel}
              >
                {soundOn ? (
                  <Volume2 className="size-3.5" aria-hidden="true" />
                ) : (
                  <VolumeX className="size-3.5" aria-hidden="true" />
                )}
              </button>
              {onClear && (
                <button type="button" className="upl-clear" onClick={onClear}>
                  {t('fileManager.clearAll', '全部移除')}
                </button>
              )}
            </span>
          </div>
          <ul className="upl-grid">
            {files.map((file, index) => {
              const state = completed?.[file.name]
                ? 'done'
                : file.name === activeName
                  ? 'lifting'
                  : 'idle';
              const filePercent =
                progresses?.[file.name] === undefined
                  ? null
                  : clampProgress(progresses[file.name]);
              return (
                <li
                  className="upl-card"
                  key={file.name + '-' + file.size + '-' + index}
                  data-state={state}
                  ref={(node) => {
                    tileRefs.current[file.name] = node;
                  }}
                  style={{ animationDelay: Math.min(index, 6) * 40 + 'ms' }}
                >
                  <span
                    className={cn('upl-page', 'upl-tone-' + toneFor(file.name))}
                    aria-hidden="true"
                  >
                    <span className="upl-ext">{extLabel(file.name)}</span>
                    {state === 'done' && (
                      <span className="upl-badge">
                        <Check className="size-2.5" strokeWidth={4} />
                      </span>
                    )}
                  </span>
                  <span className="upl-card-body">
                    <span className="upl-card-name" title={file.name}>
                      {file.name}
                    </span>
                    <span className="upl-card-meta">
                      {formatBytes(file.size)}
                      {state === 'done'
                        ? ' · ' + t('fileManager.uploaded', '已上传')
                        : filePercent === null
                          ? ''
                          : ' · ' + filePercent + '%'}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="upl-remove"
                    onClick={makeRemoveHandler(index)}
                    aria-label={t('common.removeFile') + ': ' + file.name}
                  >
                    <X className="size-3.5" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
