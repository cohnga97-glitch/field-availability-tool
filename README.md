# NYC Parks Field Availability Tool

Search and compare athletic field availability across all NYC parks in a single calendar grid view.

## Setup

```bash
npm install   # installs Express + Puppeteer (~300 MB — Chromium is bundled)
npm start     # starts the server at http://localhost:3000
```

Then open **http://localhost:3000** in your browser.

> **First run note:** Puppeteer downloads a ~170 MB Chromium binary during `npm install`. This is required to render the JavaScript-heavy NYC Parks site and avoid 403 errors that block plain HTTP clients.

## Usage

1. Pick a **field type** (soccer, baseball, basketball)
2. Choose a **date range** (up to 14 days)
3. Click **Search Fields** — results appear in a grid with one row per field and one column per date
4. Click any **green/yellow cell** to see individual time slots for that field + date
5. Use the **borough filter** or **text search** to narrow results
6. Click **Export CSV** to download the grid as a spreadsheet

## Architecture

```
field-availability-tool/
├── server.js        Express API server + static file serving
├── scraper.js       Puppeteer-based scraper for nycgovparks.org
├── cache/           JSON cache files (auto-created, 6-hour TTL)
│   └── soccer_2026-04-20.json
└── public/
    ├── index.html   Single-page app shell
    ├── style.css    All styles (CSS variables, sticky grid, modal)
    └── app.js       Frontend logic (fetch, render, filter, CSV export)
```

### Request flow

```
Browser → GET /api/availability?sport=soccer&start=…&end=…
  → server.js: validate params, build date list
    → scraper.js (per date):
        1. Check cache/soccer_YYYY-MM-DD.json (6-hour TTL)
        2. If miss: Puppeteer loads nycgovparks.org/permits/field-and-court/search
        3. Extracts field list from DOM (multiple selector strategies)
        4. Falls back to map page + window variable extraction if list is empty
        5. Saves result to cache
  → Pivot data: date→fields  ➜  field→{date:slots}
  → Return JSON to browser
Browser → renders sticky-header comparison grid
```

### Scraper strategies (in order)

The NYC Parks site structure is not formally documented, so the scraper tries multiple approaches:

1. **Search results page** (`/permits/field-and-court/search?type=Soccer&date=…`) — looks for common result-list CSS selectors
2. **Map page** (`/permits/field-and-court/map?type=Soccer&date=…`) — tries `window.*` data variables, Leaflet marker attributes, inline `<script>` JSON blobs
3. **Per-field detail pages** — if a field row includes a link, follows it and extracts time-slot tables

### Rate limiting

- Minimum **1.2 seconds** between Puppeteer page navigations (`DELAY_MS` in `scraper.js`)
- **6-hour JSON cache** avoids re-scraping unchanged data
- Maximum **14-day** date range enforced by the API to limit burst traffic

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/availability?sport=&start=&end=` | Main data endpoint |
| `GET`  | `/api/sports` | List of supported sports |
| `GET`  | `/api/cache/list` | List cached files |
| `DELETE` | `/api/cache?sport=&date=` | Invalidate one cache entry |

## Known limitations

### Site structure uncertainty
The scraper was written against the public-facing URL structure of `nycgovparks.org/permits/field-and-court`. The NYC Parks site:
- May use heavy client-side JavaScript that changes without notice
- Returns 403 to plain HTTP clients (hence Puppeteer)
- Does not publish a documented API

If the scraper returns empty results, open the browser DevTools Network tab while visiting the site manually and look for XHR/fetch calls — the endpoint or selector patterns may have changed.

### No guaranteed slot data
Time-slot availability (morning / afternoon / evening blocks) is only populated when a field's detail page exposes a structured table or `data-*` attributes. Many fields may show only "open" / "full" status without granular times.

### Session / login walls
Some permit availability details require a logged-in NYC.gov account. The scraper uses a bare (unauthenticated) browser session and will see only the public-facing data.

### Puppeteer on Apple Silicon / Linux
If Puppeteer fails to launch Chromium, try:
```bash
# macOS (Apple Silicon)
PUPPETEER_PLATFORM=mac_arm npm install

# Linux (missing shared libs)
sudo apt-get install -y libgbm-dev libxshmfence-dev
```

### Performance
Puppeteer spins up a full headless browser for each scrape batch. Expect 5–15 seconds per date requested (uncached). The 6-hour cache makes repeat searches fast.

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `PORT`  | `3000`  | HTTP port for the Express server |

You can also edit `DELAY_MS` (line ~14 of `scraper.js`) to increase the politeness delay.
