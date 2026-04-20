# NYC Parks Field Availability Tool

Search and compare athletic field availability across all NYC parks in a single calendar grid view.

**Live demo:** https://web-production-dc256.up.railway.app

## Setup

```bash
npm install   # installs Express only (~5 MB, no browser dependency)
npm start     # starts the server at http://localhost:3000
```

Then open **http://localhost:3000** in your browser.

## Usage

1. Pick a **field type** (15 sports supported: soccer, baseball, basketball, tennis, softball, football, cricket, rugby, lacrosse, volleyball, handball, bocce, hockey, swimming, track)
2. Choose a **date range** (up to 14 days)
3. Click **Search Fields** — results appear in a grid with one row per field and one column per date
4. Cell colors indicate availability level:
   - **Green** — More Availability (>66% of time slots open)
   - **Yellow** — Partial Availability (34–66% of time slots open)
   - **Red** — Low Availability (1–33% of time slots open)
   - **Gray** — Not Available (no permit slots offered for that date)
5. Click any colored cell to see individual time slots for that field + date
6. Use the **borough filter** or **text search** to narrow results
7. Click **Export CSV** to download the grid as a spreadsheet

## Architecture

```
field-availability-tool/
├── server.js        Express API server + static file serving
├── scraper.js       Fetches NYC Parks API + park name lookup + JSON cache
├── cache/           JSON cache files (auto-created, 6-hour TTL)
│   ├── soccer_2026-04-20.json
│   └── park_names.json
└── public/
    ├── index.html   Single-page app shell
    ├── style.css    Styles (CSS variables, sticky grid, modal)
    └── app.js       Frontend logic (fetch, render, filter, CSV export)
```

### Request flow

```
Browser → GET /api/availability?sport=soccer&start=…&end=…
  → server.js: validate params, build date list
    → scraper.js (per date):
        1. Check cache/soccer_YYYY-MM-DD.json (6-hour TTL) → return if fresh
        2. Query NYC Parks API at 7 time slots (8am, 10am, 12pm, 2pm, 4pm, 6pm, 8pm):
             GET nycgovparks.org/api/athletic-fields?datetime=YYYY-MM-DD+H:mm
             → { dusk: "20:15", l: ["M015-SOCCER-1", "X002-SOCCER-1", ...] }
        3. Aggregate available field IDs across all time slots
        4. Look up real park names from NYC Open Data (cached in park_names.json)
        5. Decode field IDs → human-readable names + borough
        6. Save to cache
  → Pivot: date→fields  ➜  field→{date: slots[]}
  → Return JSON to browser
Browser → renders sticky-header comparison grid
```

### How the API was discovered

The NYC Parks site (`/permits/field-and-court/map`) blocks plain HTTP requests with 403. To find the real data source, Puppeteer was used once to load the page and intercept all XHR/fetch network requests. This revealed:

```
GET /api/athletic-fields?datetime=YYYY-MM-DD+H:mm
```

This endpoint accepts standard browser headers and returns JSON directly — no headless browser needed for ongoing use.

### Park name lookup

Field IDs like `M015-SOCCER-1` encode a NYC Parks property number (`M015`). Real park names are resolved by querying the **NYC Open Data Parks Properties dataset** (`data.cityofnewyork.us/resource/enfh-gkve.json`) using the `gispropnum` field. Results are cached permanently in `cache/park_names.json`.

### Rate limiting

- Minimum **1 second** between API requests (`DELAY_MS` in `scraper.js`)
- **6-hour JSON cache** avoids redundant requests
- **7 time slots per day** (every 2 hours) balances coverage vs. speed
- Maximum **14-day** date range enforced server-side

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/availability?sport=&start=&end=` | Main availability data |
| `GET`  | `/api/sports` | List supported sports |
| `GET`  | `/api/cache/list` | List cached files |
| `DELETE` | `/api/cache?sport=&date=` | Invalidate one cache entry |

## Known limitations

### Undocumented API
`/api/athletic-fields` is not a published API — it was reverse-engineered from the map page's network traffic. It may change without notice.

### Availability = permitted slots only
The API returns fields that are available for permitting at a given time. Fields showing "Not Available" are simply not offered by the permit system for that date — they may be closed seasonally, fully booked, under maintenance, or not yet open for booking.

### Hourly granularity
Availability is sampled every 2 hours (7 snapshots/day). A field that opens or closes mid-window may not be captured exactly. Reduce `QUERY_HOURS` in `scraper.js` to 1-hour steps for finer resolution at the cost of speed.

### No login / permit details
The tool shows public availability only. Actual permit application requires a NYC Parks account. Permit pricing, rules, and field-specific restrictions are not shown.

### Cache on Railway
Railway's filesystem is ephemeral — the cache resets on each redeploy. Cold searches (no cache) take ~30 seconds for a 7-day range. This could be improved by adding a persistent database (e.g. Railway's Postgres add-on).

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `PORT`  | `3000`  | HTTP port (Railway sets this automatically) |
