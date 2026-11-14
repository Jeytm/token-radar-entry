// The token radar's board, dark. No framework, no network: every figure comes from BOARD in board-data.js.
//
// Structure: one table of ranked rows. A row click opens the detail panel, which walks the model's six
// multipliers for that protocol as bars against their spans, then the farm plan. Category chips filter.
// Column headers sort. No protocol name is ever special-cased: the page renders whatever the model wrote.
'use strict';

const MULT_DEFS = [
  { key: 'growth_multiplier', label: 'Growth', lo: 0.82, hi: 1.36, note: '1 + clamp(7d, -60, 120)/100 x 0.3' },
  { key: 'stability_multiplier', label: 'Stability', lo: 0.7, hi: 1.1, note: '1.0 when 7d is unknown, else clamp(1 - |7d|/2, 0.7, 1.1)' },
  { key: 'maturity_multiplier', label: 'Maturity', lo: 0.6, hi: 1.0, note: '0.6 + min(age days, 1095)/1095 x 0.4' },
  { key: 'category_multiplier', label: 'Category', lo: 0.4, hi: 1.3, note: 'Curator 1.3, DEX & Lending 1.25, Perps 1.2, CEX 0.5, others 1.0' },  { key: 'chain_multiplier', label: 'Chains', lo: 1.0, hi: 1.2, note: '1.2 on 3+ chains, 1.1 on 2, 1.0 on 1' },
  { key: 'watchlist_multiplier', label: 'Watchlist', lo: 1.0, hi: 1.15, note: '1.15 when the snapshot\'s watchlist names it' },
];

const state = { rows: [], view: [], sortKey: 'rank', sortDir: 1, filter: null, openSlug: null };

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const usd = (n) => {
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(a >= 1e8 ? 0 : 1)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n}`;
};
const pct = (n) => `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;

// ---------------------------------------------------------------- chips, stats, table

