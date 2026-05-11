// CallCard + ContactRow recreations of packages/ui-kit/src/components/

function fmtDur(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function TcCallRow({ name, initials, from, to, durationSeconds, costYen, missed, onClick, theme }) {
  const c = theme;
  return (
    <button onClick={onClick} style={{
      display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", minHeight: 64,
      background: "transparent", border: "none", borderBottom: `1px solid ${c.border}`,
      width: "100%", textAlign: "left", cursor: "pointer", fontFamily: TC_FONT,
    }}>
      <TcAvatar size="md" initials={initials || name.slice(0, 2)} theme={c}/>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 16, fontWeight: 500, color: missed ? c.danger : c.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</div>
        <div style={{ fontSize: 13, color: c.textSecondary, marginTop: 2 }}>
          {from} → {to}{missed ? " · 不在着信" : ""}
        </div>
      </div>
      <div style={{ textAlign: "right", fontFamily: TC_MONO, fontVariantNumeric: "tabular-nums" }}>
        <div style={{ fontSize: 13, color: c.textSecondary }}>{missed ? "—" : fmtDur(durationSeconds)}</div>
        {costYen != null && <div style={{ fontSize: 12, color: c.textTertiary, marginTop: 2 }}>¥{costYen}</div>}
      </div>
    </button>
  );
}

function TcContactRow({ name, trancallId, isFavorite, onClick, onToggleFav, theme }) {
  const c = theme;
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", minHeight: 64,
      borderBottom: `1px solid ${c.border}`, fontFamily: TC_FONT, background: c.bgPrimary,
    }}>
      <TcAvatar size="md" initials={name.slice(0, 2)} theme={c}/>
      <button onClick={onClick} style={{ flex: 1, textAlign: "left", background: "none", border: "none", padding: 0, cursor: "pointer" }}>
        <div style={{ fontSize: 16, fontWeight: 500, color: c.textPrimary }}>{name}</div>
        <div style={{ fontSize: 13, color: c.textSecondary, marginTop: 2, fontFamily: TC_MONO }}>{trancallId}</div>
      </button>
      <button onClick={onToggleFav} aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
        style={{ minWidth: 44, minHeight: 44, display: "flex", alignItems: "center", justifyContent: "center",
                 background: "none", border: "none", cursor: "pointer",
                 fontSize: 20, color: isFavorite ? c.warning : c.border }}>
        {isFavorite ? "★" : "☆"}
      </button>
      <div style={{ fontSize: 20, color: c.textTertiary, marginLeft: 4 }}>›</div>
    </div>
  );
}

Object.assign(window, { TcCallRow, TcContactRow, fmtDur });
