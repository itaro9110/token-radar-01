// Token Radar dashboard: sorts, filters, opens a detail view per protocol and re-prices the
// board in the model sandbox — all from window.RADAR, no network, no framework. The implied
// value each row shows is the one main.ts wrote; the sandbox recomputes it with the same
// arithmetic (base x growth x maturity x breadth) so the page and the program always agree.
(function () {
  'use strict';
  var R = window.RADAR;
  if (!R) { document.body.textContent = 'No radar data.'; return; }
  var rows = R.rows.slice();
  var live = R.live.slice();
  var watch = new Set(R.watchlist || []);
  var params = new URLSearchParams(location.search);

  function $(id) { return document.getElementById(id); }
  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function moneyFull(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function pct(v) {
    if (v === null || v === undefined) return '—';
    return (v > 0 ? '+' : '') + v.toFixed(1) + '%';
  }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function ageLabel(d) {
    if (d === null || d === undefined) return '—';
    if (d < 30) return d + 'd';
    if (d < 365) return (d / 30).toFixed(0) + 'mo';
    return (d / 365).toFixed(1) + 'y';
  }

  // ---- header + stats -------------------------------------------------------
  $('meta').innerHTML = 'Snapshot <b>' + esc(R.as_of) + '</b> · DefiLlama · model <b>' + esc(R.model_version) + '</b><br>Overall market multiple <b>' + R.overall_multiple.toFixed(3) + '×</b> · ' + R.calibration.length + ' categories calibrated';
  var top = rows[0];
  $('stats').innerHTML =
    stat('Protocols scanned', R.protocols_total, R.rows.length + ' pre-token ranked') +
    stat('Watchlist', R.watchlist_size, 'pre-token ≥ $50M') +
    stat('Board rows', R.board_size, R.early_size + ' early finds below the floor') +
    stat('Top implied value', top ? money(top.implied_value_usd) : '—', top ? esc(top.name) : '') +
    stat('Live priced', R.live_size, 'market caps calibrate the model');
  function stat(k, v, sub) { return '<div class="stat"><div class="k">' + k + '</div><div class="v">' + v + '</div><div class="k">' + esc(sub) + '</div></div>'; }
  $('src').textContent = 'Source: ' + R.source + '. Floor $' + R.floor_usd.toLocaleString('en-US') + '. Built from the sealed snapshot of ' + R.as_of + '; nothing here fetches the network.';

  // ---- filter selects -------------------------------------------------------
  var cats = {}, chains = {};
  rows.forEach(function (r) { cats[r.category || 'Uncategorised'] = 1; r.chains.forEach(function (c) { chains[c] = 1; }); });
  Object.keys(cats).sort().forEach(function (c) { addOpt($('cat'), c); });
  Object.keys(chains).sort().forEach(function (c) { addOpt($('chain'), c); });
  function addOpt(sel, v) { var o = document.createElement('option'); o.value = v; o.textContent = v; sel.appendChild(o); }

  // ---- board ----------------------------------------------------------------
  var COLS = [
    { k: 'rank', label: '#', cls: 'num' },
    { k: 'name', label: 'Protocol' },
    { k: 'category', label: 'Category' },
    { k: 'chains', label: 'Chains' },
    { k: 'tvl_usd', label: 'TVL', cls: 'num' },
    { k: 'change_7d', label: '7d', cls: 'num' },
    { k: 'age_days', label: 'Age', cls: 'num' },
    { k: 'implied_value_usd', label: 'Implied value', cls: 'num' },
    { k: 'category_multiple', label: 'Multiple', cls: 'num' },
  ];
  var sortKey = 'rank', sortDir = 1;
  var headHtml = COLS.map(function (c) { return '<th data-k="' + c.k + '" class="' + (c.cls || '') + '">' + c.label + (c.k === sortKey ? (sortDir > 0 ? ' ▲' : ' ▼') : '') + '</th>'; }).join('');
  $('headRow').innerHTML = headHtml;
  $('headRow').addEventListener('click', function (e) {
    var k = e.target.getAttribute('data-k');
    if (!k) return;
    if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = (k === 'name' || k === 'category') ? 1 : -1; }
    render();
  });

  // ---- sandbox --------------------------------------------------------------
  var over = { growth_weight: R.model.growth_weight, maturity_floor: R.model.maturity_floor, breadth_per_chain: R.model.breadth_per_chain };
  function sandboxed(r) {
    var g = Math.min(R.model.growth_cap, Math.max(R.model.growth_floor, r.change_7d === null ? 0 : r.change_7d));
    var gm = 1 + (g / 100) * over.growth_weight;
    var age = r.age_days === null ? R.model.unknown_age_days : r.age_days;
    var mm = over.maturity_floor + (Math.min(Math.max(age, 0), R.model.maturity_days) / R.model.maturity_days) * (1 - over.maturity_floor);
    var extra = Math.min(Math.max(r.chains.length - 1, 0), R.model.breadth_max_chains);
    var bm = 1 + over.breadth_per_chain * extra;
    return { implied: Math.max(1, Math.round(r.base_usd * gm * mm * bm)), gm: gm, mm: mm, bm: bm };
  }
  function bindSandbox() {
    var map = [['gw', 'growth_weight', 'gwOut'], ['mf', 'maturity_floor', 'mfOut'], ['bp', 'breadth_per_chain', 'bpOut']];
    map.forEach(function (m) {
      var el = $(m[0]);
      el.value = String(over[m[1]]);
      $(m[2]).textContent = over[m[1]];
      el.addEventListener('input', function () { over[m[1]] = parseFloat(el.value); $(m[2]).textContent = el.value; render(); });
    });
    $('sandboxReset').addEventListener('click', function () {
      over = { growth_weight: R.model.growth_weight, maturity_floor: R.model.maturity_floor, breadth_per_chain: R.model.breadth_per_chain };
      bindSandbox(); render();
    });
  }
  bindSandbox();

  // ---- filtering + rendering --------------------------------------------------
  function filtered() {
    var q = ($('q').value || '').toLowerCase();
    var cat = $('cat').value, ch = $('chain').value, gr = $('growth').value;
    var tvlMin = parseFloat($('tvl').value || '0');
    var wOnly = $('watch').checked;
    var list = rows.map(function (r) {
      var s = sandboxed(r);
      return { r: r, implied: s.implied, gm: s.gm, mm: s.mm, bm: s.bm };
    });
    list = list.filter(function (x) {
      var r = x.r;
      if (wOnly && !watch.has(r.slug)) return false;
      if (cat && (r.category || 'Uncategorised') !== cat) return false;
      if (ch && r.chains.indexOf(ch) < 0) return false;
      if (r.tvl_usd < tvlMin) return false;
      if (gr === 'up' && !(r.change_7d !== null && r.change_7d > 0)) return false;
      if (gr === 'down' && !(r.change_7d !== null && r.change_7d < 0)) return false;
      if (gr === 'hot' && !(r.change_7d !== null && r.change_7d > 10)) return false;
      if (q && (r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0)) return false;
      return true;
    });
    list.sort(function (a, b) {
      var ka = keyOf(a), kb = keyOf(b);
      if (ka === kb) return a.r.slug < b.r.slug ? -1 : 1;
      return (ka < kb ? -1 : 1) * sortDir;
    });
    function keyOf(x) {
      var r = x.r;
      if (sortKey === 'rank') return r.rank;
      if (sortKey === 'implied_value_usd') return x.implied;
      if (sortKey === 'chains') return r.chains.length;
      var v = r[sortKey];
      return v === null || v === undefined ? -Infinity : v;
    }
    return list;
  }

  function render() {
    var list = filtered();
    var rankOf = {};
    rows.slice().sort(function (a, b) { return sandboxed(b).implied - sandboxed(a).implied; }).forEach(function (r, i) { rankOf[r.slug] = i + 1; });
    var html = list.map(function (x) {
      var r = x.r;
      var g = r.change_7d === null ? '—' : '<span class="' + (r.change_7d >= 0 ? 'up' : 'down') + '">' + pct(r.change_7d) + '</span>';
      return '<tr data-slug="' + esc(r.slug) + '"><td class="num">' + rankOf[r.slug] + '</td>' +
        '<td><b>' + esc(r.name) + '</b>' + (watch.has(r.slug) ? '<span class="badge">WATCHLIST</span>' : '') + '<br><span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td><td>' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td><td class="num">' + g + '</td>' +
        '<td class="num">' + ageLabel(r.age_days) + '</td><td class="num"><b>' + money(x.implied) + '</b></td>' +
        '<td class="num">' + r.category_multiple.toFixed(2) + '×</td></tr>';
    }).join('');
    $('rows').innerHTML = html || '<tr><td colspan="9">No protocols match these filters.</td></tr>';
    $('count').textContent = list.length + ' of ' + rows.length + ' protocols shown · sorted by ' + sortKey + ' · click a row for its detail view and farm plan';
    $('headRow').innerHTML = COLS.map(function (c) { return '<th data-k="' + c.k + '" class="' + (c.cls || '') + '">' + c.label + (c.k === sortKey ? (sortDir > 0 ? ' ▲' : ' ▼') : '') + '</th>'; }).join('');
  }
  $('rows').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) openDetail(tr.getAttribute('data-slug'));
  });
  ['q', 'cat', 'chain', 'growth', 'tvl', 'watch'].forEach(function (id) {
    $(id).addEventListener('input', render);
    $(id).addEventListener('change', render);
  });

  // ---- detail view ------------------------------------------------------------
  function openDetail(slug) {
    var r = null;
    for (var i = 0; i < rows.length; i++) if (rows[i].slug === slug) { r = rows[i]; break; }
    if (!r) return;
    var s = sandboxed(r);
    var cal = null;
    R.calibration.forEach(function (c) { if (c.category === (r.category || 'Uncategorised')) cal = c; });
    var comps = live.filter(function (l) { return l.category === r.category && l.multiple !== null; }).slice(0, 3);
    var g = r.change_7d === null ? 0 : Math.min(R.model.growth_cap, Math.max(R.model.growth_floor, r.change_7d));
    var steps = (r.farm_steps || []).map(function (st, i) { return '<li><b>Step ' + (i + 1) + '.</b> ' + esc(st) + '</li>'; }).join('');
    $('detail').innerHTML =
      '<button class="close" type="button" id="dClose">Close ✕</button>' +
      '<h2>' + esc(r.name) + '</h2><p class="sub">' + esc(r.slug) + ' · ' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.join(', ')) + (watch.has(r.slug) ? ' · <span class="badge">WATCHLIST</span>' : '') + '</p>' +
      '<div class="big">' + moneyFull(s.implied) + ' <small>implied value</small></div>' +
      '<p class="sub">Rank #' + r.rank + ' of ' + rows.length + ' · TVL ' + moneyFull(r.tvl_usd) + ' · 7d ' + pct(r.change_7d) + ' · tracked ' + ageLabel(r.age_days) + ' with no token recorded</p>' +
      '<h3>How the value is built</h3><table><thead><tr><th>Factor</th><th class="num">Value</th></tr></thead><tbody>' +
      '<tr><td>TVL</td><td class="num">' + moneyFull(r.tvl_usd) + '</td></tr>' +
      '<tr><td>Category multiple (' + esc(r.category || 'Uncategorised') + ')</td><td class="num">' + r.category_multiple.toFixed(3) + '×</td></tr>' +
      '<tr><td>Base = TVL × multiple</td><td class="num">' + moneyFull(r.base_usd) + '</td></tr>' +
      '<tr><td>Growth ×' + s.gm.toFixed(3) + ' (7d ' + pct(g) + ', weight ' + over.growth_weight + ')</td><td class="num">×' + s.gm.toFixed(3) + '</td></tr>' +
      '<tr><td>Maturity ×' + s.mm.toFixed(3) + ' (' + ageLabel(r.age_days) + ' with no token)</td><td class="num">×' + s.mm.toFixed(3) + '</td></tr>' +
      '<tr><td>Breadth ×' + s.bm.toFixed(3) + ' (' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + ')</td><td class="num">×' + s.bm.toFixed(3) + '</td></tr>' +
      '<tr><td><b>Implied value</b></td><td class="num"><b>' + moneyFull(s.implied) + '</b></td></tr></tbody></table>' +
      (cal ? '<p class="sub">Calibration: ' + cal.live_count + ' live ' + esc(cal.category) + ' protocols price at a median ' + (cal.median_multiple === null ? '—' : cal.median_multiple.toFixed(3) + '×') + ' mcap/TVL (shrunk to ' + cal.multiple.toFixed(3) + '×); the whole market sits at ' + R.overall_multiple.toFixed(3) + '×.</p>' : '') +
      (comps.length ? '<p class="sub">Live comparables in ' + esc(r.category || '') + ': ' + comps.map(function (l) { return esc(l.name) + ' ' + l.multiple.toFixed(2) + '×'; }).join(' · ') + '</p>' : '') +
      '<h3>Farm plan — 8 steps</h3><ol>' + steps + '</ol>' +
      '<p class="sub">The plan is derived from this protocol\'s own record (category, chains, TVL, age). It costs roughly $' + (r.tvl_usd >= 1e9 ? '150' : r.tvl_usd >= 1e8 ? '100' : '50') + ' of capital plus a few dollars of gas. Nothing here is a promise of an airdrop.</p>';
    $('detail').hidden = false;
    $('dClose').addEventListener('click', function () { $('detail').hidden = true; });
  }

  // ---- live view + model view ---------------------------------------------------
  $('liveRows').innerHTML = live.map(function (l) {
    return '<tr><td><b>' + esc(l.name) + '</b><br><span class="slug">' + esc(l.slug) + '</span></td><td>' + esc(l.category || '—') + '</td><td class="num">' + money(l.tvl_usd) + '</td><td class="num">' + (l.mcap_usd === null ? '—' : money(l.mcap_usd)) + '</td><td class="num">' + pct(l.change_7d) + '</td><td class="num">' + (l.multiple === null ? '—' : l.multiple.toFixed(2) + '×') + '</td></tr>';
  }).join('');
  $('calibRows').innerHTML = R.calibration.map(function (c) {
    return '<tr><td>' + esc(c.category) + '</td><td class="num">' + c.live_count + '</td><td class="num">' + (c.median_multiple === null ? '—' : c.median_multiple.toFixed(3) + '×') + '</td><td class="num"><b>' + c.multiple.toFixed(3) + '×</b></td></tr>';
  }).join('');
  $('modelIntro').textContent = 'Implied value = TVL × category multiple × growth × maturity × breadth. The multiple is not a guess: it is the median mcap/TVL of the live-token protocols in each category, shrunk toward the all-market median (' + R.overall_multiple.toFixed(3) + '×) with a prior of ' + R.model.shrink_prior + ' protocols, and clamped to ' + R.model.multiple_floor + '–' + R.model.multiple_cap + '×. Growth is the 7-day TVL change clamped to ' + R.model.growth_floor + '%…+' + R.model.growth_cap + '% at weight ' + R.model.growth_weight + '; maturity rises from ' + R.model.maturity_floor + ' to 1.0 over ' + R.model.maturity_days + ' days with no token; breadth adds ' + R.model.breadth_per_chain + ' per extra chain (max ' + R.model.breadth_max_chains + ').';

  function show(view) {
    $('boardWrap').hidden = view !== 'board';
    $('liveWrap').hidden = view !== 'live';
    $('modelWrap').hidden = view !== 'model';
    $('viewBoard').classList.toggle('on', view === 'board');
    $('viewLive').classList.toggle('on', view === 'live');
    $('viewModel').classList.toggle('on', view === 'model');
  }
  $('viewBoard').addEventListener('click', function () { show('board'); });
  $('viewLive').addEventListener('click', function () { show('live'); });
  $('viewModel').addEventListener('click', function () { show('model'); });

  // ---- deep links for screenshots -----------------------------------------------
  var v = params.get('view');
  if (params.get('q')) $('q').value = params.get('q');
  if (params.get('cat')) $('cat').value = params.get('cat');
  if (params.get('chain')) $('chain').value = params.get('chain');
  if (params.get('growth')) $('growth').value = params.get('growth');
  if (params.get('tvl')) $('tvl').value = params.get('tvl');
  if (params.get('watch') === '1') $('watch').checked = true;
  render();
  if (v === 'live') show('live');
  else if (v === 'model') show('model');
  else show('board');
  if (v === 'detail' && params.get('slug')) openDetail(params.get('slug'));
})();
