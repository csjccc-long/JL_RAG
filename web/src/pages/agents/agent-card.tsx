import { RAGFlowAvatar } from "@/components/ragflow-avatar";
import { MoreButton } from "@/components/more-button";
import { SharedBadge } from "@/components/shared-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AgentCategory } from "@/constants/agent";
import { useNavigatePage } from "@/hooks/logic-hooks/navigate-hooks";
import { AgentListItemType, IFlow } from "@/interfaces/database/agent";
import { cn } from "@/lib/utils";
import { formatDate } from "@/utils/date";
import { Tag } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import "./agent-card.css";
import { AgentDropdown } from "./agent-dropdown";
import { CanvasCategoryToFlowType, FlowType, FlowTypeConfig } from "./constant";
import { useRenameAgent } from "./use-rename-agent";

export type DatasetCardProps = {
  data: IFlow & { type?: AgentListItemType };
} & Pick<ReturnType<typeof useRenameAgent>, "showAgentRenameModal">;

function AgentTypeIcon({
  data,
}: {
  data: IFlow & { type?: AgentListItemType };
}) {
  const flowType =
    data.type === AgentListItemType.CompilationTemplateGroup
      ? FlowType.Compiler
      : CanvasCategoryToFlowType[data.canvas_category ?? ""];

  const config = flowType ? FlowTypeConfig[flowType] : null;

  if (!config) {
    return null;
  }

  const Icon = config.icon;

  return (
    <Button variant={"ghost"} size={"sm"} aria-label={config.labelKey}>
      <Icon style={{ color: config.color }} />
    </Button>
  );
}

function AgentTags({ tags }: { tags?: string }) {
  const list = (tags || "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  if (list.length === 0) return null;

  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) {
      const el = containerRef.current;
      setOpen(el ? el.scrollHeight > el.clientHeight : false);
    } else {
      setOpen(false);
    }
  };

  return (
    <Tooltip open={open} onOpenChange={handleOpenChange}>
      <TooltipTrigger asChild>
        <div ref={containerRef} className="liquid-agent__tags">
          {list.map((tag) => (
            <Badge
              key={tag}
              variant="secondary"
              className="text-xs font-normal mr-1 space-x-1"
            >
              <Tag className="size-3" />
              <span>{tag}</span>
            </Badge>
          ))}
        </div>
      </TooltipTrigger>
      <TooltipContent>
        <div className="flex flex-wrap gap-1 max-w-[280px]">
          {list.map((tag) => (
            <Badge
              key={tag}
              variant="secondary"
              className="text-xs font-normal space-x-1"
            >
              <Tag className="size-3" />
              <span>{tag}</span>
            </Badge>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

const WAVES = [
  "liquid-agent__wave--1",
  "liquid-agent__wave--2",
  "liquid-agent__wave--3",
  "liquid-agent__wave--4",
  "liquid-agent__wave--5",
];

const DRIPS = [
  "liquid-agent__drip--1",
  "liquid-agent__drip--2",
  "liquid-agent__drip--3",
];

const DROPS = [
  "liquid-agent__drop--1",
  "liquid-agent__drop--2",
  "liquid-agent__drop--3",
  "liquid-agent__drop--4",
  "liquid-agent__drop--5",
];

function LiquidFilter({ filterId }: { filterId: string }) {
  return (
    <svg aria-hidden className="absolute h-0 w-0">
      <filter id={filterId} x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="7" result="blur" />
        <feColorMatrix
          in="blur"
          type="matrix"
          values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -10"
        />
      </filter>
    </svg>
  );
}

export function AgentCard({ data, showAgentRenameModal }: DatasetCardProps) {
  const { navigateToAgent } = useNavigatePage();
  const { t } = useTranslation();
  const filterId = useId();
  const title = data.title || "";
  const hasDesc = Boolean(data.description);
  const hasTags = Boolean(data.tags);
  const cardClassName = cn(
    "liquid-agent group",
    !hasDesc && "liquid-agent--no-desc",
    !hasTags && "liquid-agent--no-tags",
    !hasDesc && !hasTags && "liquid-agent--compact",
  );

  const handleClick = () => {
    // navigateToAgent is curried: it returns the handler, so it has to be called
    navigateToAgent(data?.id, data.canvas_category as AgentCategory)();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleClick();
    }
  };

  return (
    <article
      data-testid="agent-card"
      data-agent-name={title}
      tabIndex={0}
      role="button"
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={cardClassName}
    >
      <LiquidFilter filterId={`liquid-goo-${filterId}`} />

      <div
        className="liquid-agent__goo"
        style={{ filter: `url(#liquid-goo-${filterId})` }}
      >
        <i className="liquid-agent__blob liquid-agent__blob--avatar" />
        <i className="liquid-agent__blob liquid-agent__blob--title" />
        <i className="liquid-agent__blob liquid-agent__blob--time" />
        <i className="liquid-agent__blob liquid-agent__blob--desc" />
        <i className="liquid-agent__blob liquid-agent__blob--tags" />
        <i className="liquid-agent__blob liquid-agent__blob--action" />
        {DROPS.map((drop) => (
          <i key={drop} className={`liquid-agent__drop ${drop}`} />
        ))}
        <span className="liquid-agent__fill">
          {WAVES.map((wave) => (
            <i key={wave} className={`liquid-agent__wave ${wave}`} />
          ))}
        </span>
        <i className="liquid-agent__splash" />
        {DRIPS.map((drip) => (
          <i key={drip} className={`liquid-agent__drip ${drip}`} />
        ))}
      </div>

      <div className="liquid-agent__plate" />
      <div className="liquid-agent__rim" />

      <div className="liquid-agent__content">
        <div className="liquid-agent__avatar">
          <RAGFlowAvatar
            className="h-10 w-10"
            avatar={data.avatar}
            name={title}
          />
        </div>

        <h3 className="liquid-agent__title truncate" title={title}>
          <span data-testid="agent-name" className="truncate">
            {title}
          </span>
        </h3>

        <p className="liquid-agent__time">
          {t("flow.lastSavedAt")}: {formatDate(data.update_time)}
        </p>

        <p className="liquid-agent__desc">{data.description}</p>

        <AgentTags tags={data.tags} />

        <div className="liquid-agent__action">
          <AgentTypeIcon data={data} />
        </div>

        <div className="liquid-agent__more">
          <AgentDropdown
            showAgentRenameModal={showAgentRenameModal}
            agent={data}
          >
            <MoreButton />
          </AgentDropdown>
        </div>

        <div className="liquid-agent__badge">
          <SharedBadge>{data.nickname}</SharedBadge>
        </div>
      </div>
    </article>
  );
}
