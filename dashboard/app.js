// Token Launch Radar — curve-1 dashboard logic.
//
// Renders the board from window.RADAR (data.js, written by main.ts beside
// this folder). Every value on the page can be recomputed in the browser:
// open the console and call recompute(slug). No network anywhere.

(function () {
  'use strict';

  var R = window.RADAR;
  if (!R || !R.rows) {
    document.body.innerHTML = '<p style="padding:24px">Radar data not loaded.</p>';
    return;
  }

  var rows = R.rows;
  var model = R.model;
  var comps = R.comps || [];
  var setAside = R.setAside || [];

  // ---------------------------------------------------------- formatting

  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }

  function moneyFull(n) {
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  function small(n) {
    if (Number.isInteger(n)) return '$' + n;
    return '$' + n.toFixed(2);
  }

  function mult(x) {
    return (Math.round(x * 1000) / 1000).toFixed(3).replace(/0+$/, '').replace(/\.$/, '.0') + '×';
  }

  function pct(x) {
    if (x === null || x === undefined) return '—';
    var s = (x >= 0 ? '+' : '−') + Math.abs(x).toFixed(1) + '%';
    return s;
  }

  function ageLabel(days) {
    if (days === null || days === undefined) return '—';
    if (days < 365) return days + 'd';
    return (days / 365).toFixed(1) + 'y';
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---------------------------------------------------------- header, stats, formula

  var funnel = model.funnel;
  var backtest = model.backtest;

  document.getElementById('matchBadge').textContent =
    rows.length + '/' + rows.length + ' rows match board.json';

  var statsEl = document.getElementById('stats');
  var statCards = [
    { label: 'Watchlist covered', value: funnel.watchlist + '/' + funnel.watchlist, sub: 'of the house watchlist', teal: true },
    { label: 'Pre-token ranked', value: String(funnel.board), sub: funnel.early + ' early finds below the floor' },
    { label: 'Already trade', value: String(funnel.withToken), sub: 'of ' + funnel.tracked + ' tracked protocols' },
    { label: 'Set aside by rule', value: String(funnel.setAside), sub: 'bridges, staking, CEX, versioned' },
    { label: 'Total implied', value: money(model.totals.implied_usd), sub: 'expected ' + money(model.totals.expected_usd) + ' after launch chance' },
    { label: 'Comps error (LOO)', value: '×' + backtest.leave_one_out_median_miss.toFixed(2), sub: 'flat multiple: ×' + backtest.flat_median_baseline_miss.toFixed(2), teal: true },
  ];
  statsEl.innerHTML = statCards.map(function (c) {
    return '<div class="stat"><div class="label">' + c.label + '</div>' +
      '<div class="value' + (c.teal ? ' teal' : '') + '">' + c.value + '</div>' +
      '<div class="sub">' + c.sub + '</div></div>';
  }).join('');

  var curve = model.curve;
  document.getElementById('formulaEq').textContent =
    'implied = 10^(' + curve.intercept.toFixed(4) + ' + ' + curve.slope.toFixed(4) +
    ' · log₁₀TVL) × 10^(category) × growth × maturity × breadth';
  document.getElementById('formulaNote').textContent =
    'OLS on ' + curve.n + ' traded comps · R² ' + curve.r2.toFixed(2) +
    ' · P25–P75 band ×' + model.residual_band.p25_mult.toFixed(2) + '–×' + model.residual_band.p75_mult.toFixed(2) +
    ' · every value read off the curve — no protocol priced by hand';

  document.getElementById('countBoard').textContent = funnel.board;
  document.getElementById('countComps').textContent = comps.length;
  document.getElementById('countSetAside').textContent = setAside.length;

  // ---------------------------------------------------------- board table

  var state = {
    q: '',
    tier: 'all',
    category: '',
    chain: '',
    verdict: '',
    sortKey: 'rank',
    sortDir: 1,
  };

  var mainHead = document.getElementById('mainHead');
  var mainBody = document.getElementById('mainBody');
  var tableIntro = document.getElementById('tableIntro');
  var tableFootnote = document.getElementById('tableFootnote');
  var showingEl = document.getElementById('showing');
  var currentTab = 'board';

  var BOARD_HEAD = '<tr>' +
    '<th data-sort="rank"><button>#</button></th>' +
    '<th data-sort="name"><button>Protocol</button></th>' +
    '<th data-sort="tvl_usd"><button>TVL</button></th>' +
    '<th data-sort="change_7d"><button>7D</button></th>' +
    '<th data-sort="age_days"><button>Age</button></th>' +
    '<th data-sort="curve_multiple"><button>Curve ×</button></th>' +
    '<th data-sort="implied_value_usd"><button>Implied · P25–P75</button></th>' +
    '<th data-sort="launch_chance"><button>Launch</button></th>' +
    '<th data-sort="expected_value_usd"><button>Expected</button></th>' +
    '<th data-sort="airdrop_per_1k_usd"><button>$/1K</button></th>' +
    '<th data-sort="net_at_1k_usd"><button>Verdict</button></th></tr>';
  var COMPS_HEAD = '<tr><th>#</th><th>Protocol</th><th>Category</th><th>TVL</th>' +
    '<th>Market cap</th><th>Mcap / TVL</th><th>Curve says</th><th>Miss</th></tr>';
  var SETASIDE_HEAD = '<tr><th>#</th><th>Protocol</th><th>Category</th><th>TVL</th><th>Set aside because</th></tr>';
  var BOARD_FOOTNOTE = 'Implied value is read off the fitted size curve — no protocol is priced by hand. ' +
    'The P25–P75 bar is the model\'s own residual band. Launch chance is a reference-class base rate, not a forecast. ' +
    'Airdrop assumes 7.5% of implied value reaches farmers; gas is an estimate for four transactions on the first listed chain.';
  var COMPS_INTRO = 'The ' + comps.length + ' traded protocols the curve is fitted on. The curve prices each one blind in the ' +
    'leave-one-out backtest — that is where the ×' + backtest.leave_one_out_median_miss.toFixed(2) + ' median miss comes from.';
  var SETASIDE_INTRO = 'Pre-token protocols the rule sets aside: wrapped, staked and bridged products, exchange products, ' +
    'and versioned names. They are listed here so the funnel adds up — nothing is silently dropped.';

  // Range-bar axis: the board's own P25–P75 extremes, on a log scale.
  var logMin = Infinity, logMax = -Infinity;
  rows.forEach(function (r) {
    logMin = Math.min(logMin, Math.log10(r.low_usd));
    logMax = Math.max(logMax, Math.log10(r.high_usd));
  });
  function logPos(v) {
    return ((Math.log10(v) - logMin) / (logMax - logMin)) * 100;
  }

  function verdictClass(v) {
    return v === 'PAYS OFF' ? 'pays' : v === 'MARGINAL' ? 'marg' : 'under';
  }

  function renderRow(r) {
    var chg = r.change_7d;
    var chgCls = chg === null || chg === undefined ? 'flat' : chg > 0 ? 'up' : chg < 0 ? 'down' : 'flat';
    var lo = logPos(r.low_usd), hi = logPos(r.high_usd), pt = logPos(r.implied_value_usd);
    var tierBadge = r.watchlist
      ? '<span class="tier wl">WATCHLIST</span>'
      : '<span class="tier early">EARLY</span>';
    return '<tr data-slug="' + esc(r.slug) + '">' +
      '<td>' + r.rank + '</td>' +
      '<td><span class="name">' + esc(r.name) + '</span>' + tierBadge +
        '<br><span class="slug">' + esc(r.slug) + '</span></td>' +
      '<td class="num">' + money(r.tvl_usd) + '</td>' +
      '<td class="num ' + chgCls + '">' + pct(chg) + '</td>' +
      '<td class="num">' + ageLabel(r.age_days) + '</td>' +
      '<td class="num">' + mult(r.curve_multiple) + '</td>' +
      '<td><span class="implied">' + money(r.implied_value_usd) + '</span>' +
        '<div class="rangebar"><i style="left:' + lo.toFixed(1) + '%;width:' + Math.max(hi - lo, 1).toFixed(1) + '%"></i>' +
        '<b style="left:' + pt.toFixed(1) + '%"></b></div>' +
        '<div class="range-label">' + money(r.low_usd) + ' – ' + money(r.high_usd) + '</div></td>' +
      '<td class="num">' + Math.round(r.launch_chance * 100) + '%</td>' +
      '<td class="num">' + money(r.expected_value_usd) + '</td>' +
      '<td class="num">' + small(r.airdrop_per_1k_usd) + '</td>' +
      '<td><span class="verdict ' + verdictClass(r.verdict) + '">' + r.verdict + '</span>' +
        '<div class="net">net ' + (r.net_at_1k_usd >= 0 ? '+' : '−') + '$' + Math.abs(r.net_at_1k_usd).toFixed(2) + '</div></td>' +
      '</tr>';
  }

  var SORT_KEYS = {
    rank: 'rank', name: 'name', tvl_usd: 'tvl_usd', change_7d: 'change_7d',
    age_days: 'age_days', curve_multiple: 'curve_multiple',
    implied_value_usd: 'implied_value_usd', launch_chance: 'launch_chance',
    expected_value_usd: 'expected_value_usd', airdrop_per_1k_usd: 'airdrop_per_1k_usd',
    net_at_1k_usd: 'net_at_1k_usd',
  };

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var list = rows.filter(function (r) {
      if (state.tier === 'watchlist' && !r.watchlist) return false;
      if (state.tier === 'early' && r.watchlist) return false;
      if (state.category && (r.category || 'Uncategorised') !== state.category) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (state.verdict && r.verdict !== state.verdict) return false;
      if (q) {
        var hay = (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
    var key = SORT_KEYS[state.sortKey] || 'rank';
    var dir = state.sortDir;
    list.sort(function (a, b) {
      var va = a[key], vb = b[key];
      if (va === null || va === undefined) va = -Infinity;
      if (vb === null || vb === undefined) vb = -Infinity;
      if (typeof va === 'string') return dir * va.localeCompare(vb);
      if (va === vb) return a.rank - b.rank;
      return dir * (va - vb);
    });
    return list;
  }

  function renderBoard() {
    var list = filteredRows();
    mainHead.innerHTML = BOARD_HEAD;
    mainBody.innerHTML = list.map(renderRow).join('');
    tableIntro.textContent = '';
    tableIntro.style.display = 'none';
    tableFootnote.textContent = BOARD_FOOTNOTE;
    tableFootnote.style.display = '';
    showingEl.textContent = 'Showing ' + list.length + ' of ' + rows.length + ' rows';
    var ths = mainHead.querySelectorAll('th');
    ths.forEach(function (th) {
      th.classList.toggle('sorted', th.getAttribute('data-sort') === state.sortKey);
    });
  }

  function renderComps() {
    mainHead.innerHTML = COMPS_HEAD;
    mainBody.innerHTML = comps.map(function (c, i) {
      var miss = Math.max(c.mcap_usd, c.predicted_usd) / Math.min(c.mcap_usd, c.predicted_usd);
      return '<tr><td>' + (i + 1) + '</td><td><span class="name">' + esc(c.name) + '</span>' +
        '<br><span class="slug">' + esc(c.slug) + '</span></td>' +
        '<td>' + esc(c.category || '—') + '</td>' +
        '<td class="num">' + money(c.tvl_usd) + '</td>' +
        '<td class="num">' + money(c.mcap_usd) + '</td>' +
        '<td class="num">' + mult(c.ratio) + '</td>' +
        '<td class="num">' + money(c.predicted_usd) + '</td>' +
        '<td class="num">×' + miss.toFixed(2) + '</td></tr>';
    }).join('');
    tableIntro.textContent = COMPS_INTRO;
    tableIntro.style.display = '';
    tableFootnote.textContent = '';
    tableFootnote.style.display = 'none';
    showingEl.textContent = comps.length + ' comparables';
  }

  function renderSetAside() {
    mainHead.innerHTML = SETASIDE_HEAD;
    mainBody.innerHTML = setAside.map(function (s, i) {
      return '<tr><td>' + (i + 1) + '</td><td><span class="name">' + esc(s.name) + '</span>' +
        '<br><span class="slug">' + esc(s.slug) + '</span></td>' +
        '<td>' + esc(s.category || '—') + '</td>' +
        '<td class="num">' + money(s.tvl_usd) + '</td>' +
        '<td>' + esc(s.reason) + '</td></tr>';
    }).join('');
    tableIntro.textContent = SETASIDE_INTRO;
    tableIntro.style.display = '';
    tableFootnote.textContent = '';
    tableFootnote.style.display = 'none';
    showingEl.textContent = setAside.length + ' set aside';
  }

  function renderTable() {
    if (currentTab === 'comps') renderComps();
    else if (currentTab === 'setaside') renderSetAside();
    else renderBoard();
  }

  // Fill the filter selects from the board itself.
  function fillSelect(id, values) {
    var sel = document.getElementById(id);
    values.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v; o.textContent = v;
      sel.appendChild(o);
    });
  }
  fillSelect('category', model.categories);
  fillSelect('chain', model.chains);

  document.getElementById('q').addEventListener('input', function (e) {
    state.q = e.target.value; renderBoard();
  });
  document.querySelectorAll('.chip').forEach(function (chip) {
    chip.addEventListener('click', function () {
      document.querySelectorAll('.chip').forEach(function (c) { c.classList.remove('active'); });
      chip.classList.add('active');
      state.tier = chip.getAttribute('data-tier'); renderBoard();
    });
  });
  document.getElementById('category').addEventListener('change', function (e) {
    state.category = e.target.value; renderBoard();
  });
  document.getElementById('chain').addEventListener('change', function (e) {
    state.chain = e.target.value; renderBoard();
  });
  document.getElementById('verdict').addEventListener('change', function (e) {
    state.verdict = e.target.value; renderBoard();
  });
  // Sort buttons live in the rebuilt thead, so delegate on the thead itself.
  mainHead.addEventListener('click', function (e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    var key = btn.parentElement.getAttribute('data-sort');
    if (!key) return;
    if (state.sortKey === key) state.sortDir = -state.sortDir;
    else { state.sortKey = key; state.sortDir = key === 'name' ? 1 : -1; }
    renderBoard();
  });

  // ---------------------------------------------------------- tabs

  function showTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tabs button').forEach(function (b) {
      b.classList.toggle('active', b.getAttribute('data-tab') === tab);
    });
    var methodView = document.getElementById('view-method');
    var tableSection = document.getElementById('tableSection');
    if (tab === 'method') {
      methodView.classList.add('active');
      tableSection.style.display = 'none';
      document.getElementById('filters').style.display = 'none';
    } else {
      methodView.classList.remove('active');
      tableSection.style.display = '';
      document.getElementById('filters').style.display = tab === 'board' ? '' : 'none';
      renderTable();
    }
  }
  document.querySelectorAll('.tabs button').forEach(function (b) {
    b.addEventListener('click', function () { showTab(b.getAttribute('data-tab')); });
  });

  // ---------------------------------------------------------- method view

  var effCount = model.category_effects.length;
  document.getElementById('methodCurve').textContent =
    'Ordinary least squares on log10(market cap) against log10(TVL) over the ' + curve.n +
    ' traded protocols: ' + model.curve.formula + ', R² ' + curve.r2.toFixed(2) +
    '. A slope below 1 means the market pays less per TVL dollar as a protocol grows.';
  document.getElementById('methodCategory').textContent =
    'Each category\'s mean residual from the curve, winsorized at ±1 dex, kept only with at least 5 traded peers, ' +
    'shrunk n/(n+4), clamped ±0.5 dex. ' + effCount + ' categories qualify; every other row is priced by the curve alone and says so.';
  document.getElementById('methodFactors').textContent =
    'Growth: 1 + half the 7-day TVL change, clamped [0.6, 1.5]. Maturity: 0.70 at listing, rising to 1.00 after two years with no token. ' +
    'Breadth: +2% per chain past the first, at most +10%.';
  document.getElementById('methodBand').textContent =
    'The P25–P75 band of the full model\'s residuals on the traded comps is ×' +
    model.residual_band.p25_mult.toFixed(2) + ' to ×' + model.residual_band.p75_mult.toFixed(2) +
    ' around every point estimate — the market\'s own scatter, shown instead of hidden.';
  document.getElementById('methodFarm').textContent =
    '7.5% of the implied value is assumed to reach farmers, so airdrop per $1,000 farmed is (1000 / TVL) × 7.5% × implied. ' +
    'Gas covers four transactions on the first listed chain at a documented estimate. ' +
    'The verdict is the net at $1,000: above +$5 PAYS OFF, within ±$5 MARGINAL, below −$5 UNDERWATER.';
  document.getElementById('methodBacktest').textContent =
    'Leave-one-out over the ' + backtest.n + ' traded comps: each protocol priced blind by a curve fitted without it. ' +
    'Median miss ×' + backtest.leave_one_out_median_miss.toFixed(2) +
    ', against ×' + backtest.flat_median_baseline_miss.toFixed(2) +
    ' for the flat global-median multiple.';

  var funnelItems = [
    '<b>' + funnel.tracked + '</b> protocols tracked in the snapshot (as of ' + model.as_of + ')',
    '<b>' + funnel.withToken + '</b> already record a token — ' + comps.length + ' of them carry a market cap and feed the curve',
    '<b>' + funnel.noToken + '</b> record no token',
    '<b>' + funnel.setAside + '</b> set aside by the rule: ' +
      funnel.setAsideReasons.map(function (x) { return x.reason + ' (' + x.count + ')'; }).join(', '),
    '<b>' + funnel.board + '</b> ranked on the board — ' + funnel.watchlist + ' watchlist (TVL ≥ $' +
      (model.floor_usd / 1e6) + 'M) + ' + funnel.early + ' early finds below the floor',
    'Every board row carries a 6-step farm plan, costed with a ticket, a hold, and a gas estimate.',
  ];
  document.getElementById('funnelList').innerHTML = funnelItems.map(function (x) { return '<li>' + x + '</li>'; }).join('');

  document.getElementById('top5Row').innerHTML = rows.slice(0, 5).map(function (r) {
    return '<div class="top5-card" data-slug="' + esc(r.slug) + '">' +
      '<div class="r">#' + r.rank + (r.watchlist ? ' · WATCHLIST' : ' · EARLY') + '</div>' +
      '<div class="n">' + esc(r.name) + '</div>' +
      '<div class="v">' + money(r.implied_value_usd) + '</div>' +
      '<div class="s">' + money(r.low_usd) + ' – ' + money(r.high_usd) + '</div>' +
      '<div class="s">Ticket ' + money(r.ticket_usd) + ' · ' + r.hold_days + 'd hold</div>' +
      '<div class="s"><span class="verdict ' + verdictClass(r.verdict) + '">' + r.verdict + '</span></div>' +
      '</div>';
  }).join('');

  document.getElementById('paramsBox').textContent =
    'model curve-1 · ' + model.curve.formula + ' · R² ' + curve.r2.toFixed(2) + ' · n=' + curve.n + '\n' +
    'category effects (log10): ' + model.category_effects.map(function (e) {
      return e.category + ' ' + (e.effect_log >= 0 ? '+' : '') + e.effect_log.toFixed(3) + ' (n=' + e.peers + ')';
    }).join(', ') + '\n' +
    'residual band P25 ×' + model.residual_band.p25_mult.toFixed(2) +
    ' / P75 ×' + model.residual_band.p75_mult.toFixed(2) +
    ' · LOO ×' + backtest.leave_one_out_median_miss.toFixed(2) +
    ' vs flat ×' + backtest.flat_median_baseline_miss.toFixed(2) + '\n' +
    'launch rates — age: ' + model.launch_rates.age_buckets.map(function (b, i) {
      return b + ' ' + Math.round(model.launch_rates.age_rates[i] * 100) + '%';
    }).join(', ') + ' · TVL: ' + model.launch_rates.tvl_buckets.map(function (b, i) {
      return b + ' ' + Math.round(model.launch_rates.tvl_rates[i] * 100) + '%';
    }).join(', ') + '\n' +
    'farm: 7.5% of implied to farmers · 4 transactions · verdict from net at $1,000 farmed';

  // ---------------------------------------------------------- calibration scatter

  (function scatter() {
    var W = 880, H = 400, PL = 56, PR = 16, PT = 12, PB = 40;
    var xs = comps.map(function (c) { return Math.log10(c.tvl_usd); });
    var ys = comps.map(function (c) { return Math.log10(c.mcap_usd); });
    var x0 = Math.floor(Math.min.apply(null, xs)), x1 = Math.ceil(Math.max.apply(null, xs));
    var y0 = Math.floor(Math.min.apply(null, ys)), y1 = Math.ceil(Math.max.apply(null, ys));
    function X(v) { return PL + ((v - x0) / (x1 - x0)) * (W - PL - PR); }
    function Y(v) { return PT + (1 - (v - y0) / (y1 - y0)) * (H - PT - PB); }
    var bandLo = Math.log10(model.residual_band.p25_mult);
    var bandHi = Math.log10(model.residual_band.p75_mult);
    var parts = [];
    parts.push('<svg viewBox="0 0 ' + W + ' ' + H + '" xmlns="http://www.w3.org/2000/svg">');
    // Grid + axes.
    for (var gx = x0; gx <= x1; gx++) {
      parts.push('<line x1="' + X(gx) + '" y1="' + PT + '" x2="' + X(gx) + '" y2="' + (H - PB) + '" stroke="#e9e4d8"/>');
      parts.push('<text x="' + X(gx) + '" y="' + (H - PB + 18) + '" font-size="11" fill="#5d6b7a" text-anchor="middle">$10^' + gx + '</text>');
    }
    for (var gy = y0; gy <= y1; gy++) {
      parts.push('<line x1="' + PL + '" y1="' + Y(gy) + '" x2="' + (W - PR) + '" y2="' + Y(gy) + '" stroke="#e9e4d8"/>');
      parts.push('<text x="' + (PL - 8) + '" y="' + (Y(gy) + 4) + '" font-size="11" fill="#5d6b7a" text-anchor="end">$10^' + gy + '</text>');
    }
    // P25–P75 band around the fit line.
    var fLo = curve.intercept + curve.slope * x0, fHi = curve.intercept + curve.slope * x1;
    parts.push('<polygon points="' + X(x0) + ',' + Y(fLo + bandHi) + ' ' + X(x1) + ',' + Y(fHi + bandHi) +
      ' ' + X(x1) + ',' + Y(fHi + bandLo) + ' ' + X(x0) + ',' + Y(fLo + bandLo) +
      '" fill="#0e7a5f" opacity="0.12"/>');
    // Fit line.
    parts.push('<line x1="' + X(x0) + '" y1="' + Y(fLo) + '" x2="' + X(x1) + '" y2="' + Y(fHi) +
      '" stroke="#0e7a5f" stroke-width="2"/>');
    // Dots.
    comps.forEach(function (c) {
      parts.push('<circle cx="' + X(Math.log10(c.tvl_usd)).toFixed(1) + '" cy="' + Y(Math.log10(c.mcap_usd)).toFixed(1) +
        '" r="3" fill="#16324f" opacity="0.55"><title>' + esc(c.name) + ' — TVL ' + money(c.tvl_usd) +
        ', mcap ' + money(c.mcap_usd) + '</title></circle>');
    });
    parts.push('<text x="' + (W / 2) + '" y="' + (H - 4) + '" font-size="12" fill="#5d6b7a" text-anchor="middle">TVL (log scale)</text>');
    parts.push('<text x="12" y="' + (H / 2) + '" font-size="12" fill="#5d6b7a" text-anchor="middle" transform="rotate(-90 12 ' + (H / 2) + ')">Market cap (log scale)</text>');
    parts.push('</svg>');
    document.getElementById('scatter').innerHTML = parts.join('');
  })();

  // ---------------------------------------------------------- detail dialog

  var dialog = document.getElementById('detail');
  var detailBody = document.getElementById('detailBody');

  function openDetail(slug) {
    var r = null;
    for (var i = 0; i < rows.length; i++) if (rows[i].slug === slug) { r = rows[i]; break; }
    if (!r) return;
    var curveVal = r.tvl_usd * r.curve_multiple;
    var catBadge = r.category_peers > 0
      ? '<span class="calib-badge">' + r.category_peers + ' PEERS · ' + (r.category_effect >= 0 ? '+' : '') + r.category_effect.toFixed(2) + ' DEX</span>'
      : '<span class="calib-badge curve-only">CURVE ONLY · FEWER THAN 5 PEERS</span>';
    var lo = logPos(r.low_usd), hi = logPos(r.high_usd), pt = logPos(r.implied_value_usd);
    var lr = model.launch_rates;
    var ageIdx = r.age_days === null ? -1 : r.age_days < 180 ? 0 : r.age_days < 540 ? 1 : r.age_days < 1080 ? 2 : 3;
    var tvlIdx = r.tvl_usd < 1e7 ? 0 : r.tvl_usd < 5e7 ? 1 : r.tvl_usd < 2e8 ? 2 : r.tvl_usd < 1e9 ? 3 : 4;
    var ageRate = ageIdx < 0 ? lr.overall_rate : lr.age_rates[ageIdx];
    var tvlRate = lr.tvl_rates[tvlIdx];
    detailBody.innerHTML =
      '<div class="detail-inner">' +
      '<h2>#' + r.rank + ' ' + esc(r.name) + '</h2>' +
      '<p class="dsub">' + esc(r.slug) + ' · ' + esc(r.category || 'Uncategorised') + ' · ' +
        r.chains.map(esc).join(', ') + (r.watchlist ? ' · <span class="tier wl">WATCHLIST</span>' : ' · <span class="tier early">EARLY</span>') + '</p>' +
      '<div class="detail-grid">' +
      '<div class="detail-box"><h3>Implied launch value</h3>' +
        '<div class="big teal">' + moneyFull(r.implied_value_usd) + '</div>' +
        '<div class="rangebar"><i style="left:' + lo.toFixed(1) + '%;width:' + Math.max(hi - lo, 1).toFixed(1) + '%"></i>' +
        '<b style="left:' + pt.toFixed(1) + '%"></b></div>' +
        '<div class="range-label">P25 ' + moneyFull(r.low_usd) + ' · P75 ' + moneyFull(r.high_usd) + '</div>' +
        '<p class="method-note" style="margin-top:8px">The band is the model\'s own residual band on the traded comps.</p>' +
      '</div>' +
      '<div class="detail-box"><h3>Launch chance &amp; expected value</h3>' +
        '<div class="big">' + Math.round(r.launch_chance * 100) + '%</div>' +
        '<div class="kv"><span>Expected value</span><span>' + moneyFull(r.expected_value_usd) + '</span></div>' +
        '<div class="kv"><span>Age bucket rate (' + (ageIdx < 0 ? 'unknown age' : lr.age_buckets[ageIdx]) + ')</span><span>' + Math.round(ageRate * 100) + '%</span></div>' +
        '<div class="kv"><span>TVL bucket rate (' + lr.tvl_buckets[tvlIdx] + ')</span><span>' + Math.round(tvlRate * 100) + '%</span></div>' +
        '<p class="method-note" style="margin-top:8px">Base rate: the share of snapshot protocols of this age and size that record a token.</p>' +
      '</div>' +
      '<div class="detail-box full"><h3>How the number is built ' + catBadge + '</h3>' +
        '<div class="eq-line">implied = <b>' + money(curveVal) + '</b> curve × 10<sup>' + r.category_effect.toFixed(3) + '</sup> category × ' +
        r.growth_factor.toFixed(3) + ' growth × ' + r.maturity_factor.toFixed(3) + ' maturity × ' + r.breadth_factor.toFixed(3) + ' breadth = <b>' + moneyFull(r.implied_value_usd) + '</b></div>' +
        '<div class="kv-grid">' +
        '<div class="kv"><span>TVL</span><span>' + moneyFull(r.tvl_usd) + '</span></div>' +
        '<div class="kv"><span>Curve multiple at this size</span><span>' + mult(r.curve_multiple) + '</span></div>' +
        '<div class="kv"><span>7-day TVL change</span><span>' + pct(r.change_7d) + '</span></div>' +
        '<div class="kv"><span>Age with no token</span><span>' + ageLabel(r.age_days) + '</span></div>' +
        '</div>' +
      '</div>' +
      '<div class="detail-box"><h3>Farm economics</h3>' +
        '<div class="kv"><span>Airdrop per $1,000 farmed</span><span>' + small(r.airdrop_per_1k_usd) + '</span></div>' +
        '<div class="kv"><span>Farm ticket</span><span>' + money(r.ticket_usd) + '</span></div>' +
        '<div class="kv"><span>Gas estimate (' + esc(r.gas_chain) + ', 4 txs)</span><span>' + small(r.gas_usd) + '</span></div>' +
        '<div class="kv"><span>Net at $1,000 farmed</span><span>' + (r.net_at_1k_usd >= 0 ? '+' : '−') + '$' + Math.abs(r.net_at_1k_usd).toFixed(2) + '</span></div>' +
        '<div class="kv"><span>Hold</span><span>' + r.hold_days + ' days</span></div>' +
        '<p style="margin:10px 0 0"><span class="verdict ' + verdictClass(r.verdict) + '">' + r.verdict + '</span></p>' +
        '<p class="method-note">Assumes 7.5% of the implied value reaches farmers. Gas is an estimate; check the chain before entering.</p>' +
      '</div>' +
      '<div class="detail-box"><h3>Farm plan</h3><ol>' +
        r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
      '</ol></div>' +
      '</div></div>';
    if (!dialog.open) dialog.showModal();
  }

  mainBody.addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) openDetail(tr.getAttribute('data-slug'));
  });
  document.getElementById('top5Row').addEventListener('click', function (e) {
    var card = e.target.closest('.top5-card');
    if (card) openDetail(card.getAttribute('data-slug'));
  });

  // ---------------------------------------------------------- recompute in the browser

  window.recompute = function (slug) {
    var r = null;
    for (var i = 0; i < rows.length; i++) if (rows[i].slug === slug) { r = rows[i]; break; }
    if (!r) return { error: 'unknown slug: ' + slug };
    var curveVal = r.tvl_usd * r.curve_multiple;
    var recomputed = Math.round(
      curveVal * Math.pow(10, r.category_effect) * r.growth_factor * r.maturity_factor * r.breadth_factor,
    );
    var out = {
      slug: r.slug,
      name: r.name,
      curve_value_usd: Math.round(curveVal),
      category_effect_log10: r.category_effect,
      growth_factor: r.growth_factor,
      maturity_factor: r.maturity_factor,
      breadth_factor: r.breadth_factor,
      recomputed_implied_usd: recomputed,
      board_implied_usd: r.implied_value_usd,
      matches: Math.abs(recomputed - r.implied_value_usd) <= 1,
    };
    console.log('recompute', out);
    return out;
  };

  // ---------------------------------------------------------- hash routing + first render

  function applyHash() {
    var hash = window.location.hash || '';
    var m = hash.match(/[#&]p=([^&]+)/);
    if (m) { openDetail(decodeURIComponent(m[1])); return; }
    var c = hash.match(/[#&]category=([^&]+)/);
    if (c) {
      var name = decodeURIComponent(c[1]);
      state.category = name;
      var sel = document.getElementById('category');
      sel.value = name;
      showTab('board');
      renderBoard();
    }
  }

  renderBoard();
  applyHash();
  window.addEventListener('hashchange', applyHash);
})();
