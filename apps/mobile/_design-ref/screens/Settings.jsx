// Settings — SCR-006
function ScreenSettings({ theme, onNav, dark, onToggleTheme }) {
  const c = theme;
  const [subtitles, setSubtitles] = React.useState(true);
  const [notif, setNotif] = React.useState(true);
  const [lang, setLang] = React.useState("ja");
  return (
    <div style={{ flex: 1, background: c.bgSecondary, color: c.textPrimary, fontFamily: TC_FONT, display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "60px 16px 12px" }}>
        <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em" }}>設定</div>
      </div>
      <div style={{ flex: 1, overflow: "auto", padding: "0 16px 16px" }}>
        {/* Plan card */}
        <TcCard theme={c} padding={16} style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <div style={{ fontSize: 14, color: c.textSecondary, fontWeight: 500 }}>現在のプラン</div>
            <button style={{ background: "none", border: "none", color: c.primary, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>管理</button>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
            <div style={{ fontSize: 18, fontWeight: 600 }}>Standard</div>
            <TcBadge variant="success" theme={c}>残り 248 分</TcBadge>
          </div>
          <div style={{ marginTop: 10, height: 6, borderRadius: 9999, background: c.bgTertiary, overflow: "hidden" }}>
            <div style={{ width: "82%", height: "100%", background: c.primary }}/>
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: c.textSecondary, fontFamily: TC_MONO }}>248 / 300 分 · 約 ¥1,480/月</div>
        </TcCard>

        {/* Profile */}
        <SectionHeader theme={c}>プロフィール</SectionHeader>
        <SettingsGroup theme={c}>
          <SettingsRow theme={c} label="表示名" value="Daisuke"/>
          <SettingsRow theme={c} label="TranCall ID" value="@hori.dk" mono/>
          <SettingsRow theme={c} label="母国語" value={TC_LANGS.find((l) => l.code === lang)?.native || lang}/>
        </SettingsGroup>

        {/* Preferences */}
        <SectionHeader theme={c}>通話 & 翻訳</SectionHeader>
        <SettingsGroup theme={c}>
          <SettingsRow theme={c} label="字幕表示" toggle value={subtitles} onChange={setSubtitles}/>
          <SettingsRow theme={c} label="通知" toggle value={notif} onChange={setNotif}/>
          <SettingsRow theme={c} label="ダークモード" toggle value={dark} onChange={onToggleTheme}/>
        </SettingsGroup>

        <SectionHeader theme={c}>サポート</SectionHeader>
        <SettingsGroup theme={c}>
          <SettingsRow theme={c} label="TranCallについて" chevron/>
          <SettingsRow theme={c} label="プライバシーポリシー" chevron/>
          <SettingsRow theme={c} label="利用規約" chevron/>
          <SettingsRow theme={c} label="アカウントを削除" chevron danger/>
        </SettingsGroup>
      </div>
      <TabBar active="settings" theme={c} onNav={onNav}/>
    </div>
  );
}

function SectionHeader({ children, theme }) {
  return (
    <div style={{
      padding: "16px 4px 8px", fontSize: 12, fontWeight: 600, letterSpacing: ".06em",
      textTransform: "uppercase", color: theme.textSecondary, fontFamily: TC_FONT,
    }}>{children}</div>
  );
}

function SettingsGroup({ children, theme }) {
  return (
    <div style={{
      background: theme.bgPrimary, borderRadius: 12, border: `1px solid ${theme.border}`, overflow: "hidden",
    }}>{children}</div>
  );
}

function SettingsRow({ label, value, toggle, onChange, chevron, danger, mono, theme }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10, minHeight: 48, padding: "10px 14px",
      borderBottom: `1px solid ${theme.border}`, fontFamily: TC_FONT,
    }}>
      <div style={{ flex: 1, fontSize: 15, color: danger ? theme.danger : theme.textPrimary, fontWeight: 500 }}>{label}</div>
      {toggle ? (
        <button onClick={() => onChange?.(!value)} aria-label={label} style={{
          width: 50, height: 30, borderRadius: 9999, background: value ? "#34C759" : theme.bgTertiary,
          border: "none", position: "relative", cursor: "pointer", transition: "background .2s",
        }}>
          <span style={{
            position: "absolute", top: 2, left: value ? 22 : 2, width: 26, height: 26, borderRadius: 50,
            background: "#fff", boxShadow: "0 2px 4px rgba(0,0,0,.2)", transition: "left .2s",
          }}/>
        </button>
      ) : (
        <>
          <div style={{
            fontSize: 14, color: theme.textSecondary,
            fontFamily: mono ? TC_MONO : TC_FONT,
          }}>{value}</div>
          {chevron && <div style={{ fontSize: 18, color: theme.textTertiary }}>›</div>}
        </>
      )}
    </div>
  );
}

Object.assign(window, { ScreenSettings });
