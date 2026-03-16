"use client";

import { useState, useEffect, useCallback, useRef } from "react";

// ─── Config ──────────────────────────────────────────────
const POLL_INTERVAL = 30000;
const UNDERPERFORMANCE_THRESHOLD = 5; // points behind spread to trigger alert
const MIN_ELAPSED_MINUTES = 5; // must be 5+ min into game

const STATUS_LABELS = {
  inprogress: "LIVE",
  scheduled: "UPCOMING",
  closed: "FINAL",
  halftime: "HALFTIME",
};

// ─── Helpers ─────────────────────────────────────────────
function getStatusColor(status) {
  switch (status) {
    case "inprogress": return "#FF3B30";
    case "halftime": return "#FF9500";
    case "scheduled": return "#30D158";
    case "closed": return "#636366";
    default: return "#636366";
  }
}

/**
 * NEW ALERT LOGIC:
 * Flag a game when:
 *   1. Game is live (inprogress or halftime)
 *   2. At least 5 minutes of game time have elapsed
 *   3. Spread data is available
 *   4. The favorite is underperforming the opening spread by MORE than 5 points
 *
 * Example: Favorite is -9.5 (expected to win by 9.5).
 *   They're up by 2 → underperforming by 7.5 → FLAGGED
 *   They're up by 6 → underperforming by 3.5 → not flagged
 *   They're down by 3 → underperforming by 12.5 → FLAGGED
 */
function isSpreadAlert(game) {
  if (game.status !== "inprogress" && game.status !== "halftime") return false;
  if (game.elapsedMinutes < MIN_ELAPSED_MINUTES) return false;
  if (game.spreadUnderperformance === null || game.spreadUnderperformance === undefined) return false;
  if (game.expectedMargin === null) return false;

  return game.spreadUnderperformance > UNDERPERFORMANCE_THRESHOLD;
}

function formatUnderperformance(val) {
  if (val === null || val === undefined) return "–";
  return val > 0 ? `+${val.toFixed(1)}` : val.toFixed(1);
}

// ─── CSS Animations ──────────────────────────────────────
const globalCSS = `
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
  @keyframes slideIn {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes alertGlow {
    0%, 100% { box-shadow: 0 0 0 0 rgba(255,59,48,0); }
    50% { box-shadow: 0 0 24px 4px rgba(255,59,48,0.2); }
  }
  @keyframes beacon {
    0% { transform: scale(1); opacity: 0.7; }
    100% { transform: scale(3); opacity: 0; }
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body { overscroll-behavior: none; }
`;

// ─── Components ──────────────────────────────────────────

function SpreadBadge({ game }) {
  if (game.expectedMargin === null) return null;

  const isLive = game.status === "inprogress" || game.status === "halftime";
  const favName = game.spreadFavoriteAbbr || "???";
  const spreadVal = game.openSpread !== null ? Math.abs(game.openSpread).toFixed(1) : "?";

  return (
    <div style={{
      display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap",
    }}>
      <span style={{
        fontSize: 10, color: "rgba(255,255,255,0.3)",
        fontFamily: "'JetBrains Mono', monospace",
      }}>
        {favName} -{spreadVal}
      </span>
      {isLive && game.spreadUnderperformance !== null && (
        <span style={{
          fontSize: 10, fontWeight: 700,
          fontFamily: "'JetBrains Mono', monospace",
          color: game.spreadUnderperformance > UNDERPERFORMANCE_THRESHOLD
            ? "#FF6B6B"
            : game.spreadUnderperformance > 0
            ? "#FF9500"
            : "#30D158",
        }}>
          {game.spreadUnderperformance > 0 ? "▼" : "▲"}{" "}
          {Math.abs(game.spreadUnderperformance).toFixed(1)} vs spread
        </span>
      )}
    </div>
  );
}

function TeamRow({ abbr, name, logo, seed, score, isFav, isWinning, isLive, hasScore }) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
        {logo ? (
          <img src={logo} alt="" style={{
            width: 24, height: 24, objectFit: "contain", borderRadius: 4, flexShrink: 0,
            opacity: isWinning || !isLive ? 0.9 : 0.4,
          }} />
        ) : (
          <div style={{
            width: 24, height: 24, borderRadius: 4, background: "rgba(255,255,255,0.06)", flexShrink: 0,
          }} />
        )}

        {seed && seed <= 16 && (
          <span style={{
            fontSize: 10, fontWeight: 800, color: "rgba(255,255,255,0.35)",
            fontFamily: "'JetBrains Mono', monospace", width: 18, textAlign: "center", flexShrink: 0,
          }}>
            {seed}
          </span>
        )}

        <span style={{
          fontSize: 14,
          fontWeight: isWinning && isLive ? 700 : 500,
          color: isWinning && isLive ? "#fff" : isLive ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.5)",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", transition: "color 0.3s",
        }}>
          {name}
        </span>

        {isFav && (
          <span style={{
            fontSize: 8, fontWeight: 800, color: "#FFD60A",
            background: "rgba(255,214,10,0.1)", border: "1px solid rgba(255,214,10,0.15)",
            borderRadius: 3, padding: "1px 5px", letterSpacing: "0.08em",
            fontFamily: "'JetBrains Mono', monospace", flexShrink: 0,
          }}>
            FAV
          </span>
        )}
      </div>

      <span style={{
        fontSize: 24, fontWeight: 800,
        color: isWinning && isLive ? "#fff" : hasScore ? "rgba(255,255,255,0.4)" : "rgba(255,255,255,0.1)",
        fontFamily: "'JetBrains Mono', monospace", minWidth: 40, textAlign: "right", transition: "color 0.3s",
      }}>
        {hasScore ? score : "–"}
      </span>
    </div>
  );
}

