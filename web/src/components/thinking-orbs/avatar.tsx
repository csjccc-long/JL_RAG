import { cn } from "@/lib/utils";
import { useState } from "react";
import { Orb, type OrbLook } from "./index";

/** Every look reads as "the agent is busy", so a new answer gets one of them at random. */
const LOOKS: OrbLook[] = [
  { state: "working" },
  { state: "working", variant: "gyro" },
  { state: "reasoning" },
  { state: "reasoning", variant: "twins" },
  { state: "searching" },
  { state: "searching", variant: "lighthouse" },
  { state: "background" },
  { state: "background", variant: "spiral" },
  { state: "retrying" },
  { state: "retrying", variant: "surge" },
  { state: "compacting" },
  { state: "compacting", variant: "squeeze" },
  { state: "compacting", variant: "fuse" },
  { state: "waiting" },
];

const pickLook = () => LOOKS[Math.floor(Math.random() * LOOKS.length)];

interface ThinkingAvatarProps {
  size?: number;
  className?: string;
}

/**
 * The assistant's face while it is still working on an answer: one of the thinking-orb looks,
 * drawn in the text colour so it can be tinted like any other icon.
 */
export function ThinkingAvatar({ size = 40, className }: ThinkingAvatarProps) {
  // One look per answer: a re-render must not restart it, and the next answer gets a new one.
  const [look] = useState<OrbLook>(pickLook);

  return (
    <span
      className={cn("flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
      data-thinking-orb={look.state}
    >
      <Orb {...look} size={size} dotSize={1.7} label="Thinking" />
    </span>
  );
}
