// Contacts — SCR-005
function ScreenContacts({ theme, onNav, onCallContact }) {
  const c = theme;
  const [favs, setFavs] = React.useState({ "@tomoko.ym": true, "@felix.fr": true });
  const [q, setQ] = React.useState("");
  const contacts = [
    { name: "山田 智子",     id: "@tomoko.ym" },
    { name: "Felix Petit",   id: "@felix.fr" },
    { name: "Jack Smith",    id: "@jacks" },
    { name: "박서진",         id: "@seojin" },
    { name: "Aditya Rao",    id: "@aditya.in" },
    { name: "María García",  id: "@maria.es" },
  ];
  const filtered = contacts.filter((x) =>
    x.name.toLowerCase().includes(q.toLowerCase()) || x.id.toLowerCase().includes(q.toLowerCase())
  );
  return (
    <div style={{ flex: 1, background: c.bgPrimary, color: c.textPrimary, fontFamily: TC_FONT, display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "60px 16px 12px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: "-0.02em" }}>連絡先</div>
          <button style={{ background: "none", border: "none", color: c.primary, fontWeight: 600, fontSize: 15, cursor: "pointer" }}>＋ 追加</button>
        </div>
        <div style={{ marginTop: 12 }}>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="TranCall IDまたは名前で検索..." style={{
            width: "100%", boxSizing: "border-box", minHeight: 40, padding: "8px 12px",
            background: c.bgSecondary, border: "none", borderRadius: 10, fontSize: 15, fontFamily: TC_FONT, outline: "none", color: c.textPrimary,
          }}/>
        </div>
      </div>
      <div style={{ flex: 1, overflow: "auto" }}>
        <div style={{ padding: "12px 16px 6px", fontSize: 12, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: c.textSecondary }}>
          お気に入り
        </div>
        {filtered.filter((x) => favs[x.id]).map((p) => (
          <TcContactRow key={p.id} theme={c} name={p.name} trancallId={p.id} isFavorite={!!favs[p.id]}
            onToggleFav={() => setFavs({ ...favs, [p.id]: !favs[p.id] })}
            onClick={() => onCallContact?.(p)}/>
        ))}
        <div style={{ padding: "16px 16px 6px", fontSize: 12, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase", color: c.textSecondary }}>
          すべての連絡先
        </div>
        {filtered.filter((x) => !favs[x.id]).map((p) => (
          <TcContactRow key={p.id} theme={c} name={p.name} trancallId={p.id} isFavorite={!!favs[p.id]}
            onToggleFav={() => setFavs({ ...favs, [p.id]: !favs[p.id] })}
            onClick={() => onCallContact?.(p)}/>
        ))}
      </div>
      <TabBar active="contacts" theme={c} onNav={onNav}/>
    </div>
  );
}
Object.assign(window, { ScreenContacts });
