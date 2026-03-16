// app/api/scores/route.js
// Fetches live college basketball scores + opening spreads + play-by-play for scoring runs

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ESPN_SCOREBOARD_URL =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard";
const ESPN_SUMMARY_URL =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary";

const RUN_WINDOW = 15; // last N points to track

/**
 * Parse clock + period → elapsed minutes (two 20-min halves).
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

  if (period === 1) return 20 - clockMinutes;
  if (period >= 2) return 20 + (20 - clockMinutes);
  return 0;
}

/**
 * Fetch play-by-play for a single game and compute last N points breakdown.
 * Returns { homeRunPts, awayRunPts, totalRunPts } or null on failure.
 */
async function fetchScoringRun(eventId, homeAbbr, awayAbbr, homeId, awayId) {
  try {
    const res = await fetch(`${ESPN_SUMMARY_URL}?event=${eventId}`, {
      headers: { "User-Agent": "MarchMadnessTracker/1.0" },
    });
    if (!res.ok) return null;

    const data = await res.json();

    // Extract scoring plays from play-by-play
    // ESPN play-by-play is in data.plays[] — each play has scoreValue, team.id, etc.
    const plays = data?.plays || [];

    // Flatten all plays across periods and filter to scoring plays
    const scoringPlays = [];

    for (const play of plays) {
      // Each "play" object might be a period container or a direct play
      // ESPN structures this as an array of play objects
      if (play.scoringPlay && play.scoreValue && play.scoreValue > 0) {
        scoringPlays.push({
          teamId: play.team?.id,
          points: play.scoreValue,
          text: play.text || "",
          homeScore: play.homeScore,
          awayScore: play.awayScore,
        });
      }
    }

    // If no scoring plays found, try alternative structure
    // ESPN sometimes nests plays under periods
    if (scoringPlays.length === 0 && data?.plays) {
      // Try flat array approach — look for any plays with scoreValue
      const allPlays = Array.isArray(data.plays) ? data.plays : [];
      for (const play of allPlays) {
        if (play.scoreValue > 0) {
          scoringPlays.push({
            teamId: play.team?.id,
            points: play.scoreValue,
            text: play.text || "",
          });
        }
      }
    }

    if (scoringPlays.length === 0) return null;

    // Get the last N points worth of scoring plays
    // Walk backwards through scoring plays, accumulating points until we reach RUN_WINDOW
    let totalPts = 0;
    let homePts = 0;
    let awayPts = 0;
    const recentPlays = [];

    for (let i = scoringPlays.length - 1; i >= 0 && totalPts < RUN_WINDOW; i--) {
      const play = scoringPlays[i];
      const pts = play.points;

      // Determine which team scored
      const isHome = play.teamId === homeId;
      const isAway = play.teamId === awayId;

      // If adding this play would exceed the window, only count partial? No — count full baskets
      if (totalPts + pts > RUN_WINDOW + 3) break; // allow slight overshoot for a 3-pointer

      totalPts += pts;
      if (isHome) homePts += pts;
      else if (isAway) awayPts += pts;

      recentPlays.push(play);

      if (totalPts >= RUN_WINDOW) break;
    }

    return {
      homeRunPts: homePts,
      awayRunPts: awayPts,
      totalRunPts: totalPts,
      runWindow: RUN_WINDOW,
    };
  } catch (err) {
    console.error(`PBP fetch error for event ${eventId}:`, err.message);
    return null;
  }
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

    // First pass: build game objects
    const games = events.map((event) => {
      const competition = event.competitions?.[0];
      const competitors = competition?.competitors || [];
      const homeTeam = competitors.find((c) => c.homeAway === "home");
      const awayTeam = competitors.find((c) => c.homeAway === "away");

      const homeAbbr = homeTeam?.team?.abbreviation || "???";
      const awayAbbr = awayTeam?.team?.abbreviation || "???";
      const homeId = homeTeam?.team?.id || null;
      const awayId = awayTeam?.team?.id || null;

      const homeSeed = homeTeam?.curatedRank?.current ?? homeTeam?.seed ?? null;
      const awaySeed = awayTeam?.curatedRank?.current ?? awayTeam?.seed ?? null;

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

      // Odds / Spread
      const oddsArray = competition?.odds || [];
      let openSpread = null;
      let currentSpread = null;
      let spreadFavoriteAbbr = null;
      let provider = null;

      let oddsObj = oddsArray.find((o) => o.provider?.id === 1002);
      if (!oddsObj && oddsArray.length > 0) oddsObj = oddsArray[0];

      if (oddsObj) {
        provider = oddsObj.provider?.name || "Unknown";
        currentSpread = oddsObj.spread ?? null;
        openSpread = oddsObj.open?.spread ?? oddsObj.spread ?? null;

        if (oddsObj.details) {
          const match = oddsObj.details.match(/^([A-Z]+)\s+[+-]?([\d.]+)/);
          if (match) spreadFavoriteAbbr = match[1];
        }
        if (!spreadFavoriteAbbr && openSpread !== null) {
          spreadFavoriteAbbr = openSpread < 0 ? homeAbbr : awayAbbr;
        }
      }

      const expectedMargin =
        openSpread !== null ? Math.abs(openSpread) : null;

      const homeScore = parseInt(homeTeam?.score || "0", 10);
      const awayScore = parseInt(awayTeam?.score || "0", 10);

      let actualMargin = null;
      if (spreadFavoriteAbbr) {
        actualMargin =
          spreadFavoriteAbbr === homeAbbr
            ? homeScore - awayScore
            : awayScore - homeScore;
      }

      let spreadUnderperformance = null;
      if (expectedMargin !== null && actualMargin !== null) {
        spreadUnderperformance = expectedMargin - actualMargin;
      }

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
        homeId,
        awayId,
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
        // Placeholder — filled in below
        scoringRun: null,
      };
    });

    // Second pass: fetch play-by-play for live games (parallel)
    const liveGames = games.filter(
      (g) => g.status === "inprogress" || g.status === "halftime"
    );

    if (liveGames.length > 0) {
      const runPromises = liveGames.map((g) =>
        fetchScoringRun(g.id, g.home, g.away, g.homeId, g.awayId)
      );
      const runResults = await Promise.all(runPromises);

      liveGames.forEach((g, i) => {
        g.scoringRun = runResults[i];
      });
    }

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
