// InCall — SCR-003 — Classic call hero (big avatar + name) + translation overlay.
// Layout:
//   Top:      compact translation status pill (JA→EN · Translating · ~210ms)
//   Middle:   big peer avatar, name, duration  ← reads as a phone call
//             small "あなた · 聞く" chip with peer/me indicator
//   Bottom:   subtitle log (original gray / translation white, partial = dashed)
//   Footer:   mute · end · speaker

function ScreenInCall({ theme, peer = "山田 智子", from = "JA", to = "EN", onEnd }) {
  const dark = TC.dark;
  const [seconds, setSeconds] = React.useState(154);
  const [status, setStatus] = React.useState("translating");
  const [mute, setMute] = React.useState(false);
  const [speaker, setSpeaker] = React.useState(true);
  const [activeSide, setActiveSide] = React.useState("peer");

  React.useEffect(() => {
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  React.useEffect(() => {
    const sw = setInterval(() => setActiveSide((s) => (s === "peer" ? "me" : "peer")), 4200);
    return () => clearInterval(sw);
  }, []);
  React.useEffect(() => {
    const blips = [[12000, "reconnecting"], [14000, "translating"]];
    const timers = blips.map(([ms, st]) => setTimeout(() => setStatus(st), ms));
    return () => timers.forEach(clearTimeout);
  }, []);

  const statusMap = {
    translating:  { color: "#34C759", bg: "rgba(52,199,89,0.18)",  label: "Translating",   icon: "translate" },
    reconnecting: { color: "#FF9500", bg: "rgba(255,149,0,0.18)",  label: "Reconnecting…", icon: "sync" },
    stopped:      { color: "#FF3B30", bg: "rgba(255,59,48,0.2)",   label: "Stopped",       icon: "warning" },
  }[status];

  const segments = [
    { id: "a", side: "peer", original: "今日は時間取ってくれてありがとう。",          translated: "Thanks for making time today.",                isFinal: true },
    { id: "b", side: "me",   original: "Of course, glad we could line this up.",     translated: "もちろんです、調整できてよかった。",            isFinal: true },
    { id: "c", side: "peer", original: "翻訳の遅延は今のところ200ミリ秒くらいです", translated: "Translation latency is around 200ms right now", isFinal: false },
  ];

  return (
    <div style={{
      flex: 1,
      background: "radial-gradient(120% 80% at 50% 0%, #1a3050 0%, #0a0a0c 65%)",
      color: dark.textPrimary, fontFamily: TC_FONT,
      display: "flex", flexDirection: "column", position: "relative", overflow: "hidden",
    }}>
      {/* Top: translation status pill */}
      <div style={{ padding: "56px 16px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 12px 6px 10px",
          borderRadius: 9999, background: statusMap.bg, color: statusMap.color,
          fontSize: 13, fontWeight: 600,
        }}>
          <span className="ms fill" style={{ fontSize: 16 }}>{statusMap.icon}</span>
          {statusMap.label}
          <span style={{ width: 1, height: 12, background: "currentColor", opacity: 0.3, margin: "0 2px" }}/>
          <span style={{ fontFamily: TC_MONO, fontSize: 12, opacity: 0.95 }}>{from} → {to}</span>
          <span style={{ fontFamily: TC_MONO, fontSize: 11, opacity: 0.7 }}>~210ms</span>
        </div>
      </div>

      {/* Hero: big avatar + name + duration */}
      <div style={{
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        padding: "24px 24px 16px", gap: 14,
      }}>
        <div style={{ position: "relative" }}>
          <span style={{
            position: "absolute", inset: -12, borderRadius: 9999,
            border: "2px solid rgba(100,181,246,0.5)",
            opacity: activeSide === "peer" ? 1 : 0,
            transition: "opacity .25s",
            animation: activeSide === "peer" ? "tcPulse 1.6s ease-in-out infinite" : "none",
          }}/>
          <TcAvatar size="xl" initials={peer.slice(0, 2)} theme={dark}/>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-0.01em", color: "#fff" }}>{peer}</div>
          <div style={{
            fontFamily: TC_MONO, fontSize: 14, color: "rgba(235,235,245,0.7)",
            fontVariantNumeric: "tabular-nums", marginTop: 4,
          }}>{fmtDur(seconds)}</div>
        </div>

        {/* Speaker indicator — tiny, replaces the "two cards" thing */}
        <SpeakerIndicator activeSide={activeSide}/>
      </div>

      {/* Subtitle log */}
      <div style={{ flex: 1, padding: "8px 16px 8px", overflow: "hidden", minHeight: 0 }}>
        <SubtitleLog segments={segments} dark={dark}/>
      </div>

      {/* Controls */}
      <div style={{
        display: "grid", gridTemplateColumns: "repeat(3, 1fr)", alignItems: "center",
        gap: 12, padding: "12px 24px 36px",
      }}>
        <CallControl active={mute} onClick={() => setMute(!mute)}
          label={mute ? "ミュート中" : "ミュート"} icon={mute ? "mic_off" : "mic"}/>
        <button onClick={onEnd} aria-label="通話を終了" style={{
          background: "#FF3B30", color: "#fff", borderRadius: 9999, width: 64, height: 64,
          justifySelf: "center", border: "none", cursor: "pointer",
          boxShadow: "0 6px 16px rgba(255,59,48,0.4)",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <span className="ms fill" style={{ fontSize: 28 }}>call_end</span>
        </button>
        <CallControl active={speaker} onClick={() => setSpeaker(!speaker)}
          label="スピーカー" icon={speaker ? "volume_up" : "volume_down"}/>
      </div>

      <style>{`@keyframes tcPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(1.06)}}`}</style>
    </div>
  );
}

function SpeakerIndicator({ activeSide }) {
  // Small horizontal pill showing 相手 ↔ あなた with the active side highlighted.
  const peerActive = activeSide === "peer";
  const cell = (active, label, sub, color) => (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
      padding: "6px 14px", borderRadius: 9999,
      background: active ? `rgba(${color},0.18)` : "transparent",
      transition: "background .25s",
    }}>
      <div style={{
        fontSize: 11, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase",
        color: active ? `rgb(${color})` : "rgba(235,235,245,0.55)",
      }}>{label}</div>
      <div style={{ fontSize: 10, fontFamily: TC_MONO, color: active ? `rgb(${color})` : "rgba(235,235,245,0.4)" }}>{sub}</div>
    </div>
  );
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 6,
      padding: 4, borderRadius: 9999,
      background: "rgba(255,255,255,0.06)",
      border: "1px solid rgba(255,255,255,0.08)",
    }}>
      {cell(peerActive, "相手が話す", "JA", "100,181,246")}
      <span className="ms" style={{ fontSize: 16, color: "rgba(235,235,245,0.5)" }}>swap_horiz</span>
      {cell(!peerActive, "あなた", "EN", "52,199,89")}
    </div>
  );
}

