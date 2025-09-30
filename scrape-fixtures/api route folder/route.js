/* scrape-fixtures/route.js Serverless route (Node.js) for Render / Vercel / Next.js (App Router) that scrapes futbol24.com

Features implemented:

Fetches league page HTML from futbol24

Parses upcoming fixtures and current standings table

Computes requested metrics:

1. Overall WDL ratio (3-digit code per team)


2. Goal ratio GF/GA * 10 (integer, no decimals)


3. Home team's home WDL - Away team's away WDL (3-digit each)



Returns JSON in the exact data format requested by the user

Simple in-memory cache with TTL to avoid hammering futbol24

Rate-limit courtesy pause and user-agent header


Notes:

This is a best-effort scraper. Futbol24 pages are HTML and the scraper relies on the current site structure.

For production: use rotating proxies, obey robots.txt, or use an official data provider (e.g. API-FOOTBALL) for stability.


Usage:

Deploy to Render as a Node service or add to a Next.js app/api/scrape-fixtures/route.js route.

Call: GET /api/scrape-fixtures?leagueUrl=https://www.futbol24.com/.....


Response example (JSON): { "league": "England - Premier League", "matches": [ { "home": "Arsenal", "away": "Man United", "wdl_overall": "621 - 125", "goal_ratio": "16/8 - 7/15", "homeaway_wdl": "920 - 029" }, ... ] } */

import fetch from 'node-fetch'; import cheerio from 'cheerio';

// Basic in-memory cache const cache = new Map(); const CACHE_TTL = 30 * 1000; // 30 seconds default (adjust as needed)

function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

// Helper to safely select text and trim const t = (el) => (el && el.text() ? el.text().trim() : '');

// Parse a standings table row and return an object {team, pts, played, wins, draws, losses, gf, ga, home: {w,d,l}, away: {w,d,l}} function parseStandingsFromHtml($){ // Futbol24 uses tables with classes/ids that may change. This function tries multiple selectors. const table = $('table.teamtable, table.liveTable, table.table').first(); const rows = table.find('tr').slice(1); // skip header const standing = []; rows.each((i, row) => { const cols = $(row).find('td'); if(cols.length < 6) return; // unexpected row // Heuristic parsing - columns vary by site structure const pos = t($(cols[0])); // team name sometimes inside <a> const team = t($(cols).find('a').last()) || t($(cols[1])); // Find numeric fields by matching numbers in cells const numbers = []; cols.each((j, c) => { const txt = t($(c)).replace(/[^0-9-/]/g,''); if(/\d/.test(txt)) numbers.push(txt); }); // Attempt to map numbers: played, wins, draws, losses, gf, ga, pts // This is heuristic and may need adjusting per league page let played, wins, draws, losses, gf, ga, pts; if(numbers.length >= 7){ played = parseInt(numbers[0]); wins = parseInt(numbers[1]); draws = parseInt(numbers[2]); losses = parseInt(numbers[3]); gf = parseInt(numbers[4]); ga = parseInt(numbers[5]); pts = parseInt(numbers[6]); }

// home/away mini tables might be available in separate columns like 'home  W-D-L' and 'away W-D-L'
// Try find patterns like "X-Y-Z" in the columns
let home = null, away = null;
cols.each((j,c)=>{
  const txt = t($(c));
  const m = txt.match(/(\d{1,2})-(\d{1,2})-(\d{1,2})/);
  if(m){
    if(!home) home = {w: parseInt(m[1]), d: parseInt(m[2]), l: parseInt(m[3])};
    else if(!away) away = {w: parseInt(m[1]), d: parseInt(m[2]), l: parseInt(m[3])};
  }
});

standing.push({team, pos, played, wins, draws, losses, gf, ga, pts, home, away});

}); return standing; }

// Compute WDL 3-digit code string from wins/draws/losses function wdlCode(obj){ const w = (obj && obj.w!==undefined) ? obj.w : (obj.wins || 0); const d = (obj && obj.d!==undefined) ? obj.d : (obj.draws || 0); const l = (obj && obj.l!==undefined) ? obj.l : (obj.losses || 0); return ${w}${d}${l}; }

// Compute goal ratio GF/GA * 10 integer, format "GF/GA" function goalRatio(gf, ga){ const gfa = Math.round((gf || 0) * 10); const gaa = Math.round((ga || 1) * 10); return ${gfa}/${gaa}; }

async function fetchHtml(url){ // check cache const now = Date.now(); if(cache.has(url)){ const {ts, data} = cache.get(url); if(now - ts < CACHE_TTL) return data; } // politeness: small random delay await sleep(250 + Math.random()*250); const res = await fetch(url, {headers: { 'User-Agent': 'Mozilla/5.0 (compatible; RSBS-Scraper/1.0; +https://yourdomain.example)'}}); if(!res.ok) throw new Error(Fetch failed ${res.status}); const html = await res.text(); cache.set(url, {ts: now, data: html}); return html; }

// Find fixtures from league HTML - this tries to parse upcoming fixtures list function parseFixturesFromHtml($){ const fixtures = []; // Futbol24 uses lists of fixtures, try selectors $('div.match, li.match, tr.fixture').each((i, el)=>{ const home = t($(el).find('.home, .homeTeam, .team-home, td.team-home')) || t($(el).find('td').eq(1)); const away = t($(el).find('.away, .awayTeam, .team-away, td.team-away')) || t($(el).find('td').eq(2)); if(home && away){ fixtures.push({home, away}); } }); // fallback: find patterns like "Team A - Team B" in anchor texts if(fixtures.length===0){ $('a').each((i, a)=>{ const txt = t($(a)); const m = txt.match(/^(.+)\s-\s(.+)$/); if(m){ fixtures.push({home: m[1].trim(), away: m[2].trim()}); } }); } return fixtures; }

// Main scrape function: given a league page URL, returns structured data export async function GET(request) { try { const urlObj = new URL(request.url); const leagueUrl = urlObj.searchParams.get('leagueUrl'); if(!leagueUrl) return new Response(JSON.stringify({error: 'leagueUrl query parameter required'}), {status:400, headers: {'Content-Type':'application/json'}});

// Normalize futbol24 URLs if user provided a path
const normalized = leagueUrl.startsWith('http') ? leagueUrl : `https://www.futbol24.com/${leagueUrl.replace(/^\/+/, '')}`;

const html = await fetchHtml(normalized);
const $ = cheerio.load(html);

// Attempt to read league name
const league = $('h1, .leagueHeader, .breadcrumb .active').first().text().trim() || $('title').text().trim();

// Parse standings
const standings = parseStandingsFromHtml($);
// Build a map by team name to standings object for quick lookup
const standMap = new Map();
standings.forEach(s => { if(s.team) standMap.set(s.team.replace(/\s+/g,' ').toLowerCase(), s); });

// Parse fixtures
const fixtures = parseFixturesFromHtml($);

// For each fixture, try to lookup teams in standings and compute metrics
const matches = fixtures.map(f => {
  const hKey = f.home.replace(/\s+/g,' ').toLowerCase();
  const aKey = f.away.replace(/\s+/g,' ').toLowerCase();
  const homeStand = standMap.get(hKey) || standMap.get(f.home.toLowerCase()) || null;
  const awayStand = standMap.get(aKey) || standMap.get(f.away.toLowerCase()) || null;

  const overallHome = homeStand ? `${homeStand.wins||0}${homeStand.draws||0}${homeStand.losses||0}` : '000';
  const overallAway = awayStand ? `${awayStand.wins||0}${awayStand.draws||0}${awayStand.losses||0}` : '000';

  const gfHome = homeStand ? (homeStand.gf||0) : 0;
  const gaHome = homeStand ? (homeStand.ga||1) : 1;
  const gfAway = awayStand ? (awayStand.gf||0) : 0;
  const gaAway = awayStand ? (awayStand.ga||1) : 1;

  const goalHome = Math.floor((gfHome * 10));
  const goalAway = Math.floor((gfAway * 10));

  const goalRatioStr = `${goalHome}/${Math.floor((gaHome*10))} - ${goalAway}/${Math.floor((gaAway*10))}`;

  const homeHomeWDL = homeStand && homeStand.home ? `${homeStand.home.w||0}${homeStand.home.d||0}${homeStand.home.l||0}` : '000';
  const awayAwayWDL = awayStand && awayStand.away ? `${awayStand.away.w||0}${awayStand.away.d||0}${awayStand.away.l||0}` : '000';

  return {
    home: f.home,
    away: f.away,
    wdl_overall: `${overallHome} - ${overallAway}`,
    goal_ratio: `${Math.floor(gfHome*10)}/${Math.floor(gaHome*10)} - ${Math.floor(gfAway*10)}/${Math.floor(gaAway*10)}`,
    homeaway_wdl: `${homeHomeWDL} - ${awayAwayWDL}`
  };
});

const payload = { league, matches };
return new Response(JSON.stringify(payload), { status:200, headers: { 'Content-Type':'application/json' } });

} catch (err) { console.error('scrape error', err); return new Response(JSON.stringify({ error: err.message }), { status:500, headers: {'Content-Type':'application/json'} }); } }

