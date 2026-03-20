// app/api/scores/route.js
export const dynamic = "force-dynamic";
export const revalidate = 0;

const SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/scoreboard";
const ODDS_BASE =
  "https://sports.core.api.espn.com/v2/sports/basketball/leagues/mens-college-basketball/events";
const SUMMARY =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/mens-college-basketball/summary";
function elapsed(clock, period, sn) {
  if (sn === "STATUS_HALFTIME") return 20;
  if (sn === "STATUS_FINAL" || sn === "STATUS_END_PERIOD") return 40;
  if (!clock || !period) return 0;
  const [m, s] = clock.split(":").map(Number);
  const cm = m + s / 60;
  return period === 1 ? 20 - cm : period >= 2 ? 20 + (20 - cm) : 0;
}

async function fetchLiveOdds(eventId) {
  try {
    const url = `${ODDS_BASE}/${eventId}/competitions/${eventId}/odds`;
    const r = await fetch(url, { headers: { "User-Agent": "MMT/1.0" } });
    if (!r.ok) return null;
    const d = await r.json();
    const items = d?.items || d?.odds || [];
    if (items.length === 0 && d?.$ref) return null;

    // Find ESPN BET or first provider
    let odds = items.find((i) => i.provider?.id === 1002);
    if (!odds) odds = items[0];
    if (!odds) return null;

    // ESPN stores the static/opening line in odds.spread and odds.open.spread.
    // The truly live in-game line (if the provider offers it) lives in odds.current.spread.
    // Fall back through: current → spread → null.
    const liveSpread = odds.current?.spread ?? odds.spread ?? null;
    const openingSpread = odds.open?.spread ?? null;

    return {
      liveSpread,
      openingSpread,
      // Flag whether we actually have a live (in-game) line vs just the pre-game line
      isLive: odds.current?.spread != null,
      liveSpreadOdds: odds.current?.spreadOdds ?? odds.spreadOdds ?? null,
      liveOU: odds.current?.overUnder ?? odds.overUnder ?? null,
      liveMLHome: odds.homeTeamOdds?.moneyLine ?? null,
      liveMLAway: odds.awayTeamOdds?.moneyLine ?? null,
      liveFavHome: odds.homeTeamOdds?.favorite ?? false,
      liveFavAway: odds.awayTeamOdds?.favorite ?? false,
      liveSpreadHome: odds.homeTeamOdds?.spreadOdds ?? null,
      liveSpreadAway: odds.awayTeamOdds?.spreadOdds ?? null,
      details: odds.current?.details ?? odds.details ?? null,
      provider: odds.provider?.name || "ESPN BET",
    };
  } catch { return null; }
}

async function fetchRun(eventId, homeId, awayId) {
  try {
    const r = await fetch(`${SUMMARY}?event=${eventId}`, {
      headers: { "User-Agent": "MMT/1.0" },
    });
    if (!r.ok) return null;
    const d = await r.json();
    const plays = d?.plays || [];
    const scoring = plays.filter((p) => p.scoringPlay && p.scoreValue > 0);
    if (!scoring.length) return null;

    const calcWindow = (win) => {
      let total = 0, home = 0, away = 0;
      for (let i = scoring.length - 1; i >= 0 && total < win; i--) {
        const p = scoring[i];
        if (total + p.scoreValue > win + 3) break;
        total += p.scoreValue;
        if (p.team?.id === homeId) home += p.scoreValue;
        else if (p.team?.id === awayId) away += p.scoreValue;
        if (total >= win) break;
      }
      return { homeRunPts: home, awayRunPts: away, totalRunPts: total };
    };

    const r15 = calcWindow(15);
    const r12 = calcWindow(12);
    const r20 = calcWindow(20);
    // Spread top-level for backward compat (15-pt window), plus run12 / run20 for richer UI.
    return { ...r15, run12: r12, run20: r20 };
  } catch { return null; }
}

