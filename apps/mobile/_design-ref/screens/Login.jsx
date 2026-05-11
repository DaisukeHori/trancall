// Login — first screen before Onboarding (language pick).
// Apple / Google / Email entry; switches to email form when "メール" is tapped.
function ScreenLogin({ theme, onSignedIn }) {
  const c = theme;
  const [mode, setMode] = React.useState("providers"); // providers | email
  const [email, setEmail] = React.useState("");

  return (
    <div style={{
      flex: 1, background: c.bgPrimary, color: c.textPrimary, padding: "72px 24px 32px",
      fontFamily: TC_FONT, display: "flex", flexDirection: "column",
    }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", marginBottom: 32 }}>
        <img src="../../assets/trancall-icon.svg" alt="" style={{
          width: 84, height: 84, marginBottom: 16, borderRadius: 20,
          boxShadow: "0 10px 24px rgba(10,108,224,0.22)",
        }}/>
        <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em" }}>TranCall</div>
        <div style={{ fontSize: 15, color: c.textSecondary, marginTop: 6, lineHeight: 1.5, maxWidth: 280 }}>
          すべての通話を、自分の言語で。<br/>
          <span style={{ color: c.textTertiary, fontSize: 13 }}>Sign in to sync contacts and balance.</span>
        </div>
      </div>

      <div style={{ flex: 1 }}/>

      {mode === "providers" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <ProviderButton variant="apple"  label="Appleでサインイン"   onClick={onSignedIn} theme={c}/>
          <ProviderButton variant="google" label="Googleでサインイン" onClick={onSignedIn} theme={c}/>
          <ProviderButton variant="email"  label="メールアドレスで続ける" onClick={() => setMode("email")} theme={c}/>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: c.textSecondary, letterSpacing: ".04em" }}>
            メールアドレス
          </div>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" type="email" autoFocus
            style={{
              minHeight: 48, padding: "12px 14px", borderRadius: 12, border: "none",
              background: c.bgSecondary, color: c.textPrimary, fontSize: 16, fontFamily: TC_FONT, outline: "none",
            }}/>
          <TcButton variant="primary" size="lg" full theme={c} onClick={onSignedIn} disabled={!email.includes("@")}>
            続ける
          </TcButton>
          <button onClick={() => setMode("providers")} style={{
            background: "none", border: "none", color: c.primary, fontFamily: TC_FONT,
            fontSize: 14, fontWeight: 600, padding: 8, cursor: "pointer",
          }}>← 他のサインイン方法</button>
        </div>
      )}

      <div style={{
        fontSize: 11, color: c.textTertiary, textAlign: "center",
        lineHeight: 1.5, marginTop: 16,
      }}>
        続行することで <u>利用規約</u> および <u>プライバシーポリシー</u> に同意したものとみなされます。
      </div>
    </div>
  );
}

function ProviderButton({ variant, label, onClick, theme }) {
  const dark = variant === "apple";
  const bg = dark ? "#000" : (variant === "google" ? "#fff" : theme.bgSecondary);
  const fg = dark ? "#fff" : (variant === "google" ? "#1A1A1A" : theme.textPrimary);
  const border = variant === "google" ? "1px solid #DADCE0" : "none";
  let glyph = null;
  if (variant === "apple") {
    glyph = (
      <svg width="18" height="22" viewBox="0 0 18 22" fill="currentColor" aria-hidden="true">
        <path d="M13.6 11.6c0-2.4 2-3.5 2.1-3.6-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.7.9-.8 0-1.9-.9-3.2-.9-1.6 0-3.2.9-4 2.4-1.7 3-.4 7.4 1.2 9.8.8 1.2 1.8 2.5 3.1 2.4 1.2 0 1.7-.8 3.2-.8 1.5 0 1.9.8 3.2.8 1.3 0 2.2-1.2 3-2.4.9-1.4 1.3-2.7 1.3-2.8-.1 0-2.7-1-2.7-3.9zm-2.4-7.2c.7-.8 1.1-2 1-3.1-1 0-2.2.7-2.9 1.5-.6.7-1.2 1.9-1 3 1.1.1 2.2-.6 2.9-1.4z"/>
      </svg>
    );
  } else if (variant === "google") {
    glyph = (
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <path d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" fill="#4285F4"/>
        <path d="M9 18c2.43 0 4.47-.81 5.96-2.18l-2.92-2.26c-.81.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.32A8.99 8.99 0 0 0 9 18z" fill="#34A853"/>
        <path d="M3.97 10.71A5.4 5.4 0 0 1 3.68 9c0-.59.1-1.16.29-1.71V4.97H.96A8.99 8.99 0 0 0 0 9c0 1.45.35 2.83.96 4.03l3-2.32z" fill="#FBBC05"/>
        <path d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A8.99 8.99 0 0 0 9 0 8.99 8.99 0 0 0 .96 4.97l3 2.32C4.68 5.16 6.66 3.58 9 3.58z" fill="#EA4335"/>
      </svg>
    );
  } else {
    glyph = <span className="ms" style={{ fontSize: 20 }}>mail</span>;
  }
  return (
    <button onClick={onClick} aria-label={label} style={{
      minHeight: 52, padding: "0 16px", borderRadius: 12, background: bg, color: fg,
      border, cursor: "pointer", fontFamily: TC_FONT, fontWeight: 600, fontSize: 15,
      display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
    }}>
      {glyph}
      {label}
    </button>
  );
}

Object.assign(window, { ScreenLogin });
