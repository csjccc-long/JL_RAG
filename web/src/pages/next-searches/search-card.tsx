import { HalftoneVeil } from "@/components/halftone-veil";
import { HoloFoil, HoloSheen } from "@/components/holo-foil";
import { MoreButton } from "@/components/more-button";
import { RAGFlowAvatar } from "@/components/ragflow-avatar";
import { TruncatedText } from "@/components/truncated-text";
import { useNavigatePage } from "@/hooks/logic-hooks/navigate-hooks";
import { formatDate } from "@/utils/date";
import { ArrowUpRight } from "lucide-react";
import { CSSProperties, PointerEvent, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ISearchAppProps } from "./hooks";
import { SearchDropdown } from "./search-dropdown";

interface IProps {
  data: ISearchAppProps;
  showSearchRenameModal: (data: ISearchAppProps) => void;
}

const TILT_MAX = 18;

export function SearchCard({ data, showSearchRenameModal }: IProps) {
  const { navigateToSearch } = useNavigatePage();
  const { t } = useTranslation();

  // The wipe centre and the tilt both follow the pointer, so they are written
  // straight to the card's custom properties instead of React state. Writes are
  // coalesced into one frame: a high-rate pointer would otherwise queue dozens
  // of mask repaints that never reach the screen, which reads as dropped frames.
  // Every card gets its own print plate angle and direction: a shared angle
  // would read as wallpaper, and the whole point is that each card looks
  // printed by hand. Values are drawn once, on mount, and never re-rolled.
  const plate = useRef({
    rot: (Math.random() * 12 - 6).toFixed(1),
    flip: Math.random() < 0.5 ? -1 : 1,
  });

  const frameRef = useRef(0);
  const pointRef = useRef({ x: 0, y: 0, target: null as HTMLElement | null });

  const handlePointerMove = (event: PointerEvent<HTMLElement>) => {
    pointRef.current = {
      x: event.clientX,
      y: event.clientY,
      target: event.currentTarget,
    };
    if (frameRef.current) return;

    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      const { x, y, target: card } = pointRef.current;
      if (!card) return;

      const { left, top, width, height } = card.getBoundingClientRect();
      const localX = x - left;
      const localY = y - top;
      const ratioX = Math.min(1, Math.max(0, localX / width));
      const ratioY = Math.min(1, Math.max(0, localY / height));

      card.style.setProperty("--halftone-x", `${localX}px`);
      card.style.setProperty("--halftone-y", `${localY}px`);
      card.style.setProperty(
        "--holo-rx",
        `${((0.5 - ratioY) * TILT_MAX).toFixed(2)}deg`,
      );
      card.style.setProperty(
        "--holo-ry",
        `${((ratioX - 0.5) * TILT_MAX).toFixed(2)}deg`,
      );
      card.style.setProperty("--holo-scale", "1.025");
      card.style.setProperty(
        "--holo-angle",
        `${(ratioX * 200 - 40).toFixed(1)}deg`,
      );
      card.style.setProperty(
        "--holo-sweep",
        `${(88 + ratioX * 150).toFixed(0)}deg`,
      );
      card.style.setProperty("--holo-awake", "1");
    });
  };

  const handlePointerLeave = (event: PointerEvent<HTMLElement>) => {
    const card = event.currentTarget;
    if (frameRef.current) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    }
    pointRef.current.target = null;
    card.style.setProperty("--holo-rx", "0deg");
    card.style.setProperty("--holo-ry", "0deg");
    card.style.setProperty("--holo-scale", "1");
    card.style.setProperty("--holo-awake", "0");
  };

  useEffect(() => () => cancelAnimationFrame(frameRef.current), []);

  return (
    <article
      data-agent-name={data.name}
      data-search-name={data.name}
      tabIndex={0}
      onClick={navigateToSearch(data?.id)}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      style={
        {
          "--print-rot": `${plate.current.rot}deg`,
          "--print-flip": plate.current.flip,
        } as CSSProperties
      }
      className="halftone-card holo-card group relative flex aspect-[1.48/1] w-full cursor-pointer flex-col overflow-hidden rounded-[18px] border-[1.5px] border-border-default bg-bg-component p-5 text-left outline-none transition-[border-color,box-shadow] duration-300 hover:border-text-secondary/45 hover:shadow-[0_18px_36px_-28px_rgba(0,0,0,.8)] focus-visible:border-accent-primary"
    >
      <div className="relative z-20 flex items-start gap-3">
        <RAGFlowAvatar
          name={data.name}
          avatar={data.avatar}
          className="h-11 w-11 shrink-0"
        />
        <div className="min-w-0 flex-1 pr-7">
          <TruncatedText
            as="h3"
            testId="agent-name"
            tooltip={data.name}
            className="truncate text-[17px] font-bold leading-snug text-text-primary"
          >
            {data.name}
          </TruncatedText>
          <p className="mt-2 line-clamp-3 text-[13px] leading-[19px] text-text-secondary">
            {data.description || data.name}
          </p>
        </div>
      </div>

      <div className="holo-card__content mt-auto flex items-center justify-between gap-2 border-t-[1.5px] border-border-default pt-3 text-[11px] text-text-secondary">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-primary shadow-[0_0_8px_rgb(var(--accent-primary))]" />
          <span className="truncate">{formatDate(data.create_time)}</span>
        </span>
        <span className="relative z-20 flex shrink-0 items-center gap-0.5 text-text-primary opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100">
          {t("search.startSearch")}
          <ArrowUpRight className="size-3.5" />
        </span>
      </div>

      <HoloFoil />
      <HalftoneVeil />
      <HoloSheen />

      <div className="absolute right-2.5 top-2.5 z-20">
        <SearchDropdown
          dataset={data}
          showSearchRenameModal={showSearchRenameModal}
        >
          <MoreButton />
        </SearchDropdown>
      </div>
    </article>
  );
}