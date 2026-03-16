// app/api/scores/route.js
// Serverless API route — fetches live college basketball scores + opening spreads
// Uses ESPN's public scoreboard endpoint (no API key needed)

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ESPN_SCOREBOARD_URL =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard";

/**
 * Parse the game clock and period to determine elapsed minutes.
 * College basketball: two 20-minute halves.
 * Clock counts DOWN from 20:00 each half.
 */
function getElapsedMinutes(clock, period, statusName) {
  if (statusName === "STATUS_HALFTIME") return 20;
  if (statusName === "STATUS_FINAL" || statusName === "STATUS_END_PERIOD")
    return 40;

  if (!clock || !period) return 0;

  const parts = clock.split(":");
  if (parts.length !== 2) return 0;
  const minutes = parseInt(parts[0], 10);
  const seconds = parseInt(parts[1], 10);
  const clockMinutes = minutes + seconds / 60;

  if (period === 1) {
    return 20 - clockMinutes;
  } else if (period >= 2) {
    return 20 + (20 - clockMinutes);
  }

  return 0;
}

export async function GET() {
  try {
    const res = await fetch(ESPN_SCOREBOARD_URL + "?groups=100", {
      next: { revalidate: 0 },
      headers: { "User-Agent": "MarchMadnessTracker/1.0" },
    });

    if (!res.ok) {
      return Response.json(
        { error: "Failed to fetch scores", status: res.status },
        { status: 502 }
      );
    }

    const data = await res.json();
    const events = data?.events || [];

    const games = events.map((event) => {
      const competition = event.competitions?.[0];
      const competitors = competition?.competitors || [];
      const homeTeam = competitors.find((c) => c.homeAway === "home");
      const awayTeam = competitors.find((c) => c.homeAway === "away");

      const homeAbbr = homeTeam?.team?.abbreviation || "???";
      const awayAbbr = awayTeam?.team?.abbreviation || "???";

      const homeSeed = homeTeam?.curatedRank?.current ?? homeTeam?.seed ?? null;
      const awaySeed = awayTeam?.curatedRank?.current ?? awayTeam?.seed ?? null;

      // ── Status ──
      const espnStatusName =
        competition?.status?.type?.name || "STATUS_SCHEDULED";
      let status = "scheduled";
      if (espnStatusName === "STATUS_IN_PROGRESS") status = "inprogress";
      else if (espnStatusName === "STATUS_HALFTIME") status = "halftime";
      else if (
        espnStatusName === "STATUS_FINAL" ||
        espnStatusName === "STATUS_END_PERIOD"
      )
        status = "closed";

      const clock = competition?.status?.displayClock || "";
      const period = competition?.status?.period || 0;
      const statusDetail = competition?.status?.type?.shortDetail || "";
      const elapsedMinutes = getElapsedMinutes(clock, period, espnStatusName);

      // ── Odds / Spread ──
      const oddsArray = competition?.odds || [];
      let openSpread = null;
      let currentSpread = null;
      let spreadFavoriteAbbr = null;
      let provider = null;

      // Try ESPN BET (id 1002) first, then fall back to first provider
      let oddsObj = oddsArray.find((o) => o.provider?.id === 1002);
      if (!oddsObj && oddsArray.length > 0) oddsObj = oddsArray[0];

      if (oddsObj) {
        provider = oddsObj.provider?.name || "Unknown";
        currentSpread = oddsObj.spread ?? null;

        // Opening spread: ESPN provides `open.spread` on some responses
        // Fall back to current spread if open isn't available
        openSpread = oddsObj.open?.spread ?? oddsObj.spread ?? null;

        // Determine favorite from the `details` field: e.g. "YALE -9.5"
        if (oddsObj.details) {
          const match = oddsObj.details.match(/^([A-Z]+)\s+[+-]?([\d.]+)/);
          if (match) spreadFavoriteAbbr = match[1];
        }

        // Fallback: derive favorite from spread sign
        // ESPN spread is from home perspective: negative = home favored
        if (!spreadFavoriteAbbr && openSpread !== null) {
          spreadFavoriteAbbr = openSpread < 0 ? homeAbbr : awayAbbr;
        }
      }

      // expectedMargin: how many points the favorite "should" win by
      const expectedMargin =
        openSpread !== null ? Math.abs(openSpread) : null;

      // ── Scores ──
      const homeScore = parseInt(homeTeam?.score || "0", 10);
      const awayScore = parseInt(awayTeam?.score || "0", 10);

      // ── Compute actual margin from favorite's perspective ──
      // Positive = favorite is winning by this much
      // Negative = favorite is losing by this much
      let actualMargin = null;
      if (spreadFavoriteAbbr) {
        if (spreadFavoriteAbbr === homeAbbr) {
          actualMargin = homeScore - awayScore;
        } else {
          actualMargin = awayScore - homeScore;
        }
      }

      // ── Spread underperformance ──
      // underperformance = expectedMargin - actualMargin
      // e.g. expected to win by 9.5, actually up by 2 → underperforming by 7.5
      // e.g. expected to win by 3, actually up by 10 → underperforming by -7 (outperforming)
      let spreadUnderperformance = null;
      if (expectedMargin !== null && actualMargin !== null) {
        spreadUnderperformance = expectedMargin - actualMargin;
      }

      // ── Start time ──
      const startDate = new Date(event.date);
      const localStart = startDate.toLocaleString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/New_York",
        timeZoneName: "short",
      });

      return {
        id: event.id,
        status,
        home: homeAbbr,
        away: awayAbbr,
        teams: {
          [homeAbbr]: {
            name: homeTeam?.team?.displayName || homeAbbr,
            logo: homeTeam?.team?.logo || null,
            seed: homeSeed,
            record: homeTeam?.records?.[0]?.summary || null,
          },
          [awayAbbr]: {
            name: awayTeam?.team?.displayName || awayAbbr,
            logo: awayTeam?.team?.logo || null,
            seed: awaySeed,
            record: awayTeam?.records?.[0]?.summary || null,
          },
        },
        score: { [homeAbbr]: homeScore, [awayAbbr]: awayScore },
        clock,
        period,
        statusDetail,
        elapsedMinutes,

        // Spread data
        openSpread,
        currentSpread,
        expectedMargin,
        spreadFavoriteAbbr,
        actualMargin,
        spreadUnderperformance,
        provider,

        local_start: localStart,
        start_time: event.date,
        isMarchMadness:
          event.season?.slug === "post-season" ||
          (competition?.type?.abbreviation ?? "").includes("NCAA") ||
          (event.name ?? "").toLowerCase().includes("ncaa") ||
          (competition?.notes?.[0]?.headline ?? "")
            .toLowerCase()
            .includes("ncaa"),
      };
    });

    return Response.json({
      games,
      total: games.length,
      fetched_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Score fetch error:", err);
    return Response.json(
      { error: "Internal error fetching scores", detail: err.message },
      { status: 500 }
    );
  }
}
