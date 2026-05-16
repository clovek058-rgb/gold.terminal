import { useState, useEffect, useRef } from "react";

// ─── HELPERS ──────────────────────────────────────────────────────────────
const fmt = (n, d = 0) => n != null ? n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—";
const fmtM = (n) => {
  if (n == null) return "—";
  const a = Math.abs(n);
  if (a >= 1e6) return `${n > 0 ? "+" : ""}${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${n > 0 ? "+" : ""}${(n / 1e3).toFixed(0)}K`;
  return String(n);
};
const sign = (n) => (n >= 0 ? "+" : "");

// ─── MINI COMPONENTS ──────────────────────────────────────────────────────
const Badge = ({ label, color = "gray" }) => {
  const c = {
    green:  "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
    red:    "bg-red-500/20 text-red-300 border-red-500/40",
    yellow: "bg-amber-500/20 text-amber-300 border-amber-500/40",
    blue:   "bg-sky-500/20 text-sky-300 border-sky-500/40",
    gray:   "bg-zinc-700/40 text-zinc-400 border-zinc-600/40",
  }[color];
  return <span className={`border rounded font-mono font-bold tracking-widest text-[9px] px-2 py-0.5 ${c}`}>{label}</span>;
};

const Card = ({ children, className = "", glow }) => (
  <div className={`rounded-xl border border-zinc-800 bg-zinc-900/70 backdrop-blur p-3 ${glow ? "border-amber-500/30 shadow-[0_0_20px_rgba(245,158,11,0.08)]" : ""} ${className}`}>
    {children}
  </div>
);

const Sec = ({ children, sub }) => (
  <div className="mb-2.5">
    <h2 className="text-[9px] font-mono tracking-[0.25em] text-zinc-500 uppercase">{children}</h2>
    {sub && <p className="text-[9px] text-zinc-600 mt-0.5">{sub}</p>}
  </div>
);

const KV = ({ label, value, valueClass = "text-zinc-200", sub }) => (
  <div className="flex items-center justify-between py-1 border-b border-zinc-800/50 last:border-0">
    <span className="text-[10px] text-zinc-500">{label}</span>
    <div className="text-right">
      <span className={`text-[11px] font-mono font-bold ${valueClass}`}>{value}</span>
      {sub && <div className="text-[8px] text-zinc-600">{sub}</div>}
    </div>
  </div>
);

function Sparkline({ data = [], color = "#f59e0b", height = 36 }) {
  if (!data.length) return null;
  const vals = data.map(d => typeof d === "object" ? (d.nc ?? 0) : d);
  const min = Math.min(...vals), max = Math.max(...vals);
  const r = max - min || 1;
  const W = 220, H = height;
  const pts = vals.map((v, i) => `${(i / (vals.length - 1)) * W},${H - ((v - min) / r) * (H - 2) - 1}`);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height }}>
      <defs>
        <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`M${pts.join("L")}L${W},${H}L0,${H}Z`} fill="url(#sg)" />
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx={pts.at(-1).split(",")[0]} cy={pts.at(-1).split(",")[1]} r="2.5" fill={color} />
    </svg>
  );
}

function MiniPriceChart({ data = [], ema8, ema21, spot }) {
  if (!data.length) return null;
  const min = Math.min(...data) - 10, max = Math.max(...data) + 10;
  const r = max - min;
  const W = 300, H = 70;
  const x = (i) => (i / (data.length - 1)) * W;
  const y = (v) => H - ((v - min) / r) * H;
  const pts = data.map((v, i) => `${x(i)},${y(v)}`).join("L");
  const spotY = y(spot);
  return (
    <svg viewBox={`0 0 ${W} ${H + 10}`} className="w-full" style={{ height: 80 }}>
      <defs>
        <linearGradient id="pg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#f59e0b" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`M${pts}L${W},${H}L0,${H}Z`} fill="url(#pg)" />
      <path d={`M${pts}`} fill="none" stroke="#f59e0b" strokeWidth="1.8" strokeLinejoin="round" />
      {ema8  && <line x1="0" y1={y(ema8)}  x2={W} y2={y(ema8)}  stroke="#34d399" strokeWidth="0.8" strokeDasharray="3,3" opacity="0.7" />}
      {ema21 && <line x1="0" y1={y(ema21)} x2={W} y2={y(ema21)} stroke="#60a5fa" strokeWidth="0.8" strokeDasharray="3,3" opacity="0.7" />}
      <line x1="0" y1={spotY} x2={W} y2={spotY} stroke="#f59e0b" strokeWidth="0.5" strokeDasharray="2,4" opacity="0.3" />
      <rect x={W - 52} y={spotY - 7} width={52} height={12} rx="2" fill="#f59e0b" opacity="0.9" />
      <text x={W - 26} y={spotY + 3.5} textAnchor="middle" fontSize="7" fill="#000" fontWeight="bold" fontFamily="monospace">
        {fmt(spot, 1)}
      </text>
    </svg>
  );
}

