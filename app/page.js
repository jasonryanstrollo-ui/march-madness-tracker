"use client";
import { useState, useEffect, useCallback, useRef } from "react";

const POLL = 30000;
const SPREAD_THRESH = 5;
const MIN_ELAPSED = 5;
const RUN_THRESH = 0.75;
const LINE_MOVE_THRESH = 5.5;

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
  if (!lo?.liveSpread || g.openSpread == null) return false;
  const divergence = Math.abs(lo.liveSpread) - Math.abs(g.openSpread);
  return divergence < -LINE_MOVE_THRESH;
}

const CSS = `
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
@keyframes glow{0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,0)}50%{box-shadow:0 0 16px 2px rgba(239,68,68,.15)}}
@keyframes glowCombo{0%,100%{box-shadow:0 0 0 0 rgba(245,158,11,0)}50%{box-shadow:0 0 18px 3px rgba(245,158,11,.18)}}
@keyframes glowPurple{0%,100%{box-shadow:0 0 0 0 rgba(167,139,250,0)}50%{box-shadow:0 0 16px 2px rgba(167,139,250,.18)}}
@keyframes fadeIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
@keyframes spin{to{transform:rotate(360deg)}}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
body{overscroll-behavior:none;margin:0;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
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
      <span style={{ fontSize: 9, fontWeight: 600, color: hot ? "#F59E0B" : "rgba(255,255,255,.25)", fontFamily: "monospace" }}>{pts}</span>
    </div>
  );
}

function OddsChip({ label, value, sub, alert }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      padding: "4px 8px", borderRadius: 6,
      background: alert ? "rgba(239,68,68,.08)" : "rgba(255,255,255,.03)",
      border: alert ? "1px solid rgba(239,68,68,.2)" : "1px solid rgba(255,255,255,.05)",
      minWidth: 56,
    }}>
      <span style={{ fontSize: 8, fontWeight: 700, color: "rgba(255,255,255,.3)", letterSpacing: ".05em", textTransform: "uppercase", fontFamily: "monospace" }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 700, color: alert ? "#EF4444" : "#fff", fontFamily: "monospace", marginTop: 1 }}>{value}</span>
      {sub && <span style={{ fontSize: 8, color: alert ? "#F87171" : "rgba(255,255,255,.25)", fontFamily: "monospace", marginTop: 1 }}>{sub}</span>}
    </div>
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

  // Divergence: signed delta from the original favorite's perspective.
  // Positive = line moved against the favorite (underdog covering more);
  // Negative = line tightened in the favorite's direction.
  let divergence = null;
  if (g.openSpread != null && normalizedLiveSpread !== null) {
    divergence = normalizedLiveSpread - Number(g.openSpread);
  }

  // Card style based on highest-priority alert
  const cardBg = sara ? "rgba(245,158,11,.05)" : sa ? "rgba(239,68,68,.04)" : ura ? "rgba(167,139,250,.04)" : "rgba(255,255,255,.02)";
  const cardBorder = sara ? "1px solid rgba(245,158,11,.25)" : sa ? "1px solid rgba(239,68,68,.2)" : ura ? "1px solid rgba(167,139,250,.2)" : "1px solid rgba(255,255,255,.05)";
  const cardAnim = sara ? "glowCombo 2.5s ease-in-out infinite, fadeIn .3s ease-out" : sa ? "glow 2.5s ease-in-out infinite, fadeIn .3s ease-out" : ura ? "glowPurple 2.5s ease-in-out infinite, fadeIn .3s ease-out" : "fadeIn .3s ease-out";

  return (
    <div style={{
      background: cardBg, border: cardBorder, borderRadius: 12, padding: "12px 14px",
      animation: cardAnim, transition: "all .3s",
    }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ position: "relative" }}>
            <div style={{ width: 6, height: 6, borderRadius: "50%", background: SC[g.status] || "#6B7280", animation: live ? "pulse 1.5s infinite" : "none" }} />
          </div>
          <span style={{ fontSize: 10, fontWeight: 700, color: SC[g.status] || "#6B7280", fontFamily: "monospace", letterSpacing: ".06em" }}>
            {SL[g.status] || g.status}
          </span>
          {live && g.statusDetail && (
            <span style={{ fontSize: 10, color: "rgba(255,255,255,.3)", fontFamily: "monospace" }}>{g.statusDetail}</span>
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
                  <img src={t.d.logo} alt="" style={{ width: 20, height: 20, objectFit: "contain", borderRadius: 3, opacity: t.s > t.opp && live ? 1 : .5 }} />
                ) : <div style={{ width: 20, height: 20, borderRadius: 3, background: "rgba(255,255,255,.05)" }} />}
                {t.d.seed && t.d.seed <= 16 && (
                  <span style={{ fontSize: 9, fontWeight: 800, color: "rgba(255,255,255,.3)", fontFamily: "monospace", width: 14, textAlign: "center" }}>{t.d.seed}</span>
                )}
                <span style={{
                  fontSize: 13, fontWeight: t.s > t.opp && live ? 700 : 400,
                  color: t.s > t.opp && live ? "#fff" : "rgba(255,255,255,.45)",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>{t.d.name || t.abbr}</span>
                {t.isFav && g.spreadFavoriteAbbr && (
                  <span style={{ fontSize: 7, fontWeight: 800, color: "#FBBF24", background: "rgba(251,191,36,.08)", borderRadius: 2, padding: "1px 4px", fontFamily: "monospace" }}>FAV</span>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {live && run?.totalRunPts > 0 && <Momentum pts={t.runPts} total={run.totalRunPts} />}
                <span style={{
                  fontSize: 20, fontWeight: 800, fontFamily: "monospace", minWidth: 32, textAlign: "right",
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
          {normalizedLiveSpread !== null && (
            <OddsChip
              label="Live"
              value={`${g.spreadFavoriteAbbr || (normalizedLiveSpread < 0 ? g.home : g.away)} ${normalizedLiveSpread > 0 ? "+" : ""}${normalizedLiveSpread.toFixed(1)}`}
              sub={lo.liveSpreadHome ? `H ${lo.liveSpreadHome}` : lo.liveSpreadAway ? `A ${lo.liveSpreadAway}` : null}
            />
          )}
          {divergence !== null && live && (
            <OddsChip
              label="Shift"
              value={`${divergence > 0 ? "+" : ""}${divergence.toFixed(1)}`}
              alert={Math.abs(divergence) >= 3}
              sub={divergence > 0 ? "fav slipping" : divergence < 0 ? "fav covering" : "no move"}
            />
          )}
          {sa && g.spreadUnderperformance != null && (
            <OddsChip label="vs Spread" value={`-${Number(g.spreadUnderperformance).toFixed(1)}`} alert={true} sub="underperforming" />
          )}
        </div>
      )}

      {/* Scheduled time */}
      {g.status === "scheduled" && (
        <div style={{ marginTop: 6, fontSize: 10, color: "rgba(255,255,255,.2)", fontFamily: "monospace" }}>{g.local_start}</div>
      )}

      {/* Early game note */}
      {live && g.expectedMargin !== null && g.elapsedMinutes < MIN_ELAPSED && (
        <div style={{ marginTop: 4, fontSize: 9, color: "rgba(255,255,255,.15)", fontFamily: "monospace", fontStyle: "italic" }}>
          Spread tracking starts at 5:00
        </div>
      )}
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
      if (filter === "upset") return isUnderdogRunAlert(g);
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
  const urac = games.filter(isUnderdogRunAlert).length;
  const lc = games.filter((g) => g.status === "inprogress" || g.status === "halftime").length;

  const Pill = ({ k, label, active }) => (
    <button onClick={() => setFilter(k)} style={{
      background: active ? "rgba(255,255,255,.1)" : "transparent",
      border: active ? "1px solid rgba(255,255,255,.12)" : "1px solid rgba(255,255,255,.05)",
      borderRadius: 8, padding: "6px 12px", fontSize: 11, fontWeight: 600,
      color: active ? "#fff" : "rgba(255,255,255,.35)",
      cursor: "pointer", transition: "all .15s", whiteSpace: "nowrap", fontFamily: "inherit",
    }}>{label}</button>
  );

  return (
    <div style={{ minHeight: "100dvh", background: "#0C0C10", color: "#fff" }}>
      <style>{CSS}</style>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />

      <div style={{ maxWidth: 520, margin: "0 auto", padding: "16px 12px env(safe-area-inset-bottom)" }}>
        {/* Header */}
        <div style={{ marginBottom: 16 }}>
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

        {/* Alert summary */}
        {(sc > 0 || rc > 0 || urac > 0) && (
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
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
                  <div style={{ fontSize: 9, color: "rgba(255,255,255,.3)", marginTop: 1 }}>Dog run + line move 5.5+</div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Filters */}
        <div style={{ display: "flex", gap: 6, marginBottom: 14, overflowX: "auto", scrollbarWidth: "none", paddingBottom: 2 }}>
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