function SubtitleLog({ segments, dark }) {
  const scrollRef = React.useRef(null);
  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [segments]);
  return (
    <div ref={scrollRef} style={{
      background: "rgba(0,0,0,0.55)", borderRadius: 14, padding: 12,
      height: "100%", overflow: "hidden", display: "flex", flexDirection: "column", gap: 10,
      border: "1px solid rgba(255,255,255,0.06)",
    }}>
      {segments.map((seg) => {
        const accent = seg.side === "peer" ? "#64B5F6" : "#34C759";
        return (
          <div key={seg.id} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <div style={{
              fontSize: 10, color: accent, fontWeight: 600, letterSpacing: ".06em",
              textTransform: "uppercase", fontFamily: TC_MONO,
            }}>
              {seg.side === "peer" ? "相手" : "あなた"}
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.5, color: "rgba(235,235,245,0.55)" }}>
              {seg.original}
            </div>
            <div style={{
              fontSize: 15, lineHeight: 1.4, color: "#fff", fontWeight: 500,
              textDecoration: seg.isFinal ? "none" : "underline",
              textDecorationStyle: seg.isFinal ? undefined : "dashed",
              textDecorationColor: "rgba(255,255,255,0.4)",
              textUnderlineOffset: 3,
              opacity: seg.isFinal ? 1 : 0.85,
            }}>
              {seg.translated}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CallControl({ icon, label, active, onClick }) {
  return (
    <button onClick={onClick} aria-label={label} style={{
      width: 56, height: 56, borderRadius: 9999, justifySelf: "center",
      background: active ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.12)",
      color: active ? "#1A1A1A" : "#fff",
      border: `1px solid ${active ? "transparent" : "rgba(255,255,255,0.18)"}`,
      cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <span className="ms" style={{ fontSize: 24 }}>{icon}</span>
    </button>
  );
}

Object.assign(window, { ScreenInCall });
