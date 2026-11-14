// dashboard/app.js — renders the board from window.RADAR (data.js, written by main.ts).
// No network: the only data is the snapshot-derived rows in data.js. The detail view
// re-derives each row's implied value from the same formula the model used, so the
// number the page shows is checked against the number board.json carries.

const D = window.RADAR;
const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = { tab: 'pre', q: '', cat: '', chain: '', sort: 'rank', dir: 1 };

// ---------------------------------------------------------------- formatting

function fmtUsd(v) {
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(1) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
  return '$' + Math.round(v).toLocaleString('en-US');
}
function fmtChange(c) {
  if (c === null || c === undefined) return '—';
  return (c >= 0 ? '+' : '') + c.toFixed(1) + '%';
}
function fmtAge(age, known) {
  const base = age >= 365 ? (age / 365).toFixed(1) + 'y' : age + 'd';
  return known ? base : base + ' *';
}
function fmtMultiple(m) {
  return m.toFixed(2) + '×';
}

// ---------------------------------------------------------------- the model, again

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
function growthFactor(change7d) {
  return 1 + clamp(change7d ?? 0, -60, 120) / 100 * 0.5;
}
function maturityFactor(age) {
  return 0.7 + Math.min(age, 730) / 730 * 0.3;
}
function breadthFactor(chains) {
  return 1 + 0.02 * Math.min(Math.max(chains.length - 1, 0), 10);
}
/** The page's own recompute of a row's implied value, from the row's stored inputs. */
function recompute(row) {
  return Math.round(
    row.tvl_usd * row.peer_multiple * growthFactor(row.change_7d) *
      maturityFactor(row.age_days) * breadthFactor(row.chains),
  );
}

// ---------------------------------------------------------------- lists

function currentList() {
  return state.tab === 'pre' ? D.rows : D.live;
}
function visibleRows() {
  const q = state.q.trim().toLowerCase();
  let list = currentList().filter((r) => {
    if (q && !(r.name.toLowerCase().includes(q) || r.slug.toLowerCase().includes(q))) return false;
    if (state.cat && r.category !== state.cat) return false;
    if (state.chain && !r.chains.includes(state.chain)) return false;
    return true;
  });
  const key = state.sort;
  const dir = state.dir;
  const val = (r) =>
    key === 'name' ? r.name.toLowerCase()
    : key === 'change' ? (r.change_7d ?? 0)
    : key === 'tvl' ? r.tvl_usd
    : key === 'age' ? r.age_days
    : key === 'multiple' ? r.peer_multiple
    : key === 'implied' ? r.implied_value_usd
    : r.rank;
  list = [...list].sort((a, b) => {
    const va = val(a), vb = val(b);
    const cmp = typeof va === 'string' ? va.localeCompare(vb) : va - vb;
    return cmp * dir || (a.slug < b.slug ? -1 : 1);
  });
  return list;
}

// ---------------------------------------------------------------- rendering

function rowHtml(r) {
  const badge = r.watchlist
    ? '<span class="badge">★ Watchlist</span>'
    : r.live ? '<span class="badge live">Live token</span>' : '';
  const chg = r.change_7d === null ? '<td>—</td>'
    : `<td class="${r.change_7d >= 0 ? 'up' : 'down'}">${fmtChange(r.change_7d)}</td>`;
  // The table keeps every column on screen: at most three chains, the rest counted.
  const chains = r.chains.length > 3
    ? r.chains.slice(0, 3).join(', ') + ' +' + (r.chains.length - 3)
    : r.chains.join(', ');
  return `<tr data-slug="${esc(r.slug)}">` +
    `<td>${r.rank}</td>` +
    `<td class="name">${esc(r.name)}${badge}<span class="cat">${esc(r.category ?? 'Uncategorised')} · ${esc(chains)}</span></td>` +
    `<td>${fmtUsd(r.tvl_usd)}</td>` +
    chg +
    `<td>${fmtAge(r.age_days, r.age_known)}</td>` +
    `<td>${fmtMultiple(r.peer_multiple)}</td>` +
    `<td><strong>${fmtUsd(r.implied_value_usd)}</strong></td></tr>`;
}

