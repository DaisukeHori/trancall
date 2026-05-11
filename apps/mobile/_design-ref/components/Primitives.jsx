// Primitives — Button / Badge / Avatar / Card / Input
// Mirror packages/ui-kit/src/components/{Button,Badge,Avatar,Card,Input}.tsx

function TcButton({ variant = "primary", size = "md", disabled, onClick, children, full, theme }) {
  const c = theme;
  const bg = { primary: c.primary, secondary: c.bgSecondary, danger: c.danger, ghost: "transparent" }[variant];
  const fg = { primary: "#fff", secondary: c.textPrimary, danger: "#fff", ghost: c.primary }[variant];
  const pv = { sm: 8, md: 12, lg: 16 }[size];
  const ph = { sm: 12, md: 16, lg: 24 }[size];
  const fs = { sm: 14, md: 16, lg: 18 }[size];
  const minH = { sm: 36, md: 44, lg: 52 }[size];
  return (
    <button onClick={disabled ? undefined : onClick} disabled={!!disabled}
      style={{
        background: bg, color: fg, border: variant === "ghost" ? `1px solid ${c.primary}` : "none",
        padding: `${pv}px ${ph}px`, minHeight: minH, borderRadius: 8, fontSize: fs, fontWeight: 600,
        fontFamily: TC_FONT, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.5 : 1,
        width: full ? "100%" : "auto", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
      }}>{children}</button>
  );
}

function TcBadge({ variant = "default", children, theme }) {
  const c = theme;
  const bg = { default: c.primaryBg, success: c.successBg, warning: c.warningBg, danger: c.dangerBg }[variant];
  const fg = { default: c.primary, success: c.success, warning: c.warning, danger: c.danger }[variant];
  return (
    <span style={{
      background: bg, color: fg, padding: "2px 8px", borderRadius: 9999, fontSize: 12, fontWeight: 500,
      fontFamily: TC_FONT, display: "inline-flex", alignItems: "center", gap: 6,
    }}>{children}</span>
  );
}

function TcAvatar({ size = "md", initials = "?", uri, theme, style }) {
  const c = theme;
  const dim = { sm: 32, md: 40, lg: 56, xl: 80 }[size];
  const fs = { sm: 12, md: 16, lg: 22, xl: 32 }[size];
  if (uri) {
    return <img src={uri} alt="" style={{ width: dim, height: dim, borderRadius: 9999, objectFit: "cover", ...style }} />;
  }
  return (
    <div style={{
      width: dim, height: dim, borderRadius: 9999, background: c.primaryBg, color: c.primary,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontWeight: 600, fontSize: fs, fontFamily: TC_FONT, ...style,
    }}>{(initials || "?").slice(0, 2).toUpperCase()}</div>
  );
}

function TcCard({ padding = 16, children, theme, style }) {
  const c = theme;
  return (
    <div style={{
      background: c.bgPrimary, border: `1px solid ${c.border}`, borderRadius: 12, padding,
      boxShadow: "0 2px 4px rgba(0,0,0,0.08)", ...style,
    }}>{children}</div>
  );
}

function TcInput({ label, value, onChange, placeholder, error, theme }) {
  const c = theme;
  const [focus, setFocus] = React.useState(false);
  const borderColor = error ? c.danger : focus ? c.primary : c.border;
  return (
    <div style={{ width: "100%", fontFamily: TC_FONT }}>
      {label && <div style={{ fontSize: 14, fontWeight: 500, color: c.textSecondary, marginBottom: 4 }}>{label}</div>}
      <input value={value || ""} onChange={(e) => onChange?.(e.target.value)} placeholder={placeholder}
        onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        style={{
          width: "100%", boxSizing: "border-box", minHeight: 44, padding: "10px 12px",
          border: `1px solid ${borderColor}`, borderRadius: 8, background: c.bgPrimary, color: c.textPrimary,
          fontSize: 16, fontFamily: TC_FONT, outline: "none",
        }}/>
      {error && <div style={{ fontSize: 12, color: c.danger, marginTop: 4 }}>{error}</div>}
    </div>
  );
}

Object.assign(window, { TcButton, TcBadge, TcAvatar, TcCard, TcInput });
