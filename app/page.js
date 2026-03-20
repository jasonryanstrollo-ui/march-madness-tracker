"use client";
import { useState, useEffect, useCallback, useRef } from "react";

const POLL = 30000;
const SPREAD_THRESH = 5;
const MIN_ELAPSED = 5;
const RUN_THRESH = 0.75;
const LINE_MOVE_THRESH = 5.5;
const FONTS = {
  sans: "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  mono: "'JetBrains Mono', 'SFMono-Regular', Consolas, monospace",
};

const SL = { inprogress: "LIVE", scheduled: "UPCOMING", closed: "FINAL", halftime: "HALF" };
const SC = { inprogress: "#EF4444", halftime: "#F59E0B", scheduled: "#22C55E", closed: "#6B7280" };

// Alert 1: favorite underperforming opening spread by 5+ pts after 5 min
function isSpreadAlert(g) {
  return (g.status === "inprogress" || g.status === "halftime") &&
    g.elapsedMinutes >= MIN_ELAPSED && g.spreadUnderperformance != null && g.spreadUnderperformance > SPREAD_THRESH;
}
// Alert 2: spread alert AND a team has 75%+ of last 15 pts simultaneously
function isSpreadAndRun(g) {
  return isSpreadAlert(g) && hasRun(g);
}
function hasRun(g) {
  if (!g.scoringRun?.totalRunPts) return false;
  const { homeRunPts: h, awayRunPts: a, totalRunPts: t } = g.scoringRun;
  return h / t >= RUN_THRESH || a / t >= RUN_THRESH;
}
function runTeam(g) {
  if (!g.scoringRun?.totalRunPts) return null;
  const { homeRunPts: h, awayRunPts: a, totalRunPts: t } = g.scoringRun;
  if (h / t >= RUN_THRESH) return g.home;
  if (a / t >= RUN_THRESH) return g.away;
  return null;
}
// Alert 3: underdog has 75%+ of last 12 pts AND live spread tightened 5.5+ pts vs open
function underdogRunTeam(g) {
  const run12 = g.scoringRun?.run12;
  if (!run12?.totalRunPts || !g.spreadFavoriteAbbr) return null;
  const udAbbr = g.spreadFavoriteAbbr === g.home ? g.away : g.home;
  const udPts = udAbbr === g.home ? run12.homeRunPts : run12.awayRunPts;
  return udPts / run12.totalRunPts >= RUN_THRESH ? udAbbr : null;
}
function isUnderdogRunAlert(g) {
  if (g.status !== "inprogress" && g.status !== "halftime") return false;
  if (!underdogRunTeam(g)) return false;
  const lo = g.liveOdds;
  if (!lo?.liveSpread || !lo.isLive || g.openSpread == null) return false;
  // Normalize live spread to original favorite's perspective then compute signed shift
  const rawVal = Number(lo.liveSpread);
  const liveFav = lo.details
    ? (lo.details.match(/^([A-Z]+)/)?.[1] ?? (rawVal < 0 ? g.home : g.away))
    : (rawVal < 0 ? g.home : g.away);
  const normalizedLive = liveFav === g.spreadFavoriteAbbr ? rawVal : -rawVal;
  const divergence = normalizedLive - Number(g.openSpread);
  // Positive divergence = line moved against the favorite by that many points
  return divergence > LINE_MOVE_THRESH;
}
function isPocketOpen(g) {
  return isSpreadAndRun(g) || isUnderdogRunAlert(g);
}

const CSS = `
@keyframes drift{0%,100%{transform:translate3d(0,0,0) scale(1)}50%{transform:translate3d(0,10px,0) scale(1.04)}}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
@keyframes glow{0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,0)}50%{box-shadow:0 0 16px 2px rgba(239,68,68,.15)}}
@keyframes glowCombo{0%,100%{box-shadow:0 0 0 0 rgba(245,158,11,0)}50%{box-shadow:0 0 18px 3px rgba(245,158,11,.18)}}
@keyframes glowPurple{0%,100%{box-shadow:0 0 0 0 rgba(167,139,250,0)}50%{box-shadow:0 0 16px 2px rgba(167,139,250,.18)}}
@keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
@keyframes spin{to{transform:rotate(360deg)}}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html{background:
radial-gradient(circle at top left, rgba(14,165,233,.16), transparent 32%),
radial-gradient(circle at top right, rgba(168,85,247,.14), transparent 28%),
linear-gradient(180deg, #09111d 0%, #050912 52%, #04070e 100%)}
body{overscroll-behavior:none;margin:0;font-family:${FONTS.sans};background:transparent;color:#fff}
button{font:inherit}
.hide-scrollbar{scrollbar-width:none;-ms-overflow-style:none}
.hide-scrollbar::-webkit-scrollbar{display:none}
`;

