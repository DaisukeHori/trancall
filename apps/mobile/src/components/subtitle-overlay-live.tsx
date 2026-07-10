/**
 * subtitle-overlay-live — ui-kit SubtitleOverlay の wrapper
 *
 * useSubtitleStore の partial + final を統合して SubtitleOverlay に渡す。
 * partial は最末尾に isFinal=false として表示。
 */
import React from "react";
import { SubtitleOverlay } from "@trancall/ui-kit";
import type { SubtitleSegment } from "@trancall/ui-kit";
import { useSubtitleStore } from "../stores/subtitle-store";

export interface SubtitleOverlayLiveProps {
  isDark?: boolean;
  mode?: "Both" | "OriginalOnly" | "TranslationOnly";
}

export function SubtitleOverlayLive({
  isDark = true,
  mode = "Both",
}: SubtitleOverlayLiveProps) {
  const partial = useSubtitleStore((s) => s.partial);
  const finals = useSubtitleStore((s) => s.finals);

  // Map finals to SubtitleSegment
  const finalSegments: SubtitleSegment[] = finals.map((f) => ({
    id: f.id,
    original: f.original,
    translated: f.translated,
    isFinal: true,
  }));

  // Append partial as in-progress segment
  const segments: SubtitleSegment[] = partial != null
    ? [
        ...finalSegments,
        {
          id: `partial-${partial.segmentId}`,
          original: partial.original ?? "",
          translated: partial.text,
          isFinal: false,
        },
      ]
    : finalSegments;

  return (
    <SubtitleOverlay
      segments={segments}
      mode={mode}
      isDark={isDark}
    />
  );
}