export async function GET() {
  try {
    const r = await fetch(SCOREBOARD + "?groups=100", {
      next: { revalidate: 0 },
      headers: { "User-Agent": "MMT/1.0" },
    });
    if (!r.ok)
      return Response.json({ error: "Fetch failed", status: r.status }, { status: 502 });

    const data = await r.json();
    const events = data?.events || [];

    const games = events.map((ev) => {
      const comp = ev.competitions?.[0];
      const cs = comp?.competitors || [];
      const ht = cs.find((c) => c.homeAway === "home");
      const at = cs.find((c) => c.homeAway === "away");
      const ha = ht?.team?.abbreviation || "???";
      const aa = at?.team?.abbreviation || "???";
      const hid = ht?.team?.id || null;
      const aid = at?.team?.id || null;

      const sn = comp?.status?.type?.name || "STATUS_SCHEDULED";
      let status = "scheduled";
      if (sn === "STATUS_IN_PROGRESS") status = "inprogress";
      else if (sn === "STATUS_HALFTIME") status = "halftime";
      else if (sn === "STATUS_FINAL" || sn === "STATUS_END_PERIOD") status = "closed";

      const clock = comp?.status?.displayClock || "";
      const period = comp?.status?.period || 0;
      const detail = comp?.status?.type?.shortDetail || "";
      const em = elapsed(clock, period, sn);

      // Pre-game odds from scoreboard
      const oa = comp?.odds || [];
      let oo = oa.find((o) => o.provider?.id === 1002);
      if (!oo && oa.length) oo = oa[0];

      let openSpread = null, spreadFav = null, provider = null;
      if (oo) {
        provider = oo.provider?.name || "Unknown";
        openSpread = oo.open?.spread ?? oo.spread ?? null;
        if (oo.details) {
          const m = oo.details.match(/^([A-Z]+)\s+[+-]?([\d.]+)/);
          if (m) spreadFav = m[1];
        }
        if (!spreadFav && openSpread !== null)
          spreadFav = openSpread < 0 ? ha : aa;
      }

      const expMargin = openSpread !== null ? Math.abs(openSpread) : null;
      const hs = parseInt(ht?.score || "0", 10);
      const as_ = parseInt(at?.score || "0", 10);

      let actMargin = null;
      if (spreadFav) actMargin = spreadFav === ha ? hs - as_ : as_ - hs;

      let underperf = null;
      if (expMargin !== null && actMargin !== null) underperf = expMargin - actMargin;

      const sd = new Date(ev.date);
      const ls = sd.toLocaleString("en-US", {
        weekday: "short", month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit",
        timeZone: "America/New_York", timeZoneName: "short",
      });

      return {
        id: ev.id, status, home: ha, away: aa, homeId: hid, awayId: aid,
        teams: {
          [ha]: { name: ht?.team?.displayName || ha, logo: ht?.team?.logo || null, seed: ht?.curatedRank?.current ?? ht?.seed ?? null, record: ht?.records?.[0]?.summary || null },
          [aa]: { name: at?.team?.displayName || aa, logo: at?.team?.logo || null, seed: at?.curatedRank?.current ?? at?.seed ?? null, record: at?.records?.[0]?.summary || null },
        },
        score: { [ha]: hs, [aa]: as_ },
        clock, period, statusDetail: detail, elapsedMinutes: em,
        openSpread, expectedMargin: expMargin, spreadFavoriteAbbr: spreadFav,
        actualMargin: actMargin, spreadUnderperformance: underperf, provider,
        local_start: ls, start_time: ev.date,
        isMarchMadness:
          ev.season?.slug === "post-season" ||
          (comp?.type?.abbreviation ?? "").includes("NCAA") ||
          (ev.name ?? "").toLowerCase().includes("ncaa") ||
          (comp?.notes?.[0]?.headline ?? "").toLowerCase().includes("ncaa"),
        liveOdds: null, scoringRun: null,
      };
    });

    // Fetch live odds + play-by-play for live games in parallel
    const live = games.filter((g) => g.status === "inprogress" || g.status === "halftime");
    if (live.length > 0) {
      const promises = live.map(async (g) => {
        const [odds, run] = await Promise.all([
          fetchLiveOdds(g.id),
          fetchRun(g.id, g.homeId, g.awayId),
        ]);
        g.liveOdds = odds;
        g.scoringRun = run;

        // Backfill spread alert data when the scoreboard didn't provide opening odds
        if (g.spreadUnderperformance === null && odds) {
          // Prefer the opening spread from the odds endpoint; fall back to current live spread
          const baseSpread = odds.openingSpread ?? odds.liveSpread ?? null;
          if (baseSpread !== null) {
            // Determine which team is the favourite
            let fav = g.spreadFavoriteAbbr;
            if (!fav && odds.details) {
              const m = odds.details.match(/^([A-Z]+)\s+[+-]?([\d.]+)/);
              if (m) fav = m[1];
            }
            if (!fav) {
              fav = odds.liveFavHome ? g.home
                  : odds.liveFavAway ? g.away
                  : (baseSpread < 0 ? g.home : g.away);
            }
            const expM = Math.abs(baseSpread);
            const actM = fav === g.home
              ? g.score[g.home] - g.score[g.away]
              : g.score[g.away] - g.score[g.home];
            g.spreadFavoriteAbbr = g.spreadFavoriteAbbr || fav;
            g.openSpread = g.openSpread ?? baseSpread;
            g.expectedMargin = g.expectedMargin ?? expM;
            g.actualMargin = actM;
            g.spreadUnderperformance = expM - actM;
          }
        }
      });
      await Promise.all(promises);
    }

    return Response.json({ games, total: games.length, fetched_at: new Date().toISOString() });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