function renderChips() {
  const counts = new Map();
  for (const r of state.rows) counts.set(r.category, (counts.get(r.category) || 0) + 1);
  const chips = [...counts.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
  const host = $('#filters');
  host.replaceChildren(
    ...chips.map(([cat, n]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.dataset.cat = String(cat);
      b.setAttribute('aria-pressed', state.filter === cat ? 'true' : 'false');
      b.innerHTML = `<span class="chip-dot" aria-hidden="true"></span>${esc(cat)}<span class="chip-n">${n}</span>`;
      b.addEventListener('click', () => {
        state.filter = state.filter === cat ? null : cat;
        renderChips();
        renderRows();
      });
      return b;
    }),
  );
}

function renderStats() {
  const rows = state.rows;
  const wl = rows.filter((r) => r.watchlist).length;
  const multi = rows.filter((r) => r.chains.length >= 3).length;
  const covered = rows.filter((r) => r.chains.some((c) => /ethereum/i.test(c))).length;
  const host = $('#stats');
  const tile = (label, value, sub) => `<div class="stat"><dt>${label}</dt><dd>${value}</dd><span>${sub}</span></div>`;
  host.innerHTML =
    tile('Rows scored', String(rows.length), 'pre-token protocols, bridges and liquid staking excluded') +
    tile('Watchlist covered', `${wl} / ${rows.length}`, 'the snapshot\'s floor, carried whole') +
    tile('Multi-chain', String(multi), 'live on 3 or more chains') +
    tile('Ethereum present', String(covered), 'count Ethereum among their chains') +
    tile('Top implied', usd(rows.length ? rows[0].implied_value_usd : 0), rows.length ? esc(rows[0].name) : '');
}

function sortView() {
  const k = state.sortKey;
  const dir = state.sortDir;
  const val = (r) => (k === 'name' ? r.name.toLowerCase() : k === 'category' ? String(r.category).toLowerCase() : k === 'chains' ? r.chains.length : r[k]);
  state.view.sort((a, b) => {
    const x = val(a);
    const y = val(b);
    const cmp = typeof x === 'string' ? String(x).localeCompare(String(y)) : x - y;
    return cmp * dir || a.rank - b.rank;
  });
}

function renderRows() {
  state.view = state.filter === null ? state.rows.slice() : state.rows.filter((r) => r.category === state.filter);
  sortView();
  const tbody = $('#rows');
  const frag = document.createDocumentFragment();
  for (const r of state.view) {
    const tr = document.createElement('tr');
    tr.dataset.slug = r.slug;
    tr.tabIndex = 0;
    tr.className = 'row' + (state.openSlug === r.slug ? ' row-open' : '');
    const chg = r.change_7d === null ? '<span class="chg chg-none">&ndash;</span>' : `<span class="chg ${r.change_7d >= 0 ? 'chg-up' : 'chg-down'}">${pct(r.change_7d)}</span>`;
    tr.innerHTML =
      `<td class="col-rank"><span class="rank">${r.rank}</span></td>` +
      `<td class="col-name"><span class="pname">${esc(r.name)}</span><span class="pslug">${esc(r.slug)}</span></td>` +
      `<td class="col-cat"><span class="cat">${esc(r.category)}</span></td>` +
      `<td class="col-chains"><span class="chains"><span class="n">${r.chains.length}</span>${esc(r.chains.slice(0, 2).join(', '))}${r.chains.length > 2 ? '&hellip;' : ''}</span></td>` +
      `<td class="col-num">${usd(r.tvl_usd)}</td>` +
      `<td class="col-num col-chg">${chg}</td>` +
      `<td class="col-implied"><span class="implied">${usd(r.implied_value_usd)}</span><span class="bar" aria-hidden="true"><span class="fill" style="width:${barWidth(r)}%"></span></span></td>`;
    tr.addEventListener('click', () => openPanel(r.slug));
    tr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openPanel(r.slug);
      }
    });
    frag.appendChild(tr);
  }
  tbody.replaceChildren(frag);
  const n = state.view.length;
  $('#board-note').innerHTML = n === state.rows.length
    ? `${n} rows &middot; click a row for the model breakdown and the farm plan`
    : `${n} of ${state.rows.length} rows &middot; filtered to ${esc(state.filter)}`;
}

function barWidth(r) {
  const top = state.view[0] ? state.view[0].implied_value_usd : 1;
  return Math.max(2, Math.round((Math.log10(Math.max(r.implied_value_usd, 1)) / Math.log10(Math.max(top, 1))) * 100));
}

// ---------------------------------------------------------------- the detail panel

function multBar(def, value) {
  const lo = Math.log(def.lo);
  const hi = Math.log(def.hi);
  const f = ((Math.log(value) - lo) / (hi - lo)) * 100;
  const w = Math.max(4, Math.min(100, f));
  const neutral = value === 1;
  return (
    `<div class="mult"><div class="mult-head"><span class="mult-name">${def.label}</span>` +
    `<span class="mult-val${neutral ? ' mult-one' : ''}">&times;${value.toFixed(2)}</span></div>` +
    `<div class="mult-bar" aria-hidden="true"><span class="mult-fill${neutral ? ' mult-fill-one' : ''}" style="width:${w.toFixed(1)}%"></span>` +
    `<span class="mult-base" style="left:${(100 * (Math.log(1) - lo) / (hi - lo)).toFixed(1)}%" aria-hidden="true"></span></div>` +
    `<span class="mult-note">${def.note}</span></div>`
  );
}

