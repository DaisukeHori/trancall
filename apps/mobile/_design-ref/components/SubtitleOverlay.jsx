// SubtitleOverlay — mirror packages/ui-kit/src/components/SubtitleOverlay.tsx
// Partial deltas render with a dashed underline (確定中).

function TcSubtitleOverlay({ segments, mode = "Both", isDark = true }) {
  const subtitleBg = isDark ? "rgba(0,0,0,0.85)" : "rgba(0,0,0,0.7)";
  const origColor = "#AAAAAA";
  const transColor = "#FFFFFF";
  const scrollRef = React.useRef(null);
  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [segments]);
  return (
    <div style={{
      background: subtitleBg, borderRadius: 8, padding: 12, maxHeight: 180, fontFamily: TC_FONT,
      pointerEvents: "none",
    }}>
      <div ref={scrollRef} style={{ maxHeight: 156, overflow: "hidden" }}>
        {segments.map((seg) => (
          <div key={seg.id} style={{ marginBottom: 6 }}>
            {(mode === "Both" || mode === "OriginalOnly") && (
              <div style={{ fontSize: 13, lineHeight: 1.5, color: origColor, opacity: seg.isFinal ? 1 : 0.7 }}>
                {seg.original}
              </div>
            )}
            {(mode === "Both" || mode === "TranslationOnly") && seg.translated && (
              <div style={{
                fontSize: 15, lineHeight: 1.45, color: transColor, opacity: seg.isFinal ? 1 : 0.8,
                textDecoration: seg.isFinal ? "none" : "underline",
                textDecorationStyle: seg.isFinal ? undefined : "dashed",
                textUnderlineOffset: 3,
              }}>
                {seg.translated}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { TcSubtitleOverlay });
