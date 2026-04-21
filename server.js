/**
 * NYC Parks Field Availability – Express server
 *
 * GET /api/availability?sport=soccer&start=2026-04-20&end=2026-04-27
 *   → { dates: ["2026-04-20",...], fields: [{fieldName,slots:{date:[{time,available}]}}] }
 *
 * GET /api/sports  → ["soccer","baseball","basketball"]
 *
 * POST /api/clear-cache  → clears the JSON cache for a sport+date
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const { scrapeAvailability, formatDate } = require('./scraper');

const app = express();
const PORT = process.env.PORT || 3000;
const CACHE_DIR = path.join(__dirname, 'cache');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── helpers ───────────────────────────────────────────────────────────────────

function dateRange(start, end) {
  const dates = [];
  const cur = new Date(start);
  const last = new Date(end);
  while (cur <= last) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

function mergeBySport(resultsByDate) {
  // Pivot from { date -> fields[] } to { fieldName -> { date -> slots[] } }
  const fieldMap = {};

  for (const [date, fields] of Object.entries(resultsByDate)) {
    for (const f of fields) {
      const key = f.fieldId ? `${f.fieldId}` : f.fieldName;
      if (!fieldMap[key]) {
        fieldMap[key] = {
          fieldName: f.fieldName,
          fieldId: f.fieldId,
          location: f.location,
          borough: f.borough,
          slots: {},
        };
      }
      fieldMap[key].slots[date] = f.slots || [];
    }
  }

  return Object.values(fieldMap);
}

// ── routes ────────────────────────────────────────────────────────────────────

app.get('/api/sports', (_req, res) => {
  res.json(['soccer','baseball','basketball','tennis','softball',
            'football','cricket','rugby','lacrosse','volleyball',
            'handball','bocce','hockey','swimming','track']);
});

app.get('/api/availability', async (req, res) => {
  const { sport, start, end } = req.query;

  if (!sport || !start || !end) {
    return res.status(400).json({ error: 'sport, start, and end are required' });
  }
  const validSports = ['soccer','baseball','basketball','tennis','softball',
                       'football','cricket','rugby','lacrosse','volleyball',
                       'handball','bocce','hockey','swimming','track'];
  if (!validSports.includes(sport)) {
    return res.status(400).json({ error: 'Unknown sport' });
  }

  const startDate = new Date(start);
  const endDate = new Date(end);
  if (isNaN(startDate) || isNaN(endDate) || startDate > endDate) {
    return res.status(400).json({ error: 'Invalid date range' });
  }

  const dates = dateRange(formatDate(start), formatDate(end));

  try {
    const raw = await scrapeAvailability(sport, dates);
    const fields = mergeBySport(raw);
    res.json({ dates, fields, sport, scrapedAt: new Date().toISOString() });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/cache', (req, res) => {
  const { sport, date } = req.query;
  if (!sport || !date) {
    return res.status(400).json({ error: 'sport and date required' });
  }
  const file = path.join(CACHE_DIR, `${sport}_${date}.json`);
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
    res.json({ cleared: file });
  } else {
    res.json({ cleared: null, message: 'No cache file found' });
  }
});

app.get('/api/cache/list', (_req, res) => {
  if (!fs.existsSync(CACHE_DIR)) return res.json([]);
  const files = fs.readdirSync(CACHE_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      const stat = fs.statSync(path.join(CACHE_DIR, f));
      return { file: f, sizeKB: Math.round(stat.size / 1024), mtime: stat.mtime };
    });
  res.json(files);
});

// ── start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`Field availability tool running at http://localhost:${PORT}`);
  console.log('Open your browser to get started.');
});