function renderTable() {
  const list = visibleRows();
  $('#rows').innerHTML = list.map(rowHtml).join('');
  const total = currentList().length;
  $('#count').textContent = state.tab === 'pre'
    ? `Showing ${list.length} of ${total} pre-token protocols, ranked by implied value.`
    : `Showing ${list.length} of ${total} protocols whose token already trades, priced by the same model.`;
  $('#empty').hidden = list.length > 0;
  $('#livenote').hidden = state.tab !== 'live';
  document.querySelectorAll('thead th button').forEach((b) => {
    b.classList.toggle('sorted', b.dataset.sort === state.sort);
    b.textContent = b.dataset.sort === state.sort
      ? b.dataset.sortLabel + (state.dir === 1 ? ' ▲' : ' ▼')
      : b.dataset.sortLabel;
  });
}

function renderSpotlight() {
  $('#spotlight').innerHTML = D.rows.slice(0, 3).map((r) =>
    `<article data-slug="${esc(r.slug)}" tabindex="0">` +
    `<div class="rank">Rank ${r.rank} · ${esc(r.category ?? 'Uncategorised')}</div>` +
    `<h3>${esc(r.name)}</h3><div class="val">${fmtUsd(r.implied_value_usd)}</div>` +
    `<div class="sub">TVL ${fmtUsd(r.tvl_usd)} · peer ${fmtMultiple(r.peer_multiple)}</div></article>`,
  ).join('');
}

function fillFilters() {
  const cats = [...new Set([...D.rows, ...D.live].map((r) => r.category).filter(Boolean))].sort();
  $('#cat').innerHTML = '<option value="">All categories</option>' +
    cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  const chains = [...new Set([...D.rows, ...D.live].flatMap((r) => r.chains))].sort();
  $('#chain').innerHTML = '<option value="">All chains</option>' +
    chains.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
}

// ---------------------------------------------------------------- detail view

function findRow(slug) {
  return D.rows.find((r) => r.slug === slug) || D.live.find((r) => r.slug === slug) || null;
}

function openDetail(slug) {
  const r = findRow(slug);
  if (!r) return;
  const again = recompute(r);
  const match = again === r.implied_value_usd;
  const growth = growthFactor(r.change_7d);
  const maturity = maturityFactor(r.age_days);
  const breadth = breadthFactor(r.chains);
  const dlg = $('#detail');
  // The meta line names at most five chains; the count covers the rest.
  const metaChains = r.chains.length > 5
    ? r.chains.slice(0, 5).join(', ') + ' +' + (r.chains.length - 5) + ' more'
    : r.chains.join(', ');
  dlg.innerHTML = `<div class="detail-inner">` +
    `<p class="meta">Rank ${r.rank} · ${esc(r.category ?? 'Uncategorised')} · ${esc(metaChains)}` +
    (r.watchlist ? ' · ★ On the watchlist' : '') + (r.live ? ' · Token already trades' : '') + `</p>` +
    `<h2>${esc(r.name)}</h2>` +
    `<p class="meta">TVL ${fmtUsd(r.tvl_usd)} · 7d ${fmtChange(r.change_7d)} · ` +
    `Age ${fmtAge(r.age_days, r.age_known)}${r.age_known ? '' : ' (no start date reported; 365 days assumed)'}` +
    (r.live && r.mcap_usd ? ` · Market cap ${fmtUsd(r.mcap_usd)}` : '') + `</p>` +
    `<h3>The model, with this protocol's numbers</h3>` +
    `<p class="equation">${fmtUsd(r.tvl_usd)} × ${r.peer_multiple.toFixed(4)} peer × ` +
    `${growth.toFixed(4)} growth × ${maturity.toFixed(4)} maturity × ${breadth.toFixed(2)} breadth` +
    ` = <strong>${fmtUsd(r.implied_value_usd)}</strong></p>` +
    `<p>Peer multiple ${fmtMultiple(r.peer_multiple)}: the median market-cap-per-dollar-of-TVL of ` +
    `the traded ${esc(r.category ?? 'Uncategorised')} protocols` +
    (D.peers[r.category] ? ` (${D.peers[r.category].peers} peers)` : ' — too few traded peers, so the global median is used') +
    `. Growth from its 7-day TVL change, maturity from how long it has run` +
    `${r.age_known ? '' : ' (age assumed)'} with no token, breadth from its ${r.chains.length} chain${r.chains.length === 1 ? '' : 's'}.</p>` +
    `<p class="recompute ${match ? 'ok' : 'bad'}">Recomputed here from the same inputs: ${fmtUsd(again)} — ` +
    (match ? 'the same number board.json carries.' : 'DOES NOT MATCH board.json — do not trust this row.') + `</p>` +
    `<h3>How to farm it</h3><ol>${r.farm_steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` +
    `<button type="button" class="close">Close</button></div>`;
  dlg.querySelector('.close').addEventListener('click', () => dlg.close());
  if (!dlg.open) dlg.showModal();
  // showModal() focuses the Close button and scrolls it into view; pin the
  // dialog back to its top so the protocol's name is what the screenshot shows.
  dlg.scrollTop = 0;
  history.replaceState(null, '', '#p=' + encodeURIComponent(slug));
}

