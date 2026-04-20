/* NYC Parks Field Availability – frontend app */

'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let currentData = null;   // { dates, fields, sport }
let filteredFields = [];

// ── DOM refs ──────────────────────────────────────────────────────────────────
const form           = document.getElementById('search-form');
const sportInput     = document.getElementById('sport'); // now a <select>
const startInput     = document.getElementById('start-date');
const endInput       = document.getElementById('end-date');
const searchBtn      = document.getElementById('search-btn');
const btnText        = searchBtn.querySelector('.btn-text');
const spinner        = searchBtn.querySelector('.spinner');
const filterRow      = document.getElementById('filter-row');
const boroughFilter  = document.getElementById('borough-filter');
const textFilter     = document.getElementById('text-filter');
const statusBar      = document.getElementById('status-bar');
const statusMsg      = document.getElementById('status-msg');
const statusCount    = document.getElementById('status-count');
const legend         = document.getElementById('legend');
const errorBanner    = document.getElementById('error-banner');
const resultsSection = document.getElementById('results-section');
const resultsTitle   = document.getElementById('results-title');
const gridHead       = document.getElementById('grid-head');
const gridBody       = document.getElementById('grid-body');
const emptyState     = document.getElementById('empty-state');
const exportBtn      = document.getElementById('export-btn');
const cacheInfo      = document.getElementById('cache-info');
const clearCacheBtn  = document.getElementById('clear-cache-btn');
const modalOverlay   = document.getElementById('modal-overlay');
const modalTitle     = document.getElementById('modal-title');
const modalBody      = document.getElementById('modal-body');
const modalClose     = document.getElementById('modal-close');

// ── Init ──────────────────────────────────────────────────────────────────────
(function init() {
  const today = new Date();
  const next7 = new Date(today);
  next7.setDate(today.getDate() + 6);
  startInput.value = fmtDate(today);
  endInput.value   = fmtDate(next7);

  // Sport select — value is read directly from the <select> on submit

  form.addEventListener('submit', onSearch);
  boroughFilter.addEventListener('change', applyFilters);
  textFilter.addEventListener('input', applyFilters);
  exportBtn.addEventListener('click', exportCSV);
  clearCacheBtn.addEventListener('click', clearAllCache);
  modalClose.addEventListener('click', closeModal);
  modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  loadCacheInfo();
})();