function GameCard({ game }) {
  const alert = isSpreadAlert(game);
  const isLive = game.status === "inprogress" || game.status === "halftime";
  const homeIsFav = game.spreadFavoriteAbbr === game.home;

  const homeData = game.teams?.[game.home] || {};
  const awayData = game.teams?.[game.away] || {};
  const homeScore = game.score?.[game.home];
  const awayScore = game.score?.[game.away];

  return (
    <div style={{
      background: alert
        ? "linear-gradient(135deg, rgba(255,59,48,0.07) 0%, rgba(255,100,50,0.03) 100%)"
        : "rgba(255,255,255,0.025)",
      border: alert ? "1px solid rgba(255,59,48,0.35)" : "1px solid rgba(255,255,255,0.05)",
      borderRadius: 16, padding: "14px 18px",
      animation: alert
        ? "alertGlow 2.5s ease-in-out infinite, slideIn 0.35s ease-out"
        : "slideIn 0.35s ease-out",
      position: "relative", overflow: "hidden", transition: "border-color 0.5s, background 0.5s",
    }}>
      {/* Header: status + alert badge */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ position: "relative", width: 8, height: 8 }}>
            <div style={{
              width: 8, height: 8, borderRadius: "50%", background: getStatusColor(game.status),
              animation: isLive ? "pulse 1.5s ease-in-out infinite" : "none",
            }} />
            {isLive && (
              <div style={{
                position: "absolute", top: 0, left: 0, width: 8, height: 8, borderRadius: "50%",
                background: getStatusColor(game.status), animation: "beacon 1.5s ease-out infinite",
              }} />
            )}
          </div>
          <span style={{
            fontSize: 11, fontWeight: 700, letterSpacing: "0.08em",
            color: getStatusColor(game.status), fontFamily: "'JetBrains Mono', monospace",
          }}>
            {STATUS_LABELS[game.status] || game.status}
          </span>
          {game.statusDetail && isLive && (
            <span style={{
              fontSize: 11, color: "rgba(255,255,255,0.35)", fontFamily: "'JetBrains Mono', monospace",
            }}>
              {game.statusDetail}
            </span>
          )}
        </div>

        {alert && (
          <div style={{
            background: "rgba(255,59,48,0.15)", border: "1px solid rgba(255,59,48,0.3)",
            borderRadius: 20, padding: "3px 10px",
            fontSize: 10, fontWeight: 800, color: "#FF6B6B",
            letterSpacing: "0.1em", fontFamily: "'JetBrains Mono', monospace",
          }}>
            🚨 {game.spreadUnderperformance.toFixed(1)} OFF SPREAD
          </div>
        )}
      </div>

      {/* Team rows */}
      <TeamRow
        abbr={game.away} name={awayData.name || game.away} logo={awayData.logo} seed={awayData.seed}
        score={awayScore} isFav={!homeIsFav && !!game.spreadFavoriteAbbr}
        isWinning={awayScore != null && homeScore != null && awayScore > homeScore}
        isLive={isLive} hasScore={game.status !== "scheduled"}
      />
      <div style={{ height: 1, background: "rgba(255,255,255,0.04)", margin: "4px 0" }} />
      <TeamRow
        abbr={game.home} name={homeData.name || game.home} logo={homeData.logo} seed={homeData.seed}
        score={homeScore} isFav={homeIsFav && !!game.spreadFavoriteAbbr}
        isWinning={homeScore != null && awayScore != null && homeScore > awayScore}
        isLive={isLive} hasScore={game.status !== "scheduled"}
      />

      {/* Spread info bar */}
      <div style={{ marginTop: 10 }}>
        <SpreadBadge game={game} />
      </div>

      {/* Scheduled game time */}
      {game.status === "scheduled" && (
        <div style={{
          marginTop: 4, fontSize: 11, color: "rgba(255,255,255,0.25)",
          fontFamily: "'JetBrains Mono', monospace",
        }}>
          {game.local_start}
        </div>
      )}

      {/* Early game indicator — spread exists but <5 min elapsed */}
      {isLive && game.expectedMargin !== null && game.elapsedMinutes < MIN_ELAPSED_MINUTES && (
        <div style={{
          marginTop: 6, fontSize: 10, color: "rgba(255,255,255,0.2)",
          fontFamily: "'JetBrains Mono', monospace", fontStyle: "italic",
        }}>
          Monitoring starts at 5:00 min mark
        </div>
      )}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────
export default function Home() {
  const [games, setGames] = useState([]);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filter, setFilter] = useState("all");
  const [onlyMarchMadness, setOnlyMarchMadness] = useState(false);
  const intervalRef = useRef(null);

  const fetchScores = useCallback(async () => {
    try {
      const res = await fetch("/api/scores", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setGames(data.games || []);
      setLastUpdate(new Date());
      setError(null);
    } catch (err) {
      console.error("Fetch error:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchScores();
    intervalRef.current = setInterval(fetchScores, POLL_INTERVAL);
    return () => clearInterval(intervalRef.current);
  }, [fetchScores]);

  const displayGames = games
    .filter((g) => {
      if (onlyMarchMadness && !g.isMarchMadness) return false;
      if (filter === "live") return g.status === "inprogress" || g.status === "halftime";
      if (filter === "alerts") return isSpreadAlert(g);
      return true;
    })
    .sort((a, b) => {
      const aAlert = isSpreadAlert(a) ? 0 : 1;
      const bAlert = isSpreadAlert(b) ? 0 : 1;
      if (aAlert !== bAlert) return aAlert - bAlert;
      // Secondary sort: worst underperformance first
      const aUnder = a.spreadUnderperformance ?? -999;
      const bUnder = b.spreadUnderperformance ?? -999;
      if (aAlert === 0 && bAlert === 0) return bUnder - aUnder;
      const order = { inprogress: 0, halftime: 1, scheduled: 2, closed: 3 };
      return (order[a.status] ?? 4) - (order[b.status] ?? 4);
    });

  const alertCount = games.filter(isSpreadAlert).length;
  const liveCount = games.filter(
    (g) => g.status === "inprogress" || g.status === "halftime"
  ).length;

  return (
    <div style={{
      minHeight: "100dvh",
      background: "linear-gradient(180deg, #0A0A0F 0%, #10101A 50%, #0A0A0F 100%)",
      color: "#fff", fontFamily: "'DM Sans', sans-serif",
      position: "relative", WebkitFontSmoothing: "antialiased",
    }}>
      <style>{globalCSS}</style>

      {/* Ambient glow */}
      <div style={{
        position: "fixed", top: -300, right: -200, width: 600, height: 600, borderRadius: "50%",
        background: alertCount > 0
          ? "radial-gradient(circle, rgba(255,59,48,0.06) 0%, transparent 70%)"
          : "radial-gradient(circle, rgba(48,209,88,0.03) 0%, transparent 70%)",
        pointerEvents: "none", transition: "background 2s ease",
      }} />

      <div style={{ maxWidth: 540, margin: "0 auto", padding: "20px 16px env(safe-area-inset-bottom)" }}>
        {/* Header */}
        <header style={{ marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 6 }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>
              March Madness
            </h1>
            <span style={{
              fontSize: 10, fontWeight: 800, letterSpacing: "0.12em",
              background: "linear-gradient(135deg, #FF3B30, #FF9500)",
              WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
              fontFamily: "'JetBrains Mono', monospace",
            }}>
              SPREAD TRACKER
            </span>
          </div>
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            fontSize: 11, color: "rgba(255,255,255,0.3)", fontFamily: "'JetBrains Mono', monospace",
          }}>
            <div style={{
              width: 6, height: 6, borderRadius: "50%",
              background: error ? "#FF3B30" : "#30D158",
              animation: error ? "none" : "pulse 2s ease-in-out infinite",
            }} />
            {error ? "CONNECTION ERROR" : `MONITORING ${liveCount} LIVE · ${games.length} TOTAL`}
            {lastUpdate && !error && (
              <span>
                · {lastUpdate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
            )}
          </div>
        </header>

        {/* Alert banner */}
        {alertCount > 0 && (
          <div style={{
            background: "linear-gradient(135deg, rgba(255,59,48,0.1) 0%, rgba(255,149,0,0.06) 100%)",
            border: "1px solid rgba(255,59,48,0.25)", borderRadius: 14,
            padding: "14px 18px", marginBottom: 18,
            animation: "alertGlow 2.5s ease-in-out infinite",
            display: "flex", alignItems: "center", gap: 14,
          }}>
            <div style={{
              width: 40, height: 40, borderRadius: 12,
              background: "rgba(255,59,48,0.12)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 20, flexShrink: 0,
            }}>
              🏀
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#FF6B6B" }}>
                {alertCount} Spread Alert{alertCount !== 1 ? "s" : ""}!
              </div>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", marginTop: 2 }}>
                Favorite{alertCount !== 1 ? "s" : ""} underperforming opening spread by 5+ pts
              </div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div style={{
          display: "flex", gap: 8, marginBottom: 18, overflowX: "auto",
          WebkitOverflowScrolling: "touch", scrollbarWidth: "none", paddingBottom: 2,
        }}>
          {[
            { key: "all", label: `All (${games.length})` },
            { key: "live", label: `Live (${liveCount})` },
            { key: "alerts", label: `Alerts${alertCount > 0 ? ` (${alertCount})` : ""}` },
          ].map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              style={{
                background: filter === f.key ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.025)",
                border: filter === f.key ? "1px solid rgba(255,255,255,0.15)" : "1px solid rgba(255,255,255,0.05)",
                borderRadius: 20, padding: "7px 16px",
                fontSize: 12, fontWeight: 600,
                color: filter === f.key ? "#fff" : "rgba(255,255,255,0.4)",
                cursor: "pointer", transition: "all 0.2s",
                fontFamily: "'DM Sans', sans-serif", whiteSpace: "nowrap", flexShrink: 0,
              }}
            >
              {f.label}
            </button>
          ))}
          <button
            onClick={() => setOnlyMarchMadness((v) => !v)}
            style={{
              background: onlyMarchMadness ? "rgba(255,149,0,0.12)" : "rgba(255,255,255,0.025)",
              border: onlyMarchMadness ? "1px solid rgba(255,149,0,0.3)" : "1px solid rgba(255,255,255,0.05)",
              borderRadius: 20, padding: "7px 16px",
              fontSize: 12, fontWeight: 600,
              color: onlyMarchMadness ? "#FF9500" : "rgba(255,255,255,0.4)",
              cursor: "pointer", transition: "all 0.2s",
              fontFamily: "'DM Sans', sans-serif", whiteSpace: "nowrap", flexShrink: 0,
            }}
          >
            🏆 NCAA Only
          </button>
        </div>

        {/* Loading */}
        {loading && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: 60 }}>
            <div style={{
              width: 36, height: 36, border: "3px solid rgba(255,255,255,0.08)",
              borderTopColor: "#FF3B30", borderRadius: "50%",
              animation: "spin 0.8s linear infinite", marginBottom: 16,
            }} />
            <p style={{ color: "rgba(255,255,255,0.35)", fontSize: 13, margin: 0 }}>Loading scores...</p>
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div style={{
            background: "rgba(255,59,48,0.08)", border: "1px solid rgba(255,59,48,0.2)",
            borderRadius: 12, padding: 16, marginBottom: 16, textAlign: "center",
          }}>
            <p style={{ color: "#FF6B6B", fontSize: 13, margin: "0 0 8px" }}>
              Failed to fetch scores: {error}
            </p>
            <button onClick={fetchScores} style={{
              background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 8, padding: "6px 16px", color: "#fff", fontSize: 12,
              cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
            }}>
              Retry
            </button>
          </div>
        )}

        {/* Game cards */}
        {!loading && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {displayGames.length === 0 ? (
              <div style={{ textAlign: "center", padding: 48, color: "rgba(255,255,255,0.25)", fontSize: 13 }}>
                {filter === "alerts"
                  ? "No spread alerts — all favorites performing within 5 pts of their line."
                  : filter === "live"
                  ? "No live games at the moment."
                  : "No games scheduled."}
              </div>
            ) : (
              displayGames.map((game) => <GameCard key={game.id} game={game} />)
            )}
          </div>
        )}

        {/* Footer */}
        <footer style={{
          marginTop: 32, paddingTop: 18, paddingBottom: 24,
          borderTop: "1px solid rgba(255,255,255,0.04)",
          textAlign: "center", fontSize: 10, color: "rgba(255,255,255,0.18)",
          fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.6,
        }}>
          Spreads sourced from ESPN BET · Auto-refreshes every {POLL_INTERVAL / 1000}s
          <br />Alerts: favorite &gt;5 pts behind opening spread after 5 min
          <br />Add to Home Screen for app-like experience
        </footer>
      </div>
    </div>
  );
}