function Momentum({ pts, total }) {
  if (!total) return null;
  const pct = (pts / total) * 100;
  const hot = pct >= 75;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <div style={{ width: 32, height: 3, borderRadius: 2, background: "rgba(255,255,255,.08)", overflow: "hidden" }}>
        <div style={{
          height: "100%", width: `${Math.min(pct, 100)}%`, borderRadius: 2,
          background: hot ? "#F59E0B" : pct >= 50 ? "#22C55E" : "rgba(255,255,255,.12)",
          transition: "width .5s",
        }} />
      </div>
      <span style={{ fontSize: 9, fontWeight: 600, color: hot ? "#F59E0B" : "rgba(255,255,255,.25)", fontFamily: FONTS.mono }}>{pts}</span>
    </div>
  );
}

function OddsChip({ label, value, sub, alert }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      padding: "4px 8px", borderRadius: 6,
      background: alert ? "rgba(239,68,68,.1)" : "rgba(255,255,255,.05)",
      border: alert ? "1px solid rgba(239,68,68,.22)" : "1px solid rgba(255,255,255,.08)",
      minWidth: 56,
      boxShadow: "inset 0 1px 0 rgba(255,255,255,.05)",
      backdropFilter: "blur(14px)",
    }}>
      <span style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,.3)", letterSpacing: ".05em", textTransform: "uppercase", fontFamily: FONTS.mono }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: alert ? "#EF4444" : "#fff", fontFamily: FONTS.mono, marginTop: 1 }}>{value}</span>
      {sub && <span style={{ fontSize: 8, color: alert ? "#F87171" : "rgba(255,255,255,.25)", fontFamily: FONTS.mono, marginTop: 1 }}>{sub}</span>}
    </div>
  );
}

function tonePalette(tone = "neutral") {
  return {
    neutral: { accent: "#E5E7EB", bg: "rgba(148,163,184,.08)", border: "rgba(148,163,184,.18)" },
    live: { accent: "#86EFAC", bg: "rgba(34,197,94,.12)", border: "rgba(34,197,94,.25)" },
    combo: { accent: "#FCD34D", bg: "rgba(245,158,11,.12)", border: "rgba(245,158,11,.24)" },
    spread: { accent: "#FCA5A5", bg: "rgba(239,68,68,.12)", border: "rgba(239,68,68,.24)" },
    run: { accent: "#7DD3FC", bg: "rgba(56,189,248,.12)", border: "rgba(56,189,248,.24)" },
    pocket: { accent: "#D8B4FE", bg: "rgba(168,85,247,.12)", border: "rgba(168,85,247,.26)" },
    ncaa: { accent: "#FDE68A", bg: "rgba(245,158,11,.12)", border: "rgba(245,158,11,.24)" },
  }[tone] || { accent: "#E5E7EB", bg: "rgba(148,163,184,.08)", border: "rgba(148,163,184,.18)" };
}

function HeroStat({ label, value, tone = "neutral" }) {
  const palette = tonePalette(tone);
  return (
    <div style={{
      minWidth: 94,
      padding: "10px 12px",
      borderRadius: 16,
      background: "linear-gradient(180deg, rgba(255,255,255,.07), rgba(255,255,255,.02))",
      border: `1px solid ${palette.border}`,
      boxShadow: "inset 0 1px 0 rgba(255,255,255,.05)",
      backdropFilter: "blur(18px)",
    }}>
      <div style={{ fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: "rgba(255,255,255,.45)", fontFamily: FONTS.mono }}>
        {label}
      </div>
      <div style={{ marginTop: 6, fontSize: 22, fontWeight: 800, color: palette.accent, letterSpacing: "-.04em" }}>
        {value}
      </div>
    </div>
  );
}

