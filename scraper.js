/**
 * NYC Parks Field Availability Scraper
 *
 * Calls the real NYC Parks API directly — no headless browser needed.
 *   GET /api/athletic-fields?datetime=YYYY-MM-DD+H:mm
 *   → { dusk: "HH:MM", l: ["M015-SOCCER-1", ...] }
 *
 * Queries at QUERY_HOURS throughout the day to build a per-field schedule.
 * Cache: 6-hour TTL. Rate limit: DELAY_MS between requests.
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const CACHE_DIR       = path.join(__dirname, 'cache');
const PARKS_API       = 'https://www.nycgovparks.org/api/athletic-fields';
const OPEN_DATA_API   = 'https://data.cityofnewyork.us/resource/enfh-gkve.json';
const PARK_NAMES_FILE = path.join(CACHE_DIR, 'park_names.json');
const DELAY_MS        = 1000;

// Every 2 hours, 8am–9pm
const QUERY_HOURS = [8, 10, 12, 14, 16, 18, 20];

const BOROUGH_PREFIX = {
  M: 'Manhattan',
  B: 'Brooklyn',
  X: 'Bronx',
  Q: 'Queens',
  R: 'Staten Island',
};

const SPORTS = ['SOCCER','BASEBALL','BASKETBALL','TENNIS','SOFTBALL',
                'FOOTBALL','CRICKET','RUGBY','LACROSSE','VOLLEYBALL',
                'HANDBALL','BOCCE','HOCKEY','SWIMMING','TRACK'];

// ── HTTP helper ───────────────────────────────────────────────────────────────

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Referer': 'https://www.nycgovparks.org/permits/field-and-court/map',
  'Accept-Language': 'en-US,en;q=0.9',
};

function get(url, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { ...BROWSER_HEADERS, ...extraHeaders } }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse failed for ${url}: ${data.slice(0, 120)}`)); }
      });
    }).on('error', reject);
  });
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function formatDate(d) {
  if (typeof d === 'string') return d;
  return d.toISOString().slice(0, 10);
}

// ── Cache helpers ─────────────────────────────────────────────────────────────

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function loadCache(sport, dateStr) {
  const file = path.join(CACHE_DIR, `${sport}_${dateStr}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Date.now() - data._cachedAt < 6 * 60 * 60 * 1000) return data;
  } catch (_) {}
  return null;
}

function saveCache(sport, dateStr, data) {
  ensureCacheDir();
  fs.writeFileSync(
    path.join(CACHE_DIR, `${sport}_${dateStr}.json`),
    JSON.stringify({ ...data, _cachedAt: Date.now() }, null, 2)
  );
}

// ── Park name lookup (NYC Open Data) ─────────────────────────────────────────

let parkNameCache = {};

function loadParkNames() {
  if (!fs.existsSync(PARK_NAMES_FILE)) return;
  try { parkNameCache = JSON.parse(fs.readFileSync(PARK_NAMES_FILE, 'utf8')); }
  catch (_) {}
}

function saveParkNames() {
  ensureCacheDir();
  fs.writeFileSync(PARK_NAMES_FILE, JSON.stringify(parkNameCache, null, 2));
}

async function enrichParkNames(parkCodes) {
  const missing = [...new Set(parkCodes)].filter((c) => c && !parkNameCache[c]);
  if (missing.length === 0) return;

  console.log(`  Looking up ${missing.length} park name(s)…`);
  const BATCH = 50;
  for (let i = 0; i < missing.length; i += BATCH) {
    const batch = missing.slice(i, i + BATCH);
    const inClause = batch.map((c) => `'${c}'`).join(',');
    const url = `${OPEN_DATA_API}?$where=gispropnum+in(${encodeURIComponent(inClause)})&$select=gispropnum,signname&$limit=100`;
    try {
      const rows = await get(url, { Referer: 'https://data.cityofnewyork.us/' });
      rows.forEach((r) => {
        if (r.gispropnum && r.signname) parkNameCache[r.gispropnum] = r.signname;
      });
    } catch (err) {
      console.warn(`  Park name lookup warning: ${err.message}`);
    }
    await sleep(300);
  }
  saveParkNames();
}

// ── Field ID decoding ─────────────────────────────────────────────────────────

function extractParkCode(id) {
  const parts = id.toUpperCase().split('-');
  const sportIdx = parts.findIndex((p) => SPORTS.includes(p));
  if (sportIdx < 0) return id;
  return parts.slice(0, sportIdx).filter((p) => !p.startsWith('ZN')).join('-');
}

function decodeFieldId(id) {
  const parts = id.toUpperCase().split('-');
  const sportIdx = parts.findIndex((p) => SPORTS.includes(p));
  if (sportIdx < 0) return { fieldName: id, sport: 'UNKNOWN', borough: '', parkCode: id, location: '' };

  const sport    = parts[sportIdx];
  const fieldNum = parts.slice(sportIdx + 1).join('');
  const parkCode = parts.slice(0, sportIdx).filter((p) => !p.startsWith('ZN')).join('-');
  const borough  = BOROUGH_PREFIX[id[0].toUpperCase()] || '';
  const parkName = parkNameCache[parkCode] || parkCode;

  return {
    fieldName: `${parkName} — ${cap(sport)} Field ${fieldNum}`,
    fieldId: id,
    sport,
    borough,
    parkCode,
    location: parkName,
  };
}

function cap(s) { return s.charAt(0) + s.slice(1).toLowerCase(); }

function parseDuskHour(duskStr) {
  if (!duskStr) return 20;
  return parseInt((duskStr || '20:00').split(':')[0], 10) || 20;
}

// ── Core scrape ───────────────────────────────────────────────────────────────

async function scrapeDay(sport, dateStr) {
  const cached = loadCache(sport, dateStr);
  if (cached) {
    console.log(`  [cache] ${sport} ${dateStr}`);
    return cached.fields;
  }

  console.log(`  [fetch] ${sport} ${dateStr}`);
  const sportUpper = sport.toUpperCase();
  const fieldSlotMap = {};
  let dusk = '20:00';

  for (const hour of QUERY_HOURS) {
    const timeStr   = `${hour}:00`;
    const timeLabel = `${hour % 12 || 12}:00 ${hour < 12 ? 'AM' : 'PM'}`;
    const url = `${PARKS_API}?datetime=${dateStr}+${timeStr}`;

    try {
      const data = await get(url);
      if (data.dusk) dusk = data.dusk;
      (data.l || []).forEach((id) => {
        if (!id.toUpperCase().includes(sportUpper)) return;
        if (!fieldSlotMap[id]) fieldSlotMap[id] = new Set();
        fieldSlotMap[id].add(timeLabel);
      });
    } catch (err) {
      console.warn(`    ${dateStr} ${timeStr}: ${err.message}`);
    }

    await sleep(DELAY_MS);
  }

  // Enrich with real park names
  const parkCodes = [...new Set(Object.keys(fieldSlotMap).map(extractParkCode))];
  await enrichParkNames(parkCodes);

  const duskHour = parseDuskHour(dusk);
  const relevantHours = QUERY_HOURS.filter((h) => h <= duskHour);

  const fields = Object.entries(fieldSlotMap).map(([id, availSet]) => {
    const slots = relevantHours.map((h) => {
      const label = `${h % 12 || 12}:00 ${h < 12 ? 'AM' : 'PM'}`;
      return { time: label, available: availSet.has(label) };
    });
    return { ...decodeFieldId(id), slots };
  });

  fields.sort((a, b) => (a.borough + a.fieldName).localeCompare(b.borough + b.fieldName));
  console.log(`    → ${fields.length} ${sport} fields`);

  saveCache(sport, dateStr, { fields });
  return fields;
}

// ── Public API ────────────────────────────────────────────────────────────────

const VALID_SPORTS = ['soccer','baseball','basketball','tennis','softball',
                      'football','cricket','rugby','lacrosse','volleyball',
                      'handball','bocce','hockey','swimming','track'];

async function scrapeAvailability(sport, dates) {
  if (!VALID_SPORTS.includes(sport)) {
    throw new Error(`Unknown sport: ${sport}`);
  }
  loadParkNames();
  const resultsByDate = {};
  for (const dateStr of dates) {
    resultsByDate[dateStr] = await scrapeDay(sport, dateStr);
  }
  return resultsByDate;
}

module.exports = { scrapeAvailability, formatDate };

// ── CLI ───────────────────────────────────────────────────────────────────────
if (require.main === module) {
  const sport = process.argv[2] || 'soccer';
  const date  = process.argv[3] || new Date().toISOString().slice(0, 10);
  console.log(`Scraping ${sport} for ${date}…`);
  scrapeAvailability(sport, [date])
    .then((d) => console.log(JSON.stringify(d, null, 2)))
    .catch(console.error);
}