function closeDetail() {
  const dlg = $('#detail');
  if (dlg.open) dlg.close();
  if (location.hash.startsWith('#p=')) history.replaceState(null, '', location.pathname + location.search);
}

// ---------------------------------------------------------------- model panel and footer

function renderModel() {
  $('#factors').innerHTML =
    `<p><b>Peer multiple</b> — median mcap/TVL of the category's traded peers (≥3 peers, else the global median), clamped 0.05–1.50.</p>` +
    `<p><b>Growth</b> — 1 + half the 7-day TVL change, change clamped to −60…+120%; unreported counts as flat.</p>` +
    `<p><b>Maturity</b> — 0.70 at launch, rising to 1.00 after two years running with no token; unknown age counts as 365 days.</p>` +
    `<p><b>Breadth</b> — +2% per extra chain, up to ten extra chains.</p>`;
  const entries = Object.entries(D.peers).sort((a, b) => b[1].multiple - a[1].multiple);
  $('#peers').innerHTML = entries.map(([cat, v]) =>
    `<tr><td>${esc(cat)}</td><td>${v.multiple.toFixed(2)}×</td><td>${v.peers}</td></tr>`,
  ).join('');
  const traded = Object.values(D.peers).reduce((n, v) => n + v.peers, 0);
  $('#modelnote').textContent =
    `Global median ${D.globalMedian.toFixed(4)}× over the snapshot's traded protocols. ` +
    `Categories with fewer than three traded peers are priced at the global median. ` +
    `The multiple is rounded to four decimals before use, so the board, this table and the ` +
    `detail view's recompute all carry the same number. The model prices a launch from the ` +
    `protocol's record as it stands; it does not predict whether or when a token is issued.`;
  const wl = D.rows.filter((r) => r.watchlist).length;
  $('#coverage').textContent =
    `Coverage: ${D.rows.length} protocols — all ${wl} on the watchlist plus ` +
    `${D.rows.length - wl} early finds below the $${(D.floorUsd / 1e6).toFixed(0)}M floor. ` +
    `Snapshot as of ${D.asOf}; ${D.live.length} traded protocols shown on the Live tab for comparison.`;
}

// ---------------------------------------------------------------- events and init

document.querySelectorAll('thead th button').forEach((b) => { b.dataset.sortLabel = b.textContent; });
document.querySelectorAll('thead th button').forEach((b) => {
  b.addEventListener('click', () => {
    if (state.sort === b.dataset.sort) state.dir *= -1;
    else { state.sort = b.dataset.sort; state.dir = 1; }
    renderTable();
  });
});
document.querySelectorAll('.tabs button').forEach((b) => {
  b.addEventListener('click', () => {
    state.tab = b.dataset.tab;
    document.querySelectorAll('.tabs button').forEach((t) =>
      t.setAttribute('aria-selected', String(t === b)));
    renderTable();
  });
});
$('#q').addEventListener('input', (e) => { state.q = e.target.value; renderTable(); });
$('#cat').addEventListener('change', (e) => { state.cat = e.target.value; renderTable(); });
$('#chain').addEventListener('change', (e) => { state.chain = e.target.value; renderTable(); });
document.addEventListener('click', (e) => {
  const row = e.target.closest('tbody tr[data-slug], .spot article[data-slug]');
  if (row) openDetail(row.dataset.slug);
});
$('#detail').addEventListener('close', () => {
  if (location.hash.startsWith('#p=')) history.replaceState(null, '', location.pathname + location.search);
});
$('#detail').addEventListener('click', (e) => {
  if (e.target === $('#detail')) closeDetail();
});

fillFilters();
renderSpotlight();
renderModel();
renderTable();

// A hash opens a detail view (#p=slug) or pre-selects a category (#category=Lending).
(function () {
  const h = location.hash;
  if (h.startsWith('#p=')) {
    openDetail(decodeURIComponent(h.slice(3)));
  } else if (h.startsWith('#category=')) {
    const cat = decodeURIComponent(h.slice(10));
    if ([...$('#cat').options].some((o) => o.value === cat)) {
      $('#cat').value = cat;
      state.cat = cat;
      renderTable();
    }
  }
})();
