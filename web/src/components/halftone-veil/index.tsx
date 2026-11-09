import { cn } from "@/lib/utils";
import "./halftone-veil.css";

interface HalftoneVeilProps {
  className?: string;
}

/**
 * The card reads through a coarse pixel screen; a hard-edged hole follows the
 * pointer and wipes it clear. The rim is a sibling of the screen because the
 * screen's own mask would clip a ring drawn inside it.
 */
export function HalftoneVeil({ className }: HalftoneVeilProps) {
  return (
    <>
      <div aria-hidden className={cn("halftone-veil", className)}>
        <div className="halftone-veil__screen" />
      </div>
      <div aria-hidden className="halftone-rim" />
    </>
  );
}