function TrendArrow({ dir }) {
  const cfg = {
    BULLISH: { icon: "▲", color: "text-emerald-400", bg: "bg-emerald-500/10" },
    BEARISH: { icon: "▼", color: "text-red-400",     bg: "bg-red-500/10" },
    NEUTRAL: { icon: "►", color: "text-amber-400",   bg: "bg-amber-500/10" },
  }[dir] || { icon: "?", color: "text-zinc-500", bg: "bg-zinc-800" };
  return <span className={`text-[10px] font-mono font-bold ${cfg.color} ${cfg.bg} px-1.5 py-0.5 rounded`}>{cfg.icon} {dir}</span>;
}

function GEXBar({ strike, call_gex, put_gex, net, maxAbs, spot }) {
  const pct = Math.abs(net) / (maxAbs || 1);
  const isCall = net > 0;
  const isNear = Math.abs(strike - spot) <= 80;
  return (
    <div className={`flex items-center gap-2 py-0.5 ${isNear ? "opacity-100" : "opacity-60"}`}>
      <span className={`text-[9px] font-mono w-14 text-right ${isNear ? "text-amber-400 font-bold" : "text-zinc-500"}`}>{fmt(strike)}</span>
      <div className="flex-1 h-2.5 bg-zinc-800 rounded-sm overflow-hidden">
        <div className={`h-full rounded-sm ${isCall ? "bg-emerald-500/70" : "bg-red-500/70"}`} style={{ width: `${pct * 100}%` }} />
      </div>
      <span className={`text-[9px] font-mono w-16 text-right ${isCall ? "text-emerald-400" : "text-red-400"}`}>{fmtM(net)}</span>
      {isNear && <span className="text-[7px] text-amber-500">◄</span>}
    </div>
  );
}

function SessionBox({ label, data, active }) {
  if (!data) return null;
  const biasColor = data.bias === "BULLISH" ? "text-emerald-400" : data.bias === "BEARISH" ? "text-red-400" : "text-amber-400";
  return (
    <div className={`rounded-lg p-2 border ${active ? "border-amber-500/50 bg-amber-500/5" : "border-zinc-800 bg-zinc-800/30"}`}>
      <div className="flex justify-between items-center mb-1">
        <span className={`text-[9px] font-mono font-bold ${active ? "text-amber-400" : "text-zinc-500"}`}>{label}</span>
        {active && <span className="text-[7px] bg-amber-500/20 text-amber-400 px-1 rounded font-mono">LIVE</span>}
      </div>
      <div className="text-[9px] text-zinc-400 font-mono">{fmt(data.low, 1)} – {fmt(data.high, 1)}</div>
      <div className="text-[8px] text-zinc-600">Range: {fmt(data.range, 1)}</div>
      <div className={`text-[8px] font-bold mt-0.5 ${biasColor}`}>{data.bias}</div>
    </div>
  );
}

function RSIGauge({ value = 50, label }) {
  const pct = value / 100;
  const color = value > 70 ? "#f87171" : value < 30 ? "#34d399" : "#f59e0b";
  return (
    <div className="text-center">
      <div className="relative w-10 h-5 mx-auto mb-0.5">
        <svg viewBox="0 0 40 20" className="w-full h-full">
          <path d="M4,18 A16,16 0 0,1 36,18" fill="none" stroke="#27272a" strokeWidth="3" strokeLinecap="round" />
          <path d="M4,18 A16,16 0 0,1 36,18" fill="none" stroke={color} strokeWidth="3" strokeLinecap="round"
            strokeDasharray={`${pct * 50.3} 50.3`} />
          <text x="20" y="18" textAnchor="middle" fontSize="7" fill={color} fontFamily="monospace" fontWeight="bold">{Math.round(value)}</text>
        </svg>
      </div>
      <div className="text-[8px] text-zinc-600">{label}</div>
    </div>
  );
}

