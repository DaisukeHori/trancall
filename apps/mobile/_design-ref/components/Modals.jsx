// Modal & Sheet primitives + three concrete modals:
//   - LoginSheet (Sign in)
//   - AddContactSheet (QR / 招待リンク, SCR-007)
//   - LowBalanceSheet (残量不足警告)
//
// Sheet style follows iOS bottom-sheet pattern: backdrop + rounded-top panel + drag handle.

function TcSheet({ open, onClose, theme, height = "auto", children }) {
  const c = theme;
  if (!open) return null;
  return (
    <div style={{
      position: "absolute", inset: 0, zIndex: 50, fontFamily: TC_FONT,
      display: "flex", flexDirection: "column", justifyContent: "flex-end",
    }}>
      <div onClick={onClose} style={{
        position: "absolute", inset: 0, background: "rgba(0,0,0,0.45)",
        animation: "tcFadeIn .18s ease-out",
      }}/>
      <div style={{
        position: "relative", background: c.bgPrimary, color: c.textPrimary,
        borderTopLeftRadius: 20, borderTopRightRadius: 20,
        padding: "8px 0 24px", height,
        boxShadow: "0 -12px 32px rgba(0,0,0,0.25)",
        animation: "tcSlideUp .25s cubic-bezier(.2,.7,.2,1)",
      }}>
        <div style={{ display: "flex", justifyContent: "center", padding: "6px 0 8px" }}>
          <span style={{ width: 36, height: 5, borderRadius: 9999, background: c.bgTertiary }}/>
        </div>
        <div style={{ padding: "0 20px" }}>{children}</div>
      </div>
      <style>{`
        @keyframes tcFadeIn{from{opacity:0}to{opacity:1}}
        @keyframes tcSlideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
      `}</style>
    </div>
  );
}

function SheetHeader({ title, subtitle, onClose, theme }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.01em" }}>{title}</div>
        {subtitle && (
          <div style={{ fontSize: 13, color: theme.textSecondary, marginTop: 4, lineHeight: 1.4 }}>{subtitle}</div>
        )}
      </div>
      <button onClick={onClose} aria-label="閉じる" style={{
        width: 32, height: 32, borderRadius: 9999, border: "none",
        background: theme.bgSecondary, cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        color: theme.textSecondary,
      }}>
        <span className="ms" style={{ fontSize: 20 }}>close</span>
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Login sheet
// ─────────────────────────────────────────────────────────────
function LoginSheet({ open, onClose, theme, onSignedIn }) {
  return (
    <TcSheet open={open} onClose={onClose} theme={theme}>
      <SheetHeader theme={theme} onClose={onClose}
        title="TranCallにサインイン"
        subtitle="連絡先・通話履歴・残量を端末間で同期します。Sign-in only takes a moment."/>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 12 }}>
        <SignInButton theme={theme} provider="apple"  label="Appleでサインイン"   icon="apple"  onClick={onSignedIn}/>
        <SignInButton theme={theme} provider="google" label="Googleでサインイン" icon="g_translate" onClick={onSignedIn}/>
        <SignInButton theme={theme} provider="email"  label="メールアドレスで続ける" icon="mail"  onClick={onSignedIn}/>
      </div>
      <div style={{
        fontSize: 11, color: theme.textTertiary, textAlign: "center",
        lineHeight: 1.5, marginTop: 8,
      }}>
        続行することで <u>利用規約</u> および <u>プライバシーポリシー</u> に同意したものとみなされます。
      </div>
    </TcSheet>
  );
}