function openPanel(slug) {
  const r = state.rows.find((x) => x.slug === slug);
  if (!r) return;
  state.openSlug = slug;
  const m = r.model;
  const age = r.age_days !== undefined ? `${r.age_days} days on record${r.listed_at ? ` (listed ${esc(r.listed_at)})` : ' (no listed date; read as a year)'}` : '';
  const chainList = r.chains.map((c) => `<span class="chain-tag">${esc(c)}</span>`).join('');
  $('#panel-kicker').innerHTML = `#${r.rank} &middot; ${esc(r.name)}`;
  $('#panel-body').innerHTML =
    `<div class="panel-hero"><div><span class="panel-rank">Rank ${r.rank}</span>` +
    `${r.watchlist ? '<span class="wl-badge">Watchlist</span>' : ''}</div>` +
    `<div class="panel-implied"><span class="pi-label">Implied value</span><span class="pi-value">${usd(r.implied_value_usd)}</span></div></div>` +
    `<p class="panel-desc"><strong>${esc(r.name)}</strong> &middot; ${esc(r.category)} &middot; TVL ${usd(r.tvl_usd)}` +
    `${r.change_7d === null ? ' &middot; no 7d change on record' : ` &middot; 7d ${pct(r.change_7d)}`} &middot; ${age}.</p>` +
    `<div class="chain-row">${chainList}</div>` +
    `<h3 class="panel-sec">The six multipliers</h3>` +
    `<div class="mults">${MULT_DEFS.map((d) => multBar(d, m[d.key])).join('')}` +
    `<div class="mult math"><div class="mult-head"><span class="mult-name">TVL &times; 0.25 base</span><span class="mult-val">${usd(Math.round(r.tvl_usd * m.base_multiple))}</span></div>` +
    `<div class="mult-bar"><span class="mult-fill mult-fill-solid" style="width:100%"></span></div>` +
    `<span class="mult-note">the starting figure every multiplier above tilts</span></div></div>` +
    `<h3 class="panel-sec">Farm plan</h3><ol class="farm">${r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>`;
  $('#panel').classList.add('panel-show');
  $('#panel').setAttribute('aria-hidden', 'false');
  $('#scrim').hidden = false;
  const open = document.querySelector('.row-open');
  if (open) open.classList.remove('row-open');
  const tr = document.querySelector(`tr[data-slug="${CSS.escape(slug)}"]`);
  if (tr) tr.classList.add('row-open');
  $('#panel-close').focus();
}

function closePanel() {
  state.openSlug = null;
  $('#panel').classList.remove('panel-show');
  $('#panel').setAttribute('aria-hidden', 'true');
  $('#scrim').hidden = true;
  const tr = document.querySelector('.row-open');
  if (tr) {
    tr.classList.remove('row-open');
    tr.focus();
  }
}

// ---------------------------------------------------------------- wiring

function wire() {
  for (const b of document.querySelectorAll('th button[data-sort]')) {
    b.addEventListener('click', () => {
      const k = b.dataset.sort;
      if (state.sortKey === k) state.sortDir = -state.sortDir;
      else {
        state.sortKey = k;
        state.sortDir = k === 'rank' || k === 'implied_value_usd' || k === 'tvl_usd' ? -1 : 1;
      }
      for (const th of document.querySelectorAll('#table th')) {
        th.removeAttribute('aria-sort');
        th.classList.remove('sorted');
      }
      const th = b.closest('th');
      th.setAttribute('aria-sort', state.sortDir === 1 ? 'ascending' : 'descending');
      th.classList.add('sorted');
      renderRows();
    });
  }
  $('#panel-close').addEventListener('click', closePanel);
  $('#scrim').addEventListener('click', closePanel);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.openSlug !== null) closePanel();
  });
}

function boot() {
  const data = typeof BOARD === 'undefined' ? null : BOARD;
  if (!data || !Array.isArray(data.rows)) {
    $('#board-note').textContent = 'No board data found: write board-data.js beside this page (main.ts does).';
    return;
  }
  state.rows = data.rows.slice().sort((a, b) => b.implied_value_usd - a.implied_value_usd);
  $('#meta-asof').textContent = data.as_of;
  $('#meta-source').textContent = data.source;
  document.title = `Token Radar ${data.as_of}: pre-token protocols ranked by implied value`;
  renderStats();
  renderChips();
  renderRows();
  wire();
}

boot();
