/*
 *  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp } from "lucide-react";
import { ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

interface ExpandableContentProps {
  children: ReactNode;
  maxHeight?: number;
  className?: string;
}

export default function ExpandableContent({
  children,
  maxHeight = 208, // 52 * 4 = 208px (max-h-52)
  className = "",
}: ExpandableContentProps) {
  const { t } = useTranslation();
  const contentRef = useRef<HTMLDivElement>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  // Content height is measured in the observer below instead of being read
  // from scrollHeight while rendering: streaming markdown mutates the subtree on
  // every token, so a render-time measurement forced a synchronous layout per
  // token. This state only changes when the height really moves.
  const [contentHeight, setContentHeight] = useState(maxHeight);
  const heightRef = useRef(maxHeight);
  // The max-height transition is only armed around an actual toggle, otherwise
  // every streamed token restarted a 300ms animation.
  const [animating, setAnimating] = useState(false);
  const animTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const element = contentRef.current;
    if (!element) return;

    let frame = 0;
    const checkOverflow = () => {
      frame = 0;
      const height = element.scrollHeight;
      if (Math.abs(height - heightRef.current) > 1) {
        heightRef.current = height;
        setContentHeight(height);
      }
      setIsOverflowing(height > maxHeight);
    };
    const scheduleCheck = () => {
      if (!frame) frame = requestAnimationFrame(checkOverflow);
    };

    checkOverflow();

    // ResizeObserver handles element size changes
    const resizeObserver = new ResizeObserver(scheduleCheck);
    resizeObserver.observe(element);

    // MutationObserver handles DOM changes (useful for async markdown content)
    const mutationObserver = new MutationObserver(scheduleCheck);
    mutationObserver.observe(element, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // Listen for images to load (they affect scrollHeight)
    const images = element.querySelectorAll("img");
    const imageLoadPromises = Array.from(images).map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) {
            resolve();
          } else {
            img.addEventListener("load", () => resolve(), { once: true });
            img.addEventListener("error", () => resolve(), { once: true });
          }
        }),
    );

    // Re-check after all images are loaded
    Promise.all(imageLoadPromises).then(checkOverflow);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [maxHeight]);

  useEffect(() => () => window.clearTimeout(animTimer.current), []);

  const toggleExpand = () => {
    setAnimating(true);
    setIsExpanded((prev) => !prev);
    window.clearTimeout(animTimer.current);
    animTimer.current = window.setTimeout(() => setAnimating(false), 340);
  };

  return (
    <div className="relative">
      <div
        ref={contentRef}
        className={cn(
          "overflow-hidden scrollbar-thin",
          animating &&
            "transition-[max-height] duration-300 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)]",
          className,
        )}
        style={{ maxHeight: isExpanded ? contentHeight : maxHeight }}
      >
        {children}
      </div>

      {!isExpanded && isOverflowing && (
        <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-bg-base to-transparent pointer-events-none" />
      )}

      {isOverflowing && !isExpanded && (
        <Button
          size="sm"
          onClick={toggleExpand}
          className="absolute bottom-2 left-1/2 -translate-x-1/2"
        >
          <ChevronDown size={14} />
          <span>{t("common.viewMore")}</span>
        </Button>
      )}

      {isOverflowing && isExpanded && (
        <div className="flex justify-center pt-2">
          <Button size="sm" onClick={toggleExpand}>
            <ChevronUp size={14} />
            <span>{t("common.viewLess")}</span>
          </Button>
        </div>
      )}
    </div>
  );
}