function SignInButton({ provider, label, icon, onClick, theme }) {
  const dark = provider === "apple";
  const bg = dark ? "#000" : (provider === "google" ? "#fff" : theme.bgSecondary);
  const fg = dark ? "#fff" : (provider === "google" ? "#1A1A1A" : theme.textPrimary);
  const border = provider === "google" ? "1px solid #DADCE0" : "none";
  return (
    <button onClick={onClick} style={{
      minHeight: 50, padding: "0 16px", borderRadius: 12, background: bg, color: fg,
      border, cursor: "pointer", fontFamily: TC_FONT, fontWeight: 600, fontSize: 15,
      display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
    }}>
      <span className="ms" style={{ fontSize: 20 }}>{icon}</span>
      {label}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────
// Add contact sheet — QR + invite link (SCR-007)
// ─────────────────────────────────────────────────────────────
function AddContactSheet({ open, onClose, theme }) {
  const [mode, setMode] = React.useState("show"); // show | scan
  const [copied, setCopied] = React.useState(false);
  const link = "https://trancall.app/u/hori.dk";
  const copy = () => { setCopied(true); setTimeout(() => setCopied(false), 1400); };
  return (
    <TcSheet open={open} onClose={onClose} theme={theme}>
      <SheetHeader theme={theme} onClose={onClose}
        title="連絡先を追加"
        subtitle="QRコードを見せ合うか、招待リンクを共有してください。"/>

      <div style={{
        display: "flex", padding: 3, background: theme.bgSecondary, borderRadius: 10,
        marginBottom: 16,
      }}>
        {[["show", "あなたのQR"], ["scan", "QRをスキャン"]].map(([id, label]) => (
          <button key={id} onClick={() => setMode(id)} style={{
            flex: 1, padding: "8px 0", borderRadius: 8, border: "none",
            background: mode === id ? theme.bgPrimary : "transparent",
            boxShadow: mode === id ? "0 1px 3px rgba(0,0,0,.08)" : "none",
            color: mode === id ? theme.textPrimary : theme.textSecondary,
            fontFamily: TC_FONT, fontWeight: 600, fontSize: 13, cursor: "pointer",
          }}>{label}</button>
        ))}
      </div>

      <div style={{
        background: theme.bgSecondary, borderRadius: 16, padding: 20,
        display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
        marginBottom: 16,
      }}>
        {mode === "show" ? <FakeQR theme={theme}/> : <QRScanFrame theme={theme}/>}
        <div style={{ fontSize: 14, fontWeight: 600 }}>@hori.dk</div>
        <div style={{ fontSize: 11, color: theme.textTertiary, fontFamily: TC_MONO }}>
          {mode === "show" ? "TranCall ID" : "枠内にコードを合わせてください"}
        </div>
      </div>

      <div style={{ fontSize: 12, fontWeight: 600, color: theme.textSecondary, letterSpacing: ".06em", textTransform: "uppercase", marginBottom: 8 }}>
        招待リンク
      </div>
      <div style={{
        display: "flex", alignItems: "center", gap: 8, padding: "10px 12px",
        background: theme.bgSecondary, borderRadius: 10, marginBottom: 16,
      }}>
        <span className="ms" style={{ fontSize: 18, color: theme.textTertiary }}>link</span>
        <div style={{ flex: 1, fontFamily: TC_MONO, fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {link}
        </div>
        <button onClick={copy} style={{
          background: "none", border: "none", color: theme.primary, fontFamily: TC_FONT,
          fontWeight: 600, fontSize: 13, cursor: "pointer", padding: 0,
        }}>{copied ? "コピーしました" : "コピー"}</button>
      </div>

      <TcButton variant="primary" size="lg" full theme={theme}
        onClick={onClose}>連絡先一覧に戻る</TcButton>
    </TcSheet>
  );
}

function FakeQR({ theme }) {
  // 9×9 deterministic pattern — looks like a QR without being one
  const seed = "trancall-hori";
  const cells = [];
  for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) {
    const on = ((seed.charCodeAt((y * 9 + x) % seed.length) + x * 7 + y * 11) & 3) > 1;
    cells.push({ x, y, on });
  }
  const finder = (cx, cy) => (
    <g>
      <rect x={cx} y={cy} width="3" height="3" fill={theme.textPrimary}/>
      <rect x={cx + 0.5} y={cy + 0.5} width="2" height="2" fill={theme.bgSecondary}/>
      <rect x={cx + 1} y={cy + 1} width="1" height="1" fill={theme.textPrimary}/>
    </g>
  );
  return (
    <div style={{
      width: 168, height: 168, background: "#fff", borderRadius: 12, padding: 12, boxSizing: "border-box",
      boxShadow: "0 1px 3px rgba(0,0,0,.05)",
    }}>
      <svg viewBox="0 0 9 9" width="100%" height="100%" shapeRendering="crispEdges">
        {cells.map((c) => c.on && !inFinder(c.x, c.y) && (
          <rect key={`${c.x}-${c.y}`} x={c.x} y={c.y} width="1" height="1" fill="#0A1A33"/>
        ))}
        {finder(0, 0)}{finder(6, 0)}{finder(0, 6)}
      </svg>
    </div>
  );
}
function inFinder(x, y) { return (x < 3 && y < 3) || (x > 5 && y < 3) || (x < 3 && y > 5); }

function QRScanFrame({ theme }) {
  return (
    <div style={{
      width: 168, height: 168, borderRadius: 12, position: "relative",
      background: "linear-gradient(135deg, #1a1a2e, #0f1626)", overflow: "hidden",
    }}>
      {[["tl",4,4,"tt"], ["tr",null,4,"tt"], ["bl",4,null,"bb"], ["br",null,null,"bb"]].map(([k, l, t]) => (
        <div key={k} style={{
          position: "absolute", width: 24, height: 24,
          [l === 4 ? "left" : "right"]: 10, [t === 4 ? "top" : "bottom"]: 10,
          borderTop: t === 4 ? `3px solid ${theme.primary}` : "none",
          borderBottom: t !== 4 ? `3px solid ${theme.primary}` : "none",
          borderLeft: l === 4 ? `3px solid ${theme.primary}` : "none",
          borderRight: l !== 4 ? `3px solid ${theme.primary}` : "none",
          borderTopLeftRadius: l === 4 && t === 4 ? 6 : 0,
          borderTopRightRadius: l !== 4 && t === 4 ? 6 : 0,
          borderBottomLeftRadius: l === 4 && t !== 4 ? 6 : 0,
          borderBottomRightRadius: l !== 4 && t !== 4 ? 6 : 0,
        }}/>
      ))}
      <div style={{
        position: "absolute", left: 10, right: 10, top: 80, height: 2,
        background: `linear-gradient(90deg, transparent, ${theme.primary}, transparent)`,
        animation: "tcScan 1.8s ease-in-out infinite",
      }}/>
      <style>{`@keyframes tcScan{0%,100%{transform:translateY(-60px);opacity:.4}50%{transform:translateY(60px);opacity:1}}`}</style>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Low balance sheet — 残量不足警告
// ─────────────────────────────────────────────────────────────
function LowBalanceSheet({ open, onClose, theme }) {
  return (
    <TcSheet open={open} onClose={onClose} theme={theme}>
      <div style={{
        width: 56, height: 56, borderRadius: 9999, background: "rgba(255,149,0,0.16)",
        display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 12px",
      }}>
        <span className="ms fill" style={{ fontSize: 32, color: "#FF9500" }}>warning</span>
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, textAlign: "center", letterSpacing: "-0.01em" }}>
        残量が少なくなっています
      </div>
      <div style={{
        fontSize: 14, color: theme.textSecondary, textAlign: "center",
        lineHeight: 1.5, marginTop: 8, marginBottom: 20,
      }}>
        残り <strong style={{ color: theme.textPrimary }}>12 分</strong> です。<br/>
        翻訳通話を継続するには、プランをアップグレードするか、追加分を購入してください。
      </div>

      <div style={{
        background: theme.bgSecondary, borderRadius: 12, padding: 14, marginBottom: 16,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
          <div style={{ fontSize: 13, color: theme.textSecondary, fontWeight: 500 }}>Standard プラン · 月 ¥1,480</div>
          <div style={{ fontFamily: TC_MONO, fontSize: 12, color: theme.textTertiary }}>12 / 300 分</div>
        </div>
        <div style={{ height: 6, borderRadius: 9999, background: theme.bgTertiary, overflow: "hidden" }}>
          <div style={{ width: "4%", height: "100%", background: "#FF9500" }}/>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <TcButton variant="primary" size="lg" full theme={theme} onClick={onClose}>
          プランをアップグレード
        </TcButton>
        <TcButton variant="secondary" size="lg" full theme={theme} onClick={onClose}>
          60 分追加 (¥600) を購入
        </TcButton>
        <button onClick={onClose} style={{
          background: "none", border: "none", color: theme.textSecondary, fontFamily: TC_FONT,
          fontSize: 14, fontWeight: 500, padding: "10px 0", cursor: "pointer",
        }}>あとで</button>
      </div>
    </TcSheet>
  );
}

Object.assign(window, { TcSheet, SheetHeader, LoginSheet, AddContactSheet, LowBalanceSheet });
