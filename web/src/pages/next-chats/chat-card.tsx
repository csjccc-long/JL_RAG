import { AgentAvatar } from "@/components/agent-avatar";
import LiquidChrome from "@/components/liquid-chrome/LiquidChrome";
import { MoreButton } from "@/components/more-button";
import { TruncatedText } from "@/components/truncated-text";
import { useNavigatePage } from "@/hooks/logic-hooks/navigate-hooks";
import { IDialog } from "@/interfaces/database/chat";
import { formatDate } from "@/utils/date";
import { useState } from "react";
import { ChatDropdown } from "./chat-dropdown";
import { useRenameChat } from "./hooks/use-rename-chat";

export type IProps = {
  data: IDialog;
} & Pick<ReturnType<typeof useRenameChat>, "showChatRenameModal">;

// The tail replaces the bubble's corner: the fill covers the corner border (so
// no seam is left behind) and only the outer curve is stroked. Coordinates
// assume a 1.5px border: y=10 is the border centre line, y=3 is the top of the
// erased corner, x=0.75 runs down the side border and x=18.5 rejoins the bottom
// border horizontally, so the stroke melts into it without a step.
const TAIL_WIDTH = 26;
const TAIL_HEIGHT = 17;
const TAIL_FILL =
  "M0 3 L18.5 3 L18.5 10 C15.8 10 11 13.4 7.4 15.4 C6.2 15.5 4.9 15 3.9 14 C1.5 11.9 0.75 7.8 0.75 3 Z";
const TAIL_STROKE =
  "M0.75 3 C0.75 7.8 1.5 11.9 3.9 14 C4.9 15 6.2 15.5 7.4 15.4 C11 13.4 15.8 10 18.5 10";
// A borderless bubble only needs the part of the tail that hangs below its own
// edge, so this variant starts on the y=10 line instead of erasing a corner.
const TAIL_ATTACH =
  "M0.9 10 C1.6 12.2 3.4 13.9 5.2 14.9 C6.4 15.55 7.6 15.5 9.2 14.8 C12.6 13.3 16.2 11 18.5 10 Z";

function BubbleTail({
  className,
  attach = false,
}: {
  className?: string;
  attach?: boolean;
}) {
  return (
    <svg
      aria-hidden
      focusable="false"
      width={TAIL_WIDTH}
      height={TAIL_HEIGHT}
      viewBox={`0 0 ${TAIL_WIDTH} ${TAIL_HEIGHT}`}
      className={className}
    >
      <path d={attach ? TAIL_ATTACH : TAIL_FILL} />
      {attach ? null : (
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          d={TAIL_STROKE}
        />
      )}
    </svg>
  );
}

export function ChatCard({ data, showChatRenameModal }: IProps) {
  const { navigateToChat } = useNavigatePage();
  // The liquid chrome backdrop owns a WebGL context, so it is only mounted
  // while the card is actually unfolded.
  const [backend, setBackend] = useState(false);

  const handlePointerEnter = () => setBackend(true);
  const handlePointerLeave = () => setBackend(false);
  const handleFocus = () => setBackend(true);
  const handleBlur = () => setBackend(false);

  return (
    <article
      data-agent-name={data.name}
      tabIndex={0}
      onClick={navigateToChat(data?.id)}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
      className="group relative flex h-[150px] w-full cursor-pointer items-center rounded-[18px] outline-none"
    >
      {/* one container: only the white bubble at rest, the whole thread on hover */}
      <div className="relative h-[84px] w-full transition-[height] duration-500 [transition-timing-function:cubic-bezier(.3,1.2,.5,1)] group-hover:h-[150px] group-focus-visible:h-[150px]">
        <div className="absolute inset-0 overflow-hidden rounded-[18px] rounded-bl-[6px] border-[1.5px] border-border-default bg-bg-component shadow-[0_10px_24px_-22px_rgba(0,0,0,.55)]">
          <div className="pointer-events-none flex items-center gap-3 px-4 py-3">
            {/* the same live face the conversation wears, same seed = same colour */}
            <AgentAvatar
              seed={data.id}
              size={34}
              className="h-[34px] w-[34px]"
            />
            <div className="min-w-0 flex-1 pr-6">
              <TruncatedText
                as="h3"
                testId="agent-name"
                tooltip={data.name}
                className="truncate text-[15px] font-bold leading-snug text-text-primary"
              >
                {data.name}
              </TruncatedText>
              <div className="mt-1.5 flex items-center gap-1.5 text-[11px] text-text-secondary">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-primary shadow-[0_0_8px_rgb(var(--accent-primary))]" />
                <span className="truncate">{formatDate(data.update_time)}</span>
              </div>
            </div>
          </div>

          {/* the answer, revealed inside the same container */}
          <div
            aria-hidden
            data-chat-reply=""
            className="pointer-events-none absolute bottom-3 right-3 ml-auto h-[56px] w-[86%] origin-bottom-right -rotate-2 translate-y-3 scale-[.82] opacity-0 transition-[opacity,transform] duration-200 [transition-timing-function:cubic-bezier(.34,1.56,.64,1)] group-hover:translate-y-0 group-hover:rotate-0 group-hover:scale-100 group-hover:opacity-100 group-hover:[transition-duration:420ms] group-hover:[transition-delay:90ms] group-focus-visible:translate-y-0 group-focus-visible:rotate-0 group-focus-visible:scale-100 group-focus-visible:opacity-100"
          >
            <div className="relative flex h-full w-full items-center overflow-hidden rounded-[14px] rounded-br-none bg-accent-primary shadow-[0_16px_30px_-18px_rgba(0,190,180,.75)]">
              {/* liquid chrome: painted under the mark so the silhouette stays crisp */}
              {backend ? (
                <div className="absolute inset-0 opacity-45 mix-blend-soft-light">
                  <LiquidChrome
                    color="#9ff5ef"
                    speed={0.16}
                    amplitude={0.34}
                    frequencyX={2.2}
                    frequencyY={3.4}
                    detail={5}
                    thickness={0.8}
                    depth={1.1}
                    roughness={0.32}
                    exposure={1.2}
                    rippleStrength={0}
                    tilt={0.6}
                    interactive={false}
                    intro
                    lightMode={false}
                  />
                </div>
              ) : null}

              {/* brand mark as a cropped silhouette on the right edge */}
              <img
                alt=""
                aria-hidden
                src="/logo-silhouette.png"
                className="pointer-events-none absolute -right-6 top-1/2 h-[100px] w-[100px] -translate-y-1/2 object-contain opacity-60 [mask-image:linear-gradient(to_bottom,#000_38%,transparent_84%)] [-webkit-mask-image:linear-gradient(to_bottom,#000_38%,transparent_84%)]"
              />

              <p className="relative z-10 line-clamp-2 px-3.5 pr-12 text-xs leading-[17px] text-white [text-shadow:0_1px_2px_rgba(0,74,70,.35)]">
                {data.description || data.name}
              </p>
            </div>

            <BubbleTail
              attach
              className="absolute -bottom-[7px] -right-[0.75px] -scale-x-100 fill-accent-primary"
            />
          </div>

          <div className="absolute right-2.5 top-2.5">
            <ChatDropdown chat={data} showChatRenameModal={showChatRenameModal}>
              <MoreButton />
            </ChatDropdown>
          </div>
        </div>

        <BubbleTail className="absolute -bottom-[6.25px] left-0 fill-bg-component text-border-default" />
      </div>
    </article>
  );
}