function SummaryTile({ icon, title, sub, tone = "neutral" }) {
  const palette = tonePalette(tone);
  return (
    <div style={{
      flex: 1,
      minWidth: 120,
      padding: "10px 12px",
      borderRadius: 18,
      background: "linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.025))",
      border: `1px solid ${palette.border}`,
      boxShadow: "0 18px 40px rgba(2,6,23,.18)",
      backdropFilter: "blur(18px)",
      display: "flex",
      alignItems: "center",
      gap: 10,
    }}>
      <div style={{
        width: 34,
        height: 34,
        borderRadius: 12,
        display: "grid",
        placeItems: "center",
        fontSize: 16,
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        flexShrink: 0,
      }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: palette.accent }}>{title}</div>
        <div style={{ fontSize: 10, color: "rgba(255,255,255,.42)", marginTop: 2 }}>{sub}</div>
      </div>
    </div>
  );
}

function FilterButton({ label, active, onClick, tone = "neutral" }) {
  const palette = tonePalette(tone);
  return (
    <button
      onClick={onClick}
      style={{
        background: active ? palette.bg : "rgba(255,255,255,.03)",
        border: active ? `1px solid ${palette.border}` : "1px solid rgba(255,255,255,.07)",
        borderRadius: 999,
        padding: "9px 14px",
        fontSize: 11,
        fontWeight: 700,
        color: active ? palette.accent : "rgba(255,255,255,.5)",
        cursor: "pointer",
        transition: "all .2s ease",
        whiteSpace: "nowrap",
        boxShadow: active ? "0 10px 24px rgba(2,6,23,.18)" : "none",
      }}
    >
      {label}
    </button>
  );
}

