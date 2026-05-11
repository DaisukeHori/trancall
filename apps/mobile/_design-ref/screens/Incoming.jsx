// Incoming — SCR-004 — full-screen ringing
function ScreenIncoming({ theme, peer = "山田 智子", from = "JA", to = "EN", onAccept, onDecline }) {
  const dark = TC.dark;
  return (
    <div style={{
      flex: 1, background: "linear-gradient(180deg, #1C1C1E 0%, #0a0a0c 100%)",
      color: dark.textPrimary, fontFamily: TC_FONT, display: "flex", flexDirection: "column",
      padding: "70px 24px 36px", textAlign: "center", overflow: "hidden",
    }}>
      <div style={{ fontSize: 13, color: dark.textSecondary, letterSpacing: ".02em" }}>着信 · Translation ready</div>
      <div style={{ marginTop: 36, display: "flex", justifyContent: "center" }}>
        <div style={{ position: "relative" }}>
          <div style={{
            position: "absolute", inset: -18, borderRadius: 9999,
            background: "rgba(100,181,246,0.12)", animation: "tcRing 1.6s ease-out infinite",
          }}/>
          <div style={{
            position: "absolute", inset: -36, borderRadius: 9999,
            background: "rgba(100,181,246,0.06)", animation: "tcRing 1.6s ease-out 0.4s infinite",
          }}/>
          <TcAvatar size="xl" initials={peer.slice(0, 2)} theme={dark}/>
        </div>
      </div>
      <div style={{ marginTop: 28, fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em" }}>{peer}</div>
      <div style={{ marginTop: 6, display: "flex", justifyContent: "center", gap: 8 }}>
        <TcBadge variant="default" theme={dark}>{from} → {to}</TcBadge>
        <TcBadge variant="success" theme={dark}>翻訳ON</TcBadge>
      </div>

      <div style={{ flex: 1 }}/>
      <div style={{ display: "flex", justifyContent: "space-around", alignItems: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <button onClick={onDecline} aria-label="拒否" style={{
            width: 56, height: 56, borderRadius: 9999, background: "#FF3B30",
            border: "none", color: "#fff", cursor: "pointer",
            boxShadow: "0 6px 16px rgba(255,59,48,0.4)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}><span className="ms fill" style={{ fontSize: 26 }}>call_end</span></button>
          <div style={{ fontSize: 13, color: dark.textSecondary }}>拒否</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <button onClick={onAccept} aria-label="応答" style={{
            width: 56, height: 56, borderRadius: 9999, background: "#34C759",
            border: "none", color: "#fff", cursor: "pointer",
            boxShadow: "0 6px 16px rgba(52,199,89,0.4)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}><span className="ms fill" style={{ fontSize: 26 }}>call</span></button>
          <div style={{ fontSize: 13, color: dark.textSecondary }}>応答</div>
        </div>
      </div>
      <style>{`@keyframes tcRing{0%{transform:scale(0.95);opacity:.7}100%{transform:scale(1.4);opacity:0}}`}</style>
    </div>
  );
}
Object.assign(window, { ScreenIncoming });
