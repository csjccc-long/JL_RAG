import "./holo-foil.css";

import { cn } from "@/lib/utils";

export function HoloFoil({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn("holo-foil", className)}>
      <div className="holo-foil__print" />
      <div className="holo-foil__burst" />
      <div className="holo-foil__sheen" />
      <div className="holo-foil__sparkle" />
    </div>
  );
}

export function HoloSheen() {
  return <div aria-hidden className="holo-sheen" />;
}
