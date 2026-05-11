// Home — SCR-002 — Recent calls + search + FAB
function ScreenHome({ theme, onOpenCall, onCallContact, onNav }) {
  const c = theme;
  const [q, setQ] = React.useState("");
  const calls = [
    { id: 1, name: "山田 智子",    from: "JA", to: "EN", durationSeconds: 154, costYen: 128, missed: false },
    { id: 2, name: "Jack Smith",   from: "EN", to: "JA", durationSeconds: 0,   costYen: 0,   missed: true },
    { id: 3, name: "박서진",        from: "KO", to: "JA", durationSeconds: 492, costYen: 396, missed: false },
    { id: 4, name: "Felix Petit",  from: "FR", to: "JA", durationSeconds: 218, costYen: 174, missed: false },
    { id: 5, name: "Aditya Rao",   from: "HI", to: "EN", durationSeconds: 36,  costYen: 28,  missed: false },
  ];
  const filtered = calls.filter((x) => x.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <div style={{ flex: 1, background: c.bgPrimary, color: c.textPrimary, fontFamily: TC_FONT, display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "60px 16px 12px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em" }}>最近の通話</div>
          <div style={{ display: "flex", gap: 6 }}>
            <TcBadge variant="success" theme={c}>残り 248 分</TcBadge>
          </div>
        </div>
        <div style={{ marginTop: 12, position: "relative" }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="連絡先を検索..."
            style={{
              width: "100%", boxSizing: "border-box", minHeight: 40, padding: "8px 12px 8px 36px",
              background: c.bgSecondary, color: c.textPrimary, border: "none", borderRadius: 10,
              fontSize: 15, fontFamily: TC_FONT, outline: "none",
            }}/>
          <span className="ms" style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: c.textTertiary, fontSize: 20 }}>search</span>
        </div>
      </div>
      <div style={{ flex: 1, overflow: "auto" }}>
        {filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: c.textSecondary, fontSize: 14 }}>通話履歴はありません</div>
        ) : (
          filtered.map((call) => (
            <TcCallRow key={call.id} theme={c} {...call} onClick={() => onOpenCall?.(call)}/>
          ))
        )}
      </div>
      <div style={{
        position: "absolute", right: 16, bottom: 88, width: 56, height: 56, borderRadius: 9999,
        background: c.primary, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: "0 6px 16px rgba(10,122,255,0.32)", fontSize: 24, cursor: "pointer",
      }} onClick={() => onCallContact?.()}>📞</div>
      <TabBar active="home" theme={c} onNav={onNav}/>
    </div>
  );
}

function TabBar({ active = "home", theme, onNav }) {
  const c = theme;
  const tabs = [
    { id: "home", label: "通話", glyph: "📞" },
    { id: "contacts", label: "連絡先", glyph: "👥" },
    { id: "settings", label: "設定", glyph: "⚙︎" },
  ];
  return (
    <div style={{
      display: "flex", borderTop: `1px solid ${c.border}`, background: c.bgPrimary, padding: "6px 0 18px",
    }}>
      {tabs.map((t) => (
        <button key={t.id} onClick={() => onNav?.(t.id)} style={{
          flex: 1, background: "none", border: "none", cursor: "pointer", padding: "6px 0",
          color: active === t.id ? c.primary : c.textSecondary, fontFamily: TC_FONT,
        }}>
          <div style={{ fontSize: 20, lineHeight: 1 }}>{t.glyph}</div>
          <div style={{ fontSize: 10, fontWeight: 600, marginTop: 2, letterSpacing: ".02em" }}>{t.label}</div>
        </button>
      ))}
    </div>
  );
}

Object.assign(window, { ScreenHome, TabBar });