function GameCard({ g }) {
  const sa = isSpreadAlert(g);
  const ra = hasRun(g);
  const sara = isSpreadAndRun(g);
  const ura = isUnderdogRunAlert(g);
  const live = g.status === "inprogress" || g.status === "halftime";
  const hd = g.teams?.[g.home] || {};
  const ad = g.teams?.[g.away] || {};
  const hs = g.score?.[g.home];
  const as_ = g.score?.[g.away];
  const run = g.scoringRun;
  const rt = runTeam(g);
  const urt = underdogRunTeam(g);
  const lo = g.liveOdds;

  // Normalize live spread to always be quoted from the original favorite's perspective.
  // ESPN's lo.details / lo.liveSpread may flip the reference team mid-game.
  // e.g. if SMU opened -6.5 but ESPN now shows "MIA -7", we want "SMU +7".
  let normalizedLiveSpread = null;
  if (lo?.liveSpread != null) {
    const rawVal = Number(lo.liveSpread);
    if (g.spreadFavoriteAbbr) {
      const liveFav = lo.details
        ? (lo.details.match(/^([A-Z]+)/)?.[1] ?? (rawVal < 0 ? g.home : g.away))
        : (rawVal < 0 ? g.home : g.away);
      normalizedLiveSpread = liveFav === g.spreadFavoriteAbbr ? rawVal : -rawVal;
    } else {
      normalizedLiveSpread = rawVal;
    }
  }

  // Shift: score-based delta — how far the actual margin has moved from the opening line.
  // Uses actMargin (from favorite's POV) minus expMargin (abs of opening spread).
  // Positive = favorite outperforming the line; Negative = favorite falling behind it.
  // Does NOT depend on live odds, so it's always available for live games.
  const shift = live && g.actualMargin != null && g.expectedMargin != null
    ? g.actualMargin - g.expectedMargin
    : null;

  // Card style based on highest-priority alert
  const cardBg = sara
    ? "linear-gradient(180deg, rgba(245,158,11,.16), rgba(245,158,11,.06))"
    : sa
      ? "linear-gradient(180deg, rgba(239,68,68,.14), rgba(239,68,68,.05))"
      : ura
        ? "linear-gradient(180deg, rgba(168,85,247,.15), rgba(168,85,247,.05))"
        : "linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.025))";
  const cardBorder = sara ? "1px solid rgba(245,158,11,.28)" : sa ? "1px solid rgba(239,68,68,.24)" : ura ? "1px solid rgba(167,139,250,.26)" : "1px solid rgba(255,255,255,.08)";
  const cardAnim = sara ? "glowCombo 2.5s ease-in-out infinite, fadeIn .3s ease-out" : sa ? "glow 2.5s ease-in-out infinite, fadeIn .3s ease-out" : ura ? "glowPurple 2.5s ease-in-out infinite, fadeIn .3s ease-out" : "fadeIn .3s ease-out";
  const cardTopGlow = sara ? "rgba(245,158,11,.75)" : sa ? "rgba(239,68,68,.7)" : ura ? "rgba(167,139,250,.72)" : "rgba(125,211,252,.45)";

  return (
    <div style={{
      position: "relative", overflow: "hidden",
      background: cardBg, border: cardBorder, borderRadius: 18, padding: "14px 14px 13px",
      boxShadow: "0 20px 50px rgba(2,6,23,.22), inset 0 1px 0 rgba(255,255,255,.05)",
      backdropFilter: "blur(18px)",
      animation: cardAnim, transition: "all .3s",
    }}>
      <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg, rgba(255,255,255,.08), transparent 38%)", pointerEvents: "none" }} />
      <div style={{ position: "absolute", top: 0, left: 16, right: 16, height: 1, background: `linear-gradient(90deg, transparent, ${cardTopGlow}, transparent)` }} />
      <div style={{ position: "relative", zIndex: 1 }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ position: "relative" }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: SC[g.status] || "#6B7280", animation: live ? "pulse 1.5s infinite" : "none", boxShadow: `0 0 12px ${SC[g.status] || "#6B7280"}` }} />
          </div>
          <span style={{ fontSize: 10, fontWeight: 700, color: SC[g.status] || "#6B7280", fontFamily: FONTS.mono, letterSpacing: ".08em" }}>
            {SL[g.status] || g.status}
          </span>
          {live && g.statusDetail && (
            <span style={{ fontSize: 10, color: "rgba(255,255,255,.34)", fontFamily: FONTS.mono }}>{g.statusDetail}</span>
          )}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {ra && <span style={{ fontSize: 8, fontWeight: 800, color: "#F59E0B", background: "rgba(245,158,11,.1)", border: "1px solid rgba(245,158,11,.2)", borderRadius: 10, padding: "2px 6px", fontFamily: "monospace" }}>🔥 {rt}</span>}
          {sa && <span style={{ fontSize: 8, fontWeight: 800, color: "#EF4444", background: "rgba(239,68,68,.1)", border: "1px solid rgba(239,68,68,.2)", borderRadius: 10, padding: "2px 6px", fontFamily: "monospace" }}>{g.spreadUnderperformance.toFixed(1)} OFF</span>}
          {ura && <span style={{ fontSize: 8, fontWeight: 800, color: "#A78BFA", background: "rgba(167,139,250,.1)", border: "1px solid rgba(167,139,250,.2)", borderRadius: 10, padding: "2px 6px", fontFamily: "monospace" }}>🍆 {urt}</span>}
        </div>
      </div>

      {/* Teams */}
      {[{ abbr: g.away, d: ad, s: as_, opp: hs, isFav: g.spreadFavoriteAbbr === g.away, runPts: run?.awayRunPts ?? 0, isRt: rt === g.away },
        { abbr: g.home, d: hd, s: hs, opp: as_, isFav: g.spreadFavoriteAbbr === g.home, runPts: run?.homeRunPts ?? 0, isRt: rt === g.home }]
        .map((t, i) => (
          <div key={t.abbr}>
            {i === 1 && <div style={{ height: 1, background: "rgba(255,255,255,.04)", margin: "3px 0" }} />}
            <div style={{ display: "flex", alignItems: "center", padding: "3px 0" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
                {t.d.logo ? (
                  <div style={{ width: 30, height: 30, borderRadius: 10, background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.08)", display: "grid", placeItems: "center", boxShadow: "inset 0 1px 0 rgba(255,255,255,.05)" }}>
                    <img src={t.d.logo} alt="" style={{ width: 20, height: 20, objectFit: "contain", borderRadius: 3, opacity: t.s > t.opp && live ? 1 : .7 }} />
                  </div>
                ) : <div style={{ width: 30, height: 30, borderRadius: 10, background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.08)" }} />}
                {t.d.seed && t.d.seed <= 16 && (
                  <span style={{ fontSize: 9, fontWeight: 800, color: "rgba(255,255,255,.34)", fontFamily: FONTS.mono, width: 16, textAlign: "center" }}>{t.d.seed}</span>
                )}
                <span style={{
                  fontSize: 14, fontWeight: t.s > t.opp && live ? 700 : 500,
                  color: t.s > t.opp && live ? "#fff" : "rgba(255,255,255,.72)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>{t.d.name || t.abbr}</span>
                {t.isFav && g.spreadFavoriteAbbr && (
                  <span style={{ fontSize: 7, fontWeight: 800, color: "#FBBF24", background: "rgba(251,191,36,.12)", border: "1px solid rgba(251,191,36,.18)", borderRadius: 999, padding: "2px 5px", fontFamily: FONTS.mono }}>FAV</span>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {live && run?.totalRunPts > 0 && <Momentum pts={t.runPts} total={run.totalRunPts} />}
                <span style={{
                  fontSize: 22, fontWeight: 800, fontFamily: FONTS.mono, minWidth: 32, textAlign: "right", letterSpacing: "-.04em",
                  color: t.s > t.opp && live ? "#fff" : g.status !== "scheduled" ? "rgba(255,255,255,.4)" : "rgba(255,255,255,.1)",
                }}>{g.status !== "scheduled" ? t.s : "–"}</span>
              </div>
            </div>
          </div>
        ))}

      {/* Odds row */}
      {(g.openSpread !== null || lo) && (
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          {g.openSpread !== null && g.spreadFavoriteAbbr && (
            <OddsChip label="Open" value={`${g.spreadFavoriteAbbr} ${Number(g.openSpread) > 0 ? "+" : ""}${Number(g.openSpread).toFixed(1)}`} />
          )}
          {normalizedLiveSpread !== null && lo.isLive && (
            <OddsChip
              label="Live"
              value={`${g.spreadFavoriteAbbr || (normalizedLiveSpread < 0 ? g.home : g.away)} ${normalizedLiveSpread > 0 ? "+" : ""}${normalizedLiveSpread.toFixed(1)}`}
              sub={lo.liveSpreadHome ? `H ${lo.liveSpreadHome}` : lo.liveSpreadAway ? `A ${lo.liveSpreadAway}` : null}
            />
          )}
          {sa && g.spreadUnderperformance != null && (
            <OddsChip label="vs Spread" value={`-${Number(g.spreadUnderperformance).toFixed(1)}`} alert={true} sub="underperforming" />
          )}
        </div>
      )}

      {/* Scheduled time */}
      {g.status === "scheduled" && (
        <div style={{ marginTop: 8, fontSize: 10, color: "rgba(255,255,255,.3)", fontFamily: FONTS.mono }}>{g.local_start}</div>
      )}

      {/* Early game note */}
      {live && g.expectedMargin !== null && g.elapsedMinutes < MIN_ELAPSED && (
        <div style={{ marginTop: 6, fontSize: 9, color: "rgba(255,255,255,.22)", fontFamily: FONTS.mono, fontStyle: "italic" }}>
          Spread tracking starts at 5:00
        </div>
      )}
      </div>
    </div>
  );
}

export default function Home() {
  const [games, setGames] = useState([]);
  const [last, setLast] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [filter, setFilter] = useState("all");
  const [ncaa, setNcaa] = useState(false);
  const ref = useRef(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/scores", { cache: "no-store" });
      if (!r.ok) throw new Error(`${r.status}`);
      const d = await r.json();
      setGames(d.games || []);
      setLast(new Date());
      setErr(null);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); ref.current = setInterval(load, POLL); return () => clearInterval(ref.current); }, [load]);

  const filtered = games
    .filter((g) => {
      if (ncaa && !g.isMarchMadness) return false;
      if (filter === "live") return g.status === "inprogress" || g.status === "halftime";
      if (filter === "spread") return isSpreadAlert(g);
      if (filter === "runs") return hasRun(g);
      if (filter === "upset") return isPocketOpen(g);
      return true;
    })
    .sort((a, b) => {
      // Priority: combo (spread+run) > spread only > underdog run alert > run only > live > rest
      const combo = (g) => isSpreadAndRun(g) ? 0 : isSpreadAlert(g) ? 1 : isUnderdogRunAlert(g) ? 2 : hasRun(g) ? 3 : 4;
      const ca = combo(a), cb = combo(b);
      if (ca !== cb) return ca - cb;
      const o = { inprogress: 0, halftime: 1, scheduled: 2, closed: 3 };
      return (o[a.status] ?? 4) - (o[b.status] ?? 4);
    });

  const sc = games.filter(isSpreadAlert).length;
  const sarac = games.filter(isSpreadAndRun).length;
  const rc = games.filter(hasRun).length;
  const urac = games.filter(isPocketOpen).length;
  const lc = games.filter((g) => g.status === "inprogress" || g.status === "halftime").length;
  const refreshStamp = last && !err
    ? last.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;
  const Pill = () => null;

  return (
    <div style={{ minHeight: "100dvh", color: "#fff" }}>
      <style>{CSS}</style>
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
        <div style={{ position: "absolute", top: -120, left: -60, width: 260, height: 260, borderRadius: "50%", background: "rgba(56,189,248,.14)", filter: "blur(22px)", animation: "drift 18s ease-in-out infinite" }} />
        <div style={{ position: "absolute", top: 90, right: -80, width: 240, height: 240, borderRadius: "50%", background: "rgba(168,85,247,.16)", filter: "blur(28px)", animation: "drift 22s ease-in-out infinite" }} />
        <div style={{ position: "absolute", bottom: -120, left: "18%", width: 280, height: 280, borderRadius: "50%", background: "rgba(245,158,11,.1)", filter: "blur(34px)", animation: "drift 24s ease-in-out infinite" }} />
      </div>

      <div style={{ position: "relative", maxWidth: 560, margin: "0 auto", padding: "18px 14px calc(26px + env(safe-area-inset-bottom))" }}>
        <div style={{ position: "relative", marginBottom: 18, padding: "18px 18px 16px", borderRadius: 26, overflow: "hidden", background: "linear-gradient(160deg, rgba(9,18,33,.92), rgba(7,11,20,.82))", border: "1px solid rgba(148,163,184,.16)", boxShadow: "0 28px 80px rgba(2,6,23,.35)" }}>
          <div style={{ position: "absolute", inset: 0, background: "linear-gradient(135deg, rgba(125,211,252,.08), transparent 38%, rgba(168,85,247,.08))", pointerEvents: "none" }} />
          <div style={{ position: "relative", zIndex: 1 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <div>
                <div style={{ fontSize: 10, letterSpacing: ".16em", textTransform: "uppercase", color: "rgba(255,255,255,.45)", fontFamily: FONTS.mono }}>
                  Tournament Watch
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
                  <span style={{ fontSize: 30, fontWeight: 800, letterSpacing: "-.05em" }}>March Madness</span>
                  <span style={{ padding: "5px 10px", borderRadius: 999, background: "rgba(239,68,68,.12)", border: "1px solid rgba(239,68,68,.2)", color: "#FCA5A5", fontSize: 10, fontWeight: 700, letterSpacing: ".12em", fontFamily: FONTS.mono }}>
                    LIVE BOARD
                  </span>
                </div>
                <div style={{ marginTop: 8, maxWidth: 360, fontSize: 14, lineHeight: 1.45, color: "rgba(255,255,255,.64)" }}>
                  Premium live tracking for spread misses, momentum swings, and Pocket Open spots.
                </div>
              </div>
              <div style={{ padding: "8px 10px", borderRadius: 16, background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.08)", fontSize: 10, color: err ? "#FCA5A5" : "rgba(255,255,255,.72)", fontFamily: FONTS.mono, whiteSpace: "nowrap" }}>
                {err ? "Feed issue" : "30s refresh"}
              </div>
            </div>

            <div className="hide-scrollbar" style={{ display: "flex", gap: 8, overflowX: "auto", marginTop: 16, paddingBottom: 2 }}>
              <HeroStat label="Live" value={lc} tone="live" />
              <HeroStat label="Combo" value={sarac} tone="combo" />
              <HeroStat label="Pocket" value={urac} tone="pocket" />
              <HeroStat label="Board" value={games.length} tone="neutral" />
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, fontSize: 11, color: "rgba(255,255,255,.48)", fontFamily: FONTS.mono }}>
              <div style={{ width: 7, height: 7, borderRadius: "50%", background: err ? "#EF4444" : "#22C55E", animation: err ? "none" : "pulse 2s infinite", boxShadow: `0 0 14px ${err ? "#EF4444" : "#22C55E"}` }} />
              <span>{err ? "Data feed error" : `${lc} live / ${games.length} total`}</span>
              {refreshStamp && <span>Updated {refreshStamp}</span>}
            </div>
          </div>
        </div>
        {/* Header */}
        <div style={{ display: "none" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-.02em" }}>March Madness</span>
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: ".1em", color: "#EF4444", fontFamily: "monospace" }}>LIVE</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4, fontSize: 10, color: "rgba(255,255,255,.25)", fontFamily: "monospace" }}>
            <div style={{ width: 5, height: 5, borderRadius: "50%", background: err ? "#EF4444" : "#22C55E", animation: err ? "none" : "pulse 2s infinite" }} />
            {err ? "ERROR" : `${lc} live · ${games.length} games`}
            {last && !err && <span>· {last.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>}
          </div>
        </div>

        {(sc > 0 || rc > 0 || urac > 0) && (
          <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
            {sarac > 0 && <SummaryTile icon="🚨🔥" title={`${sarac} Combo Alert${sarac > 1 ? "s" : ""}`} sub="Spread miss plus live run" tone="combo" />}
            {sc > 0 && <SummaryTile icon="🚨" title={`${sc} Spread Alert${sc > 1 ? "s" : ""}`} sub="Favorite is 5+ off the line" tone="spread" />}
            {rc > 0 && <SummaryTile icon="🔥" title={`${rc} Run${rc > 1 ? "s" : ""}`} sub="75%+ of the last 15 points" tone="run" />}
            {urac > 0 && <SummaryTile icon="🍆" title={`${urac} Pocket Open${urac > 1 ? "s" : ""}`} sub="Includes combo alerts" tone="pocket" />}
          </div>
        )}

        {/* Alert summary */}
        {(sc > 0 || rc > 0 || urac > 0) && (
          <div style={{ display: "none" }}>
            {sarac > 0 && (
              <div style={{ flex: 1, minWidth: 120, background: "rgba(245,158,11,.07)", border: "1px solid rgba(245,158,11,.2)", borderRadius: 10, padding: "8px 12px", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 16 }}>🚨🔥</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#FCD34D" }}>{sarac} Combo Alert{sarac > 1 ? "s" : ""}</div>
                  <div style={{ fontSize: 9, color: "rgba(255,255,255,.3)", marginTop: 1 }}>Spread + active run</div>
                </div>
              </div>
            )}
            {sc > 0 && (
              <div style={{ flex: 1, minWidth: 120, background: "rgba(239,68,68,.06)", border: "1px solid rgba(239,68,68,.15)", borderRadius: 10, padding: "8px 12px", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 16 }}>🚨</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#F87171" }}>{sc} Spread Alert{sc > 1 ? "s" : ""}</div>
                  <div style={{ fontSize: 9, color: "rgba(255,255,255,.3)", marginTop: 1 }}>5+ pts behind line</div>
                </div>
              </div>
            )}
            {rc > 0 && (
              <div style={{ flex: 1, minWidth: 120, background: "rgba(245,158,11,.06)", border: "1px solid rgba(245,158,11,.15)", borderRadius: 10, padding: "8px 12px", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 16 }}>🔥</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#FBBF24" }}>{rc} Run{rc > 1 ? "s" : ""}</div>
                  <div style={{ fontSize: 9, color: "rgba(255,255,255,.3)", marginTop: 1 }}>75%+ of last 15 pts</div>
                </div>
              </div>
            )}
            {urac > 0 && (
              <div style={{ flex: 1, minWidth: 120, background: "rgba(167,139,250,.06)", border: "1px solid rgba(167,139,250,.18)", borderRadius: 10, padding: "8px 12px", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 16 }}>🍆</span>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#C4B5FD" }}>{urac} Pocket Open{urac > 1 ? "s" : ""}</div>
                  <div style={{ fontSize: 9, color: "rgba(255,255,255,.3)", marginTop: 1 }}>Includes combo alerts</div>
                </div>
              </div>
            )}
          </div>
        )}

        <div className="hide-scrollbar" style={{ display: "flex", gap: 8, marginBottom: 16, overflowX: "auto", paddingBottom: 2 }}>
          <FilterButton label={`All ${games.length}`} active={filter === "all"} onClick={() => setFilter("all")} />
          <FilterButton label={`Live ${lc}`} active={filter === "live"} onClick={() => setFilter("live")} tone="live" />
          <FilterButton label={`Spread${sc ? ` ${sc}` : ""}`} active={filter === "spread"} onClick={() => setFilter("spread")} tone="spread" />
          <FilterButton label={`Runs${rc ? ` ${rc}` : ""}`} active={filter === "runs"} onClick={() => setFilter("runs")} tone="run" />
          <FilterButton label={`🍆 Pocket Open${urac ? ` ${urac}` : ""}`} active={filter === "upset"} onClick={() => setFilter((k) => (k === "upset" ? "all" : "upset"))} tone="pocket" />
          <FilterButton label="🏆 NCAA" active={ncaa} onClick={() => setNcaa((v) => !v)} tone="ncaa" />
        </div>

        {/* Filters */}
        <div style={{ display: "none" }}>
          <Pill k="all" label={`All ${games.length}`} active={filter === "all"} />
          <Pill k="live" label={`Live ${lc}`} active={filter === "live"} />
          <Pill k="spread" label={`Spread${sc ? ` ${sc}` : ""}`} active={filter === "spread"} />
          <Pill k="runs" label={`Runs${rc ? ` ${rc}` : ""}`} active={filter === "runs"} />
          <button onClick={() => setFilter(k => k === "upset" ? "all" : "upset")} style={{
            background: filter === "upset" ? "rgba(167,139,250,.12)" : "transparent",
            border: filter === "upset" ? "1px solid rgba(167,139,250,.3)" : "1px solid rgba(255,255,255,.05)",
            borderRadius: 8, padding: "6px 12px", fontSize: 11, fontWeight: 600,
            color: filter === "upset" ? "#C4B5FD" : "rgba(255,255,255,.35)",
            cursor: "pointer", transition: "all .15s", whiteSpace: "nowrap", fontFamily: "inherit",
          }}>🍆 Pocket Open{urac ? ` ${urac}` : ""}</button>
          <button onClick={() => setNcaa(v => !v)} style={{
            background: ncaa ? "rgba(245,158,11,.1)" : "transparent",
            border: ncaa ? "1px solid rgba(245,158,11,.25)" : "1px solid rgba(255,255,255,.05)",
            borderRadius: 8, padding: "6px 12px", fontSize: 11, fontWeight: 600,
            color: ncaa ? "#F59E0B" : "rgba(255,255,255,.35)",
            cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
          }}>🏆 NCAA</button>
        </div>

        {/* Content */}
        {loading ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 48 }}>
            <div style={{ width: 28, height: 28, border: "2px solid rgba(255,255,255,.06)", borderTopColor: "#EF4444", borderRadius: "50%", animation: "spin .7s linear infinite", marginBottom: 12 }} />
            <span style={{ fontSize: 11, color: "rgba(255,255,255,.25)" }}>Loading...</span>
          </div>
        ) : err ? (
          <div style={{ background: "rgba(239,68,68,.06)", border: "1px solid rgba(239,68,68,.15)", borderRadius: 10, padding: 14, textAlign: "center" }}>
            <p style={{ color: "#F87171", fontSize: 12, margin: "0 0 6px" }}>Error: {err}</p>
            <button onClick={load} style={{ background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.08)", borderRadius: 6, padding: "4px 12px", color: "#fff", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>Retry</button>
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: 40, color: "rgba(255,255,255,.2)", fontSize: 12 }}>
            {filter === "spread" ? "No spread alerts." : filter === "runs" ? "No scoring runs." : filter === "live" ? "No live games." : filter === "upset" ? "No pocket open alerts." : "No games today."}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {filtered.map((g) => <GameCard key={g.id} g={g} />)}
          </div>
        )}

        {/* Footer */}
        <div style={{ marginTop: 24, paddingTop: 14, borderTop: "1px solid rgba(255,255,255,.03)", textAlign: "center", fontSize: 9, color: "rgba(255,255,255,.12)", fontFamily: "monospace", lineHeight: 1.7 }}>
          ESPN scores + odds · Play-by-play momentum · 30s refresh
        </div>
      </div>
    </div>
  );
}
