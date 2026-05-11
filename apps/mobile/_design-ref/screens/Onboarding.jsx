// Onboarding — SCR-001 — 13-language grid
function ScreenOnboarding({ theme, onContinue }) {
  const c = theme;
  const [picked, setPicked] = React.useState("ja");
  return (
    <div style={{
      flex: 1, background: c.bgPrimary, color: c.textPrimary, padding: "72px 24px 24px",
      fontFamily: TC_FONT, display: "flex", flexDirection: "column",
    }}>
      <img src="../../assets/trancall-icon.svg" alt="" style={{ width: 80, height: 80, marginBottom: 20, borderRadius: 18, boxShadow: "0 8px 20px rgba(10,108,224,0.22)" }}/>
      <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em", lineHeight: 1.2 }}>TranCall</div>
      <div style={{ fontSize: 16, color: c.textSecondary, marginTop: 4 }}>すべての通話を、自分の言語で。</div>

      <div style={{ marginTop: 32, fontSize: 14, fontWeight: 600, color: c.textSecondary }}>
        母国語を選択してください
      </div>
      <div style={{
        marginTop: 12, display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8,
        flex: 1, alignContent: "flex-start", overflow: "auto",
      }}>
        {TC_LANGS.map((l) => {
          const sel = picked === l.code;
          return (
            <button key={l.code} onClick={() => setPicked(l.code)} style={{
              display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
              padding: "12px 4px", borderRadius: 12,
              border: sel ? `2px solid ${c.primary}` : `1px solid ${c.border}`,
              background: sel ? c.primaryBg : c.bgPrimary,
              color: sel ? c.primary : c.textPrimary,
              fontFamily: TC_FONT, cursor: "pointer", minHeight: 64,
            }}>
              <div style={{ fontSize: 22, lineHeight: 1 }}>{l.flag}</div>
              <div style={{ fontSize: 12, fontWeight: 600 }}>{l.native}</div>
            </button>
          );
        })}
      </div>
      <div style={{ marginTop: 16 }}>
        <TcButton variant="primary" size="lg" full theme={c} onClick={() => onContinue?.(picked)}>続ける</TcButton>
        <div style={{ fontSize: 11, color: c.textTertiary, textAlign: "center", marginTop: 8 }}>
          GPT-Realtime-Translate: 13出力言語対応
        </div>
      </div>
    </div>
  );
}
Object.assign(window, { ScreenOnboarding });