const TABS = ["Overview", "GEX", "Trend", "COT", "Macro", "Risk"];

// ─── MAIN ─────────────────────────────────────────────────────────────────
export default function GoldTerminal() {
  const [d, setD] = useState(null);
  const [tab, setTab] = useState("Overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);

  const fetchData = async () => {
    try {
      const res = await fetch("http://localhost:5000/api/data");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setD(json);
      setLastUpdate(new Date());
      setError(null);
      setLoading(false);
    } catch (e) {
      setError("Nelze se připojit k backendu — běží server.py?");
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, 15000); // refresh každých 15s
    return () => clearInterval(id);
  }, []);

  if (loading) return (
    <div style={{ background: "#080809", minHeight: "100vh", fontFamily: "monospace" }}
      className="flex items-center justify-center text-amber-400 text-sm">
      <div className="text-center">
        <div className="text-2xl mb-2 animate-pulse">⟳</div>
        <div>Připojuji se k backendu...</div>
        <div className="text-zinc-600 text-xs mt-1">http://localhost:5000</div>
      </div>
    </div>
  );

  if (error) return (
    <div style={{ background: "#080809", minHeight: "100vh", fontFamily: "monospace" }}
      className="flex items-center justify-center text-red-400 text-sm p-8">
      <div className="text-center">
        <div className="text-2xl mb-2">⚠</div>
        <div>{error}</div>
        <div className="text-zinc-600 text-xs mt-2">Spusť: python server.py</div>
        <button onClick={fetchData} className="mt-4 px-4 py-2 bg-zinc-800 text-zinc-300 rounded text-xs">
          Zkusit znovu
        </button>
      </div>
    </div>
  );

  // ── Mapování dat z backendu ──────────────────────────────────────────────
  const spot        = d.spot ?? 0;
  const spotChange  = d.spot_change ?? 0;
  const spotChangePct = d.spot_change_pct ?? 0;
  const isPos       = spotChange >= 0;
  const tech        = d.technicals ?? {};
  const trend       = d.trend ?? {};
  const gex         = d.gex ?? {};
  const cot         = d.cot ?? {};
  const macro       = d.macro ?? {};
  const sessions    = d.sessions ?? {};
  const risk        = d.risk ?? {};
  const seasonal    = d.seasonal ?? [];
  const keyLevels   = d.key_levels ?? [];
  const priceHistory = d.price_history ?? [];
  const currentMonth = d.current_month ?? new Date().getMonth() + 1;

  const gexPos  = gex.regime === "POSITIVE";
  const cotBull = (cot.noncomm_long ?? 0) > (cot.noncomm_short ?? 0);
  const macroBull = (macro.dxy?.change ?? 0) < 0 && (macro.real_yield?.change ?? 0) < 0;
  const currSeas = seasonal[currentMonth - 1] ?? {};
  const seasBull = (currSeas.avg ?? 0) > 0;

  const bullCount = [
    gexPos, cotBull, macroBull, seasBull,
    trend.daily === "BULLISH",
    trend.intraday === "BULLISH"
  ].filter(Boolean).length;
  const overallBias  = bullCount >= 4 ? "BULLISH" : bullCount >= 3 ? "NEUTRAL" : "BEARISH";
  const biasColor    = overallBias === "BULLISH" ? "green" : overallBias === "NEUTRAL" ? "yellow" : "red";

  const maxGex = gex.top10?.length
    ? Math.max(...gex.top10.map(x => Math.abs(x.net ?? 0)))
    : 1;

  const elapsed = lastUpdate ? Math.floor((new Date() - lastUpdate) / 1000) : 0;
  const elapsedStr = elapsed < 60 ? `${elapsed}s` : `${Math.floor(elapsed / 60)}m`;

  return (
    <div style={{ fontFamily: "'IBM Plex Mono', 'Courier New', monospace", background: "#080809", minHeight: "100vh" }}
      className="text-zinc-100 select-none">

      {/* TOP BAR */}
      <div className="sticky top-0 z-50 border-b border-zinc-800/80 bg-zinc-950/95 backdrop-blur px-4 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-[9px] tracking-[0.3em] text-amber-500/80 uppercase font-mono">XAU/USD</span>
            <span className={`text-xl font-bold tracking-tight ${isPos ? "text-amber-400" : "text-red-400"}`}>
              ${fmt(spot, 2)}
            </span>
            <span className={`text-[11px] font-mono ${isPos ? "text-emerald-400" : "text-red-400"}`}>
              {sign(spotChange)}{fmt(spotChange, 2)} ({sign(spotChangePct)}{fmt(spotChangePct, 2)}%)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Badge label={overallBias} color={biasColor} />
            <span className="text-[8px] text-zinc-600 font-mono">{elapsedStr} · LIVE</span>
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          </div>
        </div>
        <div className="flex gap-4 mt-1.5 text-[9px] font-mono text-zinc-500">
          {[
            ["H", fmt(d.high_24h, 1), "text-emerald-400"],
            ["L", fmt(d.low_24h, 1), "text-red-400"],
            ["VWAP", fmt(d.vwap, 1), "text-sky-400"],
            ["ATR", fmt(tech.atr14, 1), "text-purple-400"],
            ["vs VWAP", `${sign(tech.price_vs_vwap)}${fmt(tech.price_vs_vwap, 1)}`,
              (tech.price_vs_vwap ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"],
          ].map(([k, v, c]) => (
            <span key={k}>{k}: <span className={`${c} font-bold`}>{v}</span></span>
          ))}
        </div>
      </div>

      {/* TABS */}
      <div className="flex border-b border-zinc-800/60 bg-zinc-950/80 sticky top-[72px] z-40">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-[9px] font-mono tracking-widest uppercase transition-all ${
              tab === t ? "text-amber-400 border-b-2 border-amber-500 bg-amber-500/5" : "text-zinc-600 hover:text-zinc-400"
            }`}>
            {t}
          </button>
        ))}
      </div>

      <div className="p-3 space-y-3">

        {/* ══ OVERVIEW ══ */}
        {tab === "Overview" && (
          <>
            <Card glow>
              <Sec>── Overall Bias Score</Sec>
              <div className="flex items-center gap-3 mb-3">
                <div className={`text-4xl font-bold ${overallBias === "BULLISH" ? "text-emerald-400" : overallBias === "NEUTRAL" ? "text-amber-400" : "text-red-400"}`}>
                  {bullCount}/6
                </div>
                <div>
                  <Badge label={overallBias} color={biasColor} />
                  <div className="text-[9px] text-zinc-500 mt-1">pilířů bullish</div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {[
                  ["GEX",       gexPos,                    gexPos ? "POSITIVE" : gex.regime],
                  ["COT",       cotBull,                   cotBull ? "BULLISH" : "BEARISH"],
                  ["Macro",     macroBull,                 macroBull ? "BULLISH" : "BEARISH"],
                  ["Seasonal",  seasBull,                  seasBull ? "BULLISH" : "BEARISH"],
                  ["Daily",     trend.daily === "BULLISH", trend.daily ?? "—"],
                  ["Intraday",  trend.intraday === "BULLISH", trend.intraday ?? "—"],
                ].map(([label, bull, val]) => (
                  <div key={label} className={`rounded-lg p-2 border ${bull ? "border-emerald-500/20 bg-emerald-500/5" : "border-red-500/20 bg-red-500/5"}`}>
                    <div className="text-[8px] text-zinc-500 mb-0.5">{label}</div>
                    <div className={`text-[9px] font-bold font-mono ${bull ? "text-emerald-400" : "text-red-400"}`}>{val}</div>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <Sec sub={`Current: ${sessions.current ?? "—"} · KZ: ${sessions.killzone_active ? "ACTIVE ⚡" : "inactive"}`}>
                ── Sessions & Killzones
              </Sec>
              <div className="grid grid-cols-3 gap-2">
                <SessionBox label="ASIAN"    data={sessions.asian}  active={sessions.current === "ASIAN"} />
                <SessionBox label="LONDON"   data={sessions.london} active={sessions.current === "LONDON"} />
                <SessionBox label="NEW YORK" data={sessions.ny}     active={sessions.current === "NY"} />
              </div>
              {sessions.killzone_active && (
                <div className="mt-2 text-[9px] bg-amber-500/10 border border-amber-500/20 rounded p-2 text-amber-400">
                  ⚡ Killzone Active — zvýšená pravděpodobnost setupů
                </div>
              )}
            </Card>

            <Card>
              <Sec sub="30 daily svíček · EMA8 (zelená) · EMA21 (modrá)">── Price Chart</Sec>
              <MiniPriceChart data={priceHistory} ema8={tech.ema8} ema21={tech.ema21} spot={spot} />
              <div className="flex gap-3 mt-1 text-[8px]">
                <span className="text-emerald-400">── EMA8: {fmt(tech.ema8, 1)}</span>
                <span className="text-sky-400">── EMA21: {fmt(tech.ema21, 1)}</span>
                <span className="text-zinc-500">── EMA50: {fmt(tech.ema50, 1)}</span>
              </div>
            </Card>

            <Card>
              <Sec>── Key Price Levels</Sec>
              <div className="space-y-0.5">
                {keyLevels.map((lvl, i) => {
                  const diff = lvl.price - spot;
                  const isSpot = lvl.type === "SPOT";
                  return (
                    <div key={i} className={`flex items-center gap-2 py-1 rounded px-1 ${isSpot ? "bg-amber-500/10 border border-amber-500/20" : ""}`}>
                      <span className={`text-[9px] font-mono w-4 font-bold ${
                        lvl.type === "R" ? "text-red-400" : lvl.type === "S" ? "text-emerald-400" :
                        lvl.type === "SPOT" ? "text-amber-400" : "text-sky-400"}`}>{lvl.type}</span>
                      <span className={`text-[10px] font-mono font-bold flex-1 ${isSpot ? "text-amber-400" : "text-zinc-300"}`}>
                        ${fmt(lvl.price, 1)}
                      </span>
                      <span className="text-[9px] text-zinc-500">{lvl.label}</span>
                      {!isSpot && (
                        <span className={`text-[9px] font-mono ${diff > 0 ? "text-red-400" : "text-emerald-400"}`}>
                          {sign(diff)}{fmt(diff, 1)}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          </>
        )}

        {/* ══ GEX ══ */}
        {tab === "GEX" && (
          <>
            <Card glow={gexPos}>
              <Sec sub="GLD Options proxy · 4 nejbližší expirace">── Gamma Exposure</Sec>
              {gex.regime === "UNKNOWN" ? (
                <div className="text-[10px] text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded p-3">
                  ⚠ Options data momentálně nedostupná (yfinance omezení).
                  GEX levely se načtou při příštím refreshi.
                  <div className="text-zinc-500 mt-1">Fallback levely: Call Wall ${fmt(gex.call_wall)} · Put Wall ${fmt(gex.put_wall)}</div>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-2 mb-4">
                    {[
                      { label: "Call Wall",  value: fmt(gex.call_wall),  color: "text-emerald-400" },
                      { label: "Put Wall",   value: fmt(gex.put_wall),   color: "text-red-400" },
                      { label: "Gamma Flip", value: fmt(gex.gamma_flip), color: "text-amber-400" },
                      { label: "HVL",        value: fmt(gex.hvl),        color: "text-sky-400" },
                      { label: "Max Pain",   value: fmt(gex.max_pain),   color: "text-purple-400" },
                      { label: "Net GEX",    value: fmtM(gex.net_gex),  color: gexPos ? "text-emerald-400" : "text-red-400" },
                    ].map(item => (
                      <div key={item.label} className="bg-zinc-800/50 rounded-lg p-2">
                        <div className="text-[8px] text-zinc-500 mb-0.5">{item.label}</div>
                        <div className={`text-sm font-bold font-mono ${item.color}`}>{item.value}</div>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-0.5">
                    {(gex.top10 ?? []).sort((a, b) => b.strike - a.strike).map((item, i) => (
                      <GEXBar key={i} {...item} maxAbs={maxGex} spot={spot} />
                    ))}
                  </div>
                </>
              )}
              <div className="mt-3 pt-3 border-t border-zinc-800 text-[9px] text-zinc-500">
                Expected Move: <span className="text-zinc-300">${fmt(gex.expected_move_low)} – ${fmt(gex.expected_move_high)}</span>
              </div>
              <div className={`mt-2 text-[9px] rounded p-2 border ${gexPos
                ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20"
                : "bg-amber-500/10 text-amber-400 border-amber-500/20"}`}>
                {gexPos
                  ? "► POSITIVE GAMMA: MM buy dips & sell rallies → mean reversion favored"
                  : "► Gamma regime nejistý — sleduj cenu vs. Gamma Flip level"}
              </div>
            </Card>

            <Card>
              <Sec>── Jak použít GEX levely</Sec>
              <div className="space-y-2 text-[9px] text-zinc-400">
                {[
                  ["Call Wall " + fmt(gex.call_wall), "Silná resistance. MM prodávají jak cena stoupá → odraz nebo zpomalení.", "text-emerald-400"],
                  ["Put Wall " + fmt(gex.put_wall), "Silný support. MM nakupují jak cena klesá → podlaha.", "text-red-400"],
                  ["Gamma Flip " + fmt(gex.gamma_flip), "Klíčový level. Nad ním = mean reversion. Pod ním = trendy pohyby.", "text-amber-400"],
                ].map(([title, desc, c]) => (
                  <div key={title} className="border-l-2 border-zinc-700 pl-2">
                    <div className={`font-bold font-mono mb-0.5 ${c}`}>{title}</div>
                    <div className="text-zinc-500">{desc}</div>
                  </div>
                ))}
              </div>
            </Card>
          </>
        )}

        {/* ══ TREND ══ */}
        {tab === "Trend" && (
          <>
            <Card glow>
              <Sec>── Multi-Timeframe Trend</Sec>
              <div className="space-y-1.5">
                {[
                  ["M5 Micro",    trend.micro,    "Scalp směr · tvůj M5"],
                  ["H1 Intraday", trend.intraday, "Intraday bias · primary filter"],
                  ["D1 Daily",    trend.daily,    "Swing struktura"],
                  ["W1 Weekly",   trend.weekly,   "Makro směr"],
                  ["MN Monthly",  trend.monthly,  "Long-term bias"],
                ].map(([label, val, sub]) => (
                  <div key={label} className="flex items-center justify-between py-1.5 border-b border-zinc-800/50 last:border-0">
                    <div>
                      <div className="text-[10px] font-mono text-zinc-300">{label}</div>
                      <div className="text-[8px] text-zinc-600">{sub}</div>
                    </div>
                    <TrendArrow dir={val ?? "NEUTRAL"} />
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <Sec>── RSI Multi-TF</Sec>
              <div className="flex justify-around py-2">
                <RSIGauge value={tech.rsi_h1} label="H1" />
                <RSIGauge value={tech.rsi_h4} label="H4" />
                <RSIGauge value={tech.rsi_d}  label="D1" />
              </div>
            </Card>

            <Card>
              <Sec sub="30 daily svíček">── Price Chart</Sec>
              <MiniPriceChart data={priceHistory} ema8={tech.ema8} ema21={tech.ema21} spot={spot} />
              <div className="space-y-1 mt-2">
                {[
                  ["EMA 8",   tech.ema8,   "text-emerald-400"],
                  ["EMA 21",  tech.ema21,  "text-sky-400"],
                  ["EMA 50",  tech.ema50,  "text-purple-400"],
                  ["EMA 200", tech.ema200, "text-red-400"],
                ].map(([label, val, c]) => {
                  const diff = spot - (val ?? spot);
                  return (
                    <div key={label} className="flex justify-between items-center text-[9px]">
                      <span className={`font-mono font-bold ${c}`}>{label}</span>
                      <span className="text-zinc-400 font-mono">{fmt(val, 1)}</span>
                      <span className={`font-mono ${diff > 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {sign(diff)}{fmt(diff, 1)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </Card>
          </>
        )}

        {/* ══ COT ══ */}
        {tab === "COT" && (
          <>
            <Card>
              <Sec sub={`CFTC · ${cot.source === "fallback" ? "⚠ záložní data" : "live"} · ${cot.date ?? "—"}`}>
                ── Commitment of Traders
              </Sec>
              {cot.source === "fallback" && (
                <div className="mb-3 text-[9px] bg-amber-500/10 border border-amber-500/20 rounded p-2 text-amber-400">
                  ⚠ CFTC server nedostupný — zobrazena poslední známá data
                </div>
              )}
              <div className="grid grid-cols-3 gap-2 mb-3">
                {[
                  { label: "Commercials",  long: cot.commercials_long,  short: cot.commercials_short,  sub: "Smart Money" },
                  { label: "Large Specs",  long: cot.noncomm_long,      short: cot.noncomm_short,      sub: "Spekulanti" },
                ].map(item => {
                  const net = (item.long ?? 0) - (item.short ?? 0);
                  return (
                    <div key={item.label} className="bg-zinc-800/50 rounded-lg p-2">
                      <div className="text-[8px] text-zinc-500 mb-0.5">{item.label}</div>
                      <div className={`text-sm font-bold font-mono ${net > 0 ? "text-emerald-400" : "text-red-400"}`}>
                        {fmtM(net)}
                      </div>
                      <div className="text-[8px] text-zinc-600">{item.sub}</div>
                    </div>
                  );
                })}
                <div className="bg-zinc-800/50 rounded-lg p-2">
                  <div className="text-[8px] text-zinc-500 mb-0.5">Sentiment</div>
                  <div className={`text-sm font-bold font-mono ${cotBull ? "text-emerald-400" : "text-red-400"}`}>
                    {cotBull ? "BULLISH" : "BEARISH"}
                  </div>
                </div>
              </div>
              <div className="space-y-2 text-[9px] text-zinc-400 border-t border-zinc-800 pt-3">
                {[
                  ["Commercials záporný", "Těžaři hedgují produkci — čím více shortují, tím vyšší reálná cena. Bullish pro gold."],
                  ["Large Specs kladný",  "Hedge fondy long — sleduj extremy, při přesycení hrozí reverz."],
                ].map(([title, desc]) => (
                  <div key={title} className="border-l-2 border-zinc-700 pl-2">
                    <div className="font-bold text-zinc-300 mb-0.5">{title}</div>
                    <div className="text-zinc-500">{desc}</div>
                  </div>
                ))}
              </div>
            </Card>
          </>
        )}

        {/* ══ MACRO ══ */}
        {tab === "Macro" && (
          <>
            <Card>
              <Sec>── Macro Drivers</Sec>
              {[
                { label: "Real Yield 10Y", val: macro.real_yield, unit: "%", inv: true,  sub: "Neg. korelace −0.82" },
                { label: "DXY",            val: macro.dxy,        unit: "",  inv: true,  sub: "Neg. korelace −0.78" },
                { label: "VIX",            val: macro.vix,        unit: "",  inv: false, sub: "Safe-haven demand" },
                { label: "SPX",            val: macro.spx,        unit: "",  inv: false, sub: "Risk sentiment" },
                { label: "Oil (WTI)",      val: macro.oil,        unit: "$", inv: false, sub: "Inflation proxy" },
                { label: "BTC",            val: macro.btc,        unit: "$", inv: false, sub: "Risk-on proxy" },
              ].map(item => {
                if (!item.val) return null;
                const bull = item.inv ? item.val.change < 0 : item.val.change > 0;
                return (
                  <div key={item.label} className="flex items-center justify-between py-1.5 border-b border-zinc-800/50 last:border-0">
                    <div>
                      <div className="text-[10px] text-zinc-300">{item.label}</div>
                      <div className="text-[8px] text-zinc-600">{item.sub}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-mono font-bold text-zinc-200">
                        {item.unit}{fmt(item.val.value, item.unit === "%" ? 2 : item.unit === "$" && item.val.value > 1000 ? 0 : 2)}
                      </span>
                      <span className={`text-[9px] font-mono ${bull ? "text-emerald-400" : "text-red-400"}`}>
                        {item.val.change >= 0 ? "▲" : "▼"} {Math.abs(item.val.change).toFixed(2)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </Card>

            <Card>
              <Sec>── Seasonal (20Y průměr)</Sec>
              <div className="flex items-end gap-1 h-16 mb-2">
                {seasonal.map((m, i) => {
                  const maxAvg = Math.max(...seasonal.map(x => Math.abs(x.avg)));
                  const h = (Math.abs(m.avg) / maxAvg) * 100;
                  const isCurr = i + 1 === currentMonth;
                  return (
                    <div key={m.month} className="flex flex-col items-center flex-1 gap-0.5">
                      <div className={`w-full rounded-sm ${m.avg >= 0 ? "bg-emerald-500/60" : "bg-red-500/60"} ${isCurr ? "ring-1 ring-amber-400" : ""}`}
                        style={{ height: `${Math.max(h, 8)}%` }} />
                      <span className={`text-[7px] font-mono ${isCurr ? "text-amber-400 font-bold" : "text-zinc-600"}`}>{m.month}</span>
                    </div>
                  );
                })}
              </div>
              <KV label="Aktuální měsíc" value={`${sign(currSeas.avg ?? 0)}${currSeas.avg ?? 0}%`}
                valueClass={(currSeas.avg ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"} />
              <KV label="% pozitivních let" value={`${currSeas.positive ?? "—"}%`} />
            </Card>
          </>
        )}

        {/* ══ RISK ══ */}
        {tab === "Risk" && (
          <>
            <Card glow>
              <Sec sub={`ATR(14) = $${fmt(risk.atr_daily, 1)}`}>── Risk Kalkulátor</Sec>
              <div className="grid grid-cols-2 gap-2 mb-3">
                {[
                  { label: "Doporučený SL", value: `$${fmt(risk.suggested_sl, 1)}`, sub: "0.5× ATR", color: "text-red-400" },
                  { label: "TP1 (1:1)",     value: `$${fmt(risk.suggested_tp1, 1)}`, sub: "1× ATR",   color: "text-emerald-400" },
                  { label: "TP2 (1:2)",     value: `$${fmt(risk.suggested_tp2, 1)}`, sub: "2× ATR",   color: "text-emerald-400" },
                  { label: "RR Ratio",      value: `1:${fmt(risk.rr, 1)}`,           sub: "min 1:2",   color: "text-amber-400" },
                ].map(item => (
                  <div key={item.label} className="bg-zinc-800/50 rounded-lg p-2">
                    <div className="text-[8px] text-zinc-500 mb-0.5">{item.label}</div>
                    <div className={`text-lg font-bold font-mono ${item.color}`}>{item.value}</div>
                    <div className="text-[8px] text-zinc-600">{item.sub}</div>
                  </div>
                ))}
              </div>
              <KV label="Lot size ($150 SL)" value={`${risk.lot_for_150} lot`} valueClass="text-amber-400" />
            </Card>

            <Card>
              <Sec>── Equity Edge Pravidla</Sec>
              {[
                ["Daily Loss Limit", "3% ($150)",          "text-red-400"],
                ["Max Trailing DD",  "5% ($250)",          "text-red-400"],
                ["Profit Target",    "8% ($400)",          "text-emerald-400"],
                ["Anti-Scalping",    "Avg. trade > 2 min", "text-amber-400"],
                ["News Rule",        "±2 min High Impact", "text-amber-400"],
              ].map(([k, v, c]) => <KV key={k} label={k} value={v} valueClass={c} />)}
            </Card>

            <Card>
              <Sec>── Pre-Trade Checklist</Sec>
              <div className="space-y-1 text-[9px]">
                {[
                  "Jsem v killzone (London 07-10 / NY 13-16 UTC)?",
                  "Trend H1 a D1 ve směru tradu?",
                  "Z-score signál potvrzen?",
                  "SL za strukturou?",
                  "Žádný High Impact news v ±2 min?",
                  "Denní loss limit pod 50%?",
                  "Nejde o revenge trade?",
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-2 py-1 border-b border-zinc-800/40 last:border-0">
                    <div className="w-3 h-3 rounded border border-zinc-600 flex-shrink-0" />
                    <span className="text-zinc-400">{item}</span>
                  </div>
                ))}
              </div>
            </Card>
          </>
        )}
      </div>

      <div className="px-4 py-3 border-t border-zinc-800/50 text-[8px] text-zinc-700 font-mono flex justify-between">
        <span>LIVE · yfinance + CFTC + FRED · refresh 15s</span>
        <span>Gold Terminal v3.0 · {new Date().toLocaleDateString("cs-CZ")}</span>
      </div>
    </div>
  );
}