// ── Search ────────────────────────────────────────────────────────────────────
async function onSearch(e) {
  e.preventDefault();
  const sport = sportInput.value;
  const start = startInput.value;
  const end   = endInput.value;

  if (!start || !end) return showError('Please select a start and end date.');
  if (new Date(start) > new Date(end)) return showError('Start date must be before end date.');

  const diffDays = (new Date(end) - new Date(start)) / 86400000;
  if (diffDays > 13) return showError('Date range is limited to 14 days to avoid overloading the server.');

  setLoading(true);
  hideError();
  hide(resultsSection);
  hide(emptyState);

  try {
    const url = `/api/availability?sport=${sport}&start=${start}&end=${end}`;
    const res = await fetch(url);
    const json = await res.json();

    if (!res.ok) throw new Error(json.error || 'Server error');
    if (!json.fields || json.fields.length === 0) {
      setLoading(false);
      show(emptyState);
      return;
    }

    currentData = json;
    renderResults(json);
    loadCacheInfo();
  } catch (err) {
    showError(`Error: ${err.message}`);
  } finally {
    setLoading(false);
  }
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderResults(data) {
  const { dates, fields, sport } = data;

  // Populate borough filter — always include the 5 NYC boroughs, plus any
  // extra values returned by the scraper (in case data uses alternate spellings)
  const NYC_BOROUGHS = ['Bronx', 'Brooklyn', 'Manhattan', 'Queens', 'Staten Island'];
  const scraped = fields.map((f) => f.borough).filter(Boolean);
  const boroughs = [...new Set([...NYC_BOROUGHS, ...scraped])].sort();
  boroughFilter.innerHTML = '<option value="">All boroughs</option>' +
    boroughs.map((b) => `<option value="${b}">${b}</option>`).join('');
  textFilter.value = '';

  filteredFields = fields;

  show(filterRow);
  show(legend);
  renderGrid(dates, fields, sport);
  updateStatus(dates, fields);
}

function renderGrid(dates, fields, sport) {
  // ── header row ──
  const headRow = document.createElement('tr');
  headRow.innerHTML = `<th class="col-field">Field / Location</th>`;

  const todayStr = fmtDate(new Date());
  dates.forEach((d) => {
    const dt = new Date(d + 'T12:00:00'); // avoid DST shift
    const dow = dt.toLocaleDateString('en-US', { weekday: 'short' });
    const dom = dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const isToday = d === todayStr;
    const isWeekend = dt.getDay() === 0 || dt.getDay() === 6;
    headRow.innerHTML +=
      `<th><div class="date-header ${isToday ? 'today' : ''} ${isWeekend ? 'weekend' : ''}">` +
      `<div class="dow">${dow}</div><div class="dom">${dom}</div></div></th>`;
  });
  gridHead.innerHTML = '';
  gridHead.appendChild(headRow);

  // ── body ──
  gridBody.innerHTML = '';

  if (fields.length === 0) {
    show(emptyState);
    hide(resultsSection);
    return;
  }

  hide(emptyState);
  show(resultsSection);

  fields.forEach((field) => {
    const tr = document.createElement('tr');

    const metaStr = [field.location, field.borough].filter(Boolean).join(' · ');
    tr.innerHTML =
      `<td class="col-field">` +
      `<div>${escHtml(field.fieldName)}</div>` +
      (metaStr ? `<div class="field-meta">${escHtml(metaStr)}</div>` : '') +
      `</td>`;

    dates.forEach((d) => {
      const slots = (field.slots && field.slots[d]) || [];
      const td = document.createElement('td');
      td.dataset.field = field.fieldName;
      td.dataset.date = d;

      if (slots.length === 0) {
        td.className = 'cell-unknown';
        td.textContent = 'Closed';
      } else {
        const avail = slots.filter((s) => s.available).length;
        const total = slots.length;

        if (avail === 0) {
          td.className = 'cell-booked';
          td.innerHTML = `<span title="0/${total} slots available">Full</span>`;
        } else if (avail === total) {
          td.className = 'cell-available';
          td.innerHTML = `<span title="${avail}/${total} slots available">${avail} open</span>`;
          td.addEventListener('click', () => openModal(field, d, slots));
        } else {
          td.className = 'cell-partial';
          td.innerHTML = `<span title="${avail}/${total} slots available">${avail}/${total}</span>`;
          td.addEventListener('click', () => openModal(field, d, slots));
        }
      }

      tr.appendChild(td);
    });

    gridBody.appendChild(tr);
  });

  resultsTitle.textContent =
    `${sport.charAt(0).toUpperCase() + sport.slice(1)} fields — ` +
    `${dates[0]} to ${dates[dates.length - 1]}`;
}

// ── Filters ───────────────────────────────────────────────────────────────────
function applyFilters() {
  if (!currentData) return;
  const boro = boroughFilter.value.toLowerCase();
  const txt  = textFilter.value.toLowerCase().trim();

  filteredFields = currentData.fields.filter((f) => {
    const matchBoro = !boro || (f.borough || '').toLowerCase() === boro;
    const matchTxt  = !txt  ||
      (f.fieldName || '').toLowerCase().includes(txt) ||
      (f.location  || '').toLowerCase().includes(txt);
    return matchBoro && matchTxt;
  });

  renderGrid(currentData.dates, filteredFields, currentData.sport);
  updateStatus(currentData.dates, filteredFields);
}

// ── Status bar ────────────────────────────────────────────────────────────────
function updateStatus(dates, fields) {
  show(statusBar);
  statusMsg.textContent = `Showing ${fields.length} field${fields.length !== 1 ? 's' : ''}`;
  statusCount.textContent = `across ${dates.length} date${dates.length !== 1 ? 's' : ''}`;
}

// ── Modal ─────────────────────────────────────────────────────────────────────
function openModal(field, dateStr, slots) {
  const dt = new Date(dateStr + 'T12:00:00');
  const label = dt.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  modalTitle.textContent = `${field.fieldName} — ${label}`;

  if (!slots || slots.length === 0) {
    modalBody.innerHTML = `<p class="no-slots">No time slot data available.</p>`;
  } else {
    modalBody.innerHTML =
      `<ul class="slot-list">` +
      slots.map((s) =>
        `<li>` +
        `<span>${escHtml(s.time)}</span>` +
        `<span class="slot-badge slot-badge--${s.available ? 'available' : 'booked'}">` +
        `${s.available ? 'Available' : 'Booked'}` +
        `</span></li>`
      ).join('') +
      `</ul>`;
  }

  show(modalOverlay);
}

function closeModal() {
  hide(modalOverlay);
}

// ── CSV export ────────────────────────────────────────────────────────────────
function exportCSV() {
  if (!currentData) return;
  const { dates, sport } = currentData;
  const fields = filteredFields.length ? filteredFields : currentData.fields;

  const header = ['Field', 'Location', 'Borough', ...dates];
  const rows = fields.map((f) => {
    const cells = dates.map((d) => {
      const slots = (f.slots && f.slots[d]) || [];
      if (slots.length === 0) return 'No data';
      const avail = slots.filter((s) => s.available).length;
      return `${avail}/${slots.length} available`;
    });
    return [f.fieldName, f.location || '', f.borough || '', ...cells];
  });

  const csv = [header, ...rows]
    .map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `nyc-fields-${sport}-${dates[0]}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ── Cache info ────────────────────────────────────────────────────────────────
async function loadCacheInfo() {
  try {
    const res = await fetch('/api/cache/list');
    const files = await res.json();
    cacheInfo.textContent = files.length
      ? `${files.length} cached file${files.length !== 1 ? 's' : ''}`
      : 'empty';
  } catch (_) { cacheInfo.textContent = '—'; }
}

async function clearAllCache() {
  if (!confirm('Clear all cached data? This will force fresh scrapes.')) return;
  const res = await fetch('/api/cache/list');
  const files = await res.json();
  await Promise.all(
    files.map((f) => {
      const [sport, date] = f.file.replace('.json', '').split('_');
      return fetch(`/api/cache?sport=${sport}&date=${date}`, { method: 'DELETE' });
    })
  );
  await loadCacheInfo();
}

// ── Utils ─────────────────────────────────────────────────────────────────────
function fmtDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function show(el) { el.hidden = false; }
function hide(el) { el.hidden = true; }

function setLoading(on) {
  searchBtn.disabled = on;
  btnText.textContent = on ? 'Searching…' : 'Search Fields';
  spinner.hidden = !on;
}

function showError(msg) {
  errorBanner.textContent = msg;
  show(errorBanner);
}

function hideError() { hide(errorBanner); }
