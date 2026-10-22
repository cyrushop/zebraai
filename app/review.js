/* VST business review: POS, pipeline and VAD stock rolled up for a quarterly review.
 *
 * Works in the browser (window.ZReview) and in Node (module.exports). It reuses
 * ZEngine (engine.js) for the pipeline, inventory and backlog exports and adds
 * the Zyme POS exports (2024 layout and the 2025+ "_cc" layout).
 *
 * Value is POS net cost in USD at planned rate. The 2024 export only carries
 * "SIP After rebate", so its net value is SIP ÷ (1 − sell-out rebate %), which
 * reproduces the 2025 net column exactly.
 */
(function (root) {
  'use strict';
  var E = typeof module !== 'undefined' && module.exports ? require('./engine.js') : root.ZEngine;

  // ------------------------------------------------------------- detection
  var POS_QUARTER = ['Invoice Fiscal Quarter', 'Fiscal Quarter (Invoice)'];
  var POS_QTY = ['POS Quantity - Submitted', 'POS Quantity'];

  function isPos(headerRow) {
    var hs = {};
    (headerRow || []).forEach(function (h) { if (h != null) hs[String(h).trim()] = 1; });
    return !!hs['Zebra Part Number'] && POS_QUARTER.some(function (k) { return hs[k]; }) &&
      POS_QTY.some(function (k) { return hs[k]; });
  }

  // Columns read from POS exports (both layouts); everything else is dropped on load.
  var POS_KEEP = [
    'Fiscal Year', 'Fiscal Quarter (Invoice)', 'Fiscal Week', 'Fiscal Month (Invoice)', 'Distributor Name',
    'Distributor Account Number', 'Distributor Country', 'Reseller Account Number', 'Reseller Name (Translated)',
    'End User Name (Translated)', 'Eud User NVL', 'POS Quantity', 'SIP After rebate', 'Product Line-6',
    'Product Line-6-1', 'BU', 'Vertical', 'PC Type',
    'Invoice Fiscal Year', 'Invoice Fiscal Quarter', 'Invoice Fiscal Week', 'POS Invoice Date - Submitted',
    'Submitting Account Number', 'Submitting Account Name', 'Submitting Country', 'Client Account Number',
    'Client Translated Name', 'POS Client Name - Submitted', 'End User Translated Name', 'NVL End User',
    'POS Quantity - Submitted', 'POS Extended Cost (Net) (USD @ Planned Rate)', 'SIP After rabe Amount',
    'Custom Product-Line', 'Custom Sub Product Line', 'Business Division_cc', 'PC type', 'Route To Market',
    'Zebra Part Number', 'Product Family', 'Product Line', 'Sell out rebate%', 'Country'
  ];

  // Find a POS table in a sheet grid (header row is row 0 in 2024, row 2 in the 2025+ detail exports).
  function tableFromGrid(grid, name) {
    var t = E.tableFromGrid(grid, name);
    if (t) return t;
    for (var i = 0; i < Math.min(grid.length, 15); i++) {
      if (!isPos(grid[i])) continue;
      var headers = grid[i].map(function (h) { return h == null ? '' : String(h).trim(); });
      var idx = [];
      headers.forEach(function (h, j) { if (POS_KEEP.indexOf(h) >= 0) idx.push(j); });
      var ci = headers.indexOf('Country');
      var rows = grid.slice(i + 1).filter(function (r) {
        if (!r || !r.some(function (v) { return v !== null && v !== undefined && v !== ''; })) return false;
        // Hong Kong only: the 2026 workbook has a Taiwan sheet with the same layout.
        return ci < 0 || r[ci] == null || /^hong\s*kong$/i.test(String(r[ci]).trim());
      }).map(function (r) { return idx.map(function (j) { return r[j] === undefined ? null : r[j]; }); });
      return { type: 'pos', name: name, headers: idx.map(function (j) { return headers[j]; }), rows: rows };
    }
    return null;
  }

  // A workbook can hold the full POS sheet plus pivot drill-downs of it; keep the
  // biggest POS table per file so the drill-down rows are not counted twice.
  function pickTable(tables) {
    var pos = tables.filter(function (t) { return t.type === 'pos'; });
    if (!pos.length) return tables[0] || null;
    return pos.reduce(function (a, b) { return b.rows.length > a.rows.length ? b : a; });
  }

  // ---------------------------------------------------------------- helpers
  function str(v) { return v == null ? '' : String(v).trim(); }
  function num(v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return v;
    var n = parseFloat(String(v).replace(/[,\s$]/g, ''));
    return isNaN(n) ? 0 : n;
  }
  function pick(o, keys) {
    for (var i = 0; i < keys.length; i++) { var v = o[keys[i]]; if (v != null && v !== '') return v; }
    return null;
  }
  function rowsAsObjects(table) {
    var h = table.headers;
    return table.rows.map(function (r) {
      var o = {};
      for (var i = 0; i < h.length; i++) if (h[i]) o[h[i]] = r[i];
      return o;
    });
  }
  function sum(arr, f) { var s = 0; for (var i = 0; i < arr.length; i++) s += f(arr[i]); return s; }
  function groupBy(arr, f) {
    var m = {};
    arr.forEach(function (x) { var k = f(x); (m[k] = m[k] || []).push(x); });
    return m;
  }
  function distKey(name) { return name ? E.accountKey(name) : 'direct'; }
  var NOT_NAMED = /^(run-?rate( hk)?|unspecified|n\/?a|none|)$/i;

  // ---------------------------------------------------------- POS rows
  var PL_ORDER = ['Mobile Computing', 'Printers', 'Adv Data Capture', 'RFID Devices', 'Supplies', 'Aftermarket'];

  function normPos(table) {
    return rowsAsObjects(table).map(function (o) {
      var qs = str(pick(o, POS_QUARTER)), qm = qs.match(/(\d{4})\s*Q\s*(\d)/i);
      var ws = str(pick(o, ['Invoice Fiscal Week', 'Fiscal Week'])), wm = ws.match(/(\d{4})\s*Week\s*0*(\d+)/i);
      var year = +(str(pick(o, ['Invoice Fiscal Year', 'Fiscal Year'])) || (qm && qm[1]) || 0);
      var q = qm ? +qm[2] : 0, week = wm ? +wm[2] : 0;
      var net = pick(o, ['POS Extended Cost (Net) (USD @ Planned Rate)']), derived = false;
      var sip = num(pick(o, ['SIP After rabe Amount', 'SIP After rebate']));
      if (net == null) {
        var rate = num(o['Sell out rebate%']);
        net = rate < 1 ? sip / (1 - rate) : sip;
        derived = true;
      }
      var dist = str(pick(o, ['Submitting Account Name', 'Distributor Name']));
      var resNo = str(pick(o, ['Client Account Number', 'Reseller Account Number'])).replace(/\.0+$/, '');
      var res = str(pick(o, ['Client Translated Name', 'Reseller Name (Translated)', 'POS Client Name - Submitted']));
      var eu = str(pick(o, ['NVL End User', 'Eud User NVL', 'End User Translated Name', 'End User Name (Translated)']));
      return {
        year: year, q: q, fq: year + ' Q' + q, week: week,
        wk: year * 53 + week,
        date: str(pick(o, ['POS Invoice Date - Submitted', 'Fiscal Month (Invoice)'])).slice(0, 10),
        dist: dist || 'Direct / Tier 1', distKey: distKey(dist),
        resellerKey: resNo && !/unspecified/i.test(resNo) ? resNo : res.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim(),
        reseller: res || 'Unspecified',
        endUser: NOT_NAMED.test(eu) ? '' : eu.toUpperCase(),
        part: str(o['Zebra Part Number']).toUpperCase(),
        family: str(o['Product Family']),
        qty: num(pick(o, POS_QTY)),
        net: num(net), derived: derived,
        pl: str(pick(o, ['Custom Product-Line', 'Product Line-6'])) || str(o['Product Line']) || 'Other',
        spl: str(pick(o, ['Custom Sub Product Line', 'Product Line-6-1'])) || 'Other',
        division: str(pick(o, ['Business Division_cc', 'BU'])),
        project: /^pc$/i.test(str(pick(o, ['PC type', 'PC Type'])))
      };
    }).filter(function (r) { return r.year && r.q && r.part; });
  }

  // Merge POS tables: for each fiscal year, the most recently loaded table that has it wins.
  function buildPos(tables) {
    var owner = {}, out = [], sources = [];
    tables.forEach(function (t, ti) {
      if (t.type !== 'pos') return;
      t._rows = normPos(t);
      var years = {};
      t._rows.forEach(function (r) { years[r.year] = 1; });
      Object.keys(years).forEach(function (y) { owner[y] = ti; });
    });
    tables.forEach(function (t, ti) {
      if (t.type !== 'pos') return;
      var used = t._rows.filter(function (r) { return owner[r.year] === ti; });
      if (used.length) sources.push(t.name);
      out = out.concat(used);
      delete t._rows;
    });
    return { rows: out, sources: sources };
  }

  // Slot used to replace an earlier upload: POS by fiscal years, others as in the order check.
  function posSlot(t) {
    var yi = t.headers.indexOf('Invoice Fiscal Year'), y2 = t.headers.indexOf('Fiscal Year'), ys = {};
    t.rows.forEach(function (r) { var y = r[yi >= 0 ? yi : y2]; if (y) ys[String(y).trim()] = 1; });
    return 'pos|' + Object.keys(ys).sort().join(',');
  }

  // ------------------------------------------------------------ quarters
  function fqOf(d) { return d.getUTCFullYear() + ' Q' + (Math.floor(d.getUTCMonth() / 3) + 1); }
  function addQ(fq, n) {
    var m = fq.match(/(\d{4}) Q(\d)/), i = (+m[1]) * 4 + (+m[2] - 1) + n;
    return Math.floor(i / 4) + ' Q' + (i % 4 + 1);
  }
  function qStartWeek(q) { return (q - 1) * 13 + 1; }

  // --------------------------------------------------------------- review
  /* opts: { today: Date, scope: distributor key ('vstecs', 'all', …), excludeForecast: drop -F / -R opps } */
  function review(tables, opts) {
    opts = opts || {};
    var today = opts.today || new Date(), scope = opts.scope || 'vstecs';
    var ds = E.buildDataset(tables.filter(function (t) { return t.type !== 'pos'; }));
    var pos = buildPos(tables);
    var all = pos.rows;
    var inScope = function (k) { return scope === 'all' || k === scope; };
    var rows = all.filter(function (r) { return inScope(r.distKey); });

    var curFq = fqOf(today), nextFq = addQ(curFq, 1);
    var cy = +curFq.slice(0, 4), cq = +curFq.slice(-1);
    // POS as-of: latest fiscal week loaded for the current year (all distributors).
    var cyRows = all.filter(function (r) { return r.year === cy; });
    var lastWeek = cyRows.reduce(function (m, r) { return Math.max(m, r.week); }, 0);
    var lastDate = cyRows.reduce(function (m, r) { return r.date > m ? r.date : m; }, '');
    var years = Object.keys(groupBy(all, function (r) { return r.year; })).map(Number).sort();
    if (years.indexOf(cy) < 0 && years.length) { cy = years[years.length - 1]; }

    var ctx = { rows: rows, all: all, cy: cy, cq: cq, lastWeek: lastWeek, years: years, scope: scope };
    return {
      today: today, scope: scope, curFq: curFq, nextFq: nextFq, cy: cy, cq: cq,
      asOf: { posWeek: lastWeek, posDate: lastDate, pos: pos.sources, inventory: E.iso(maxDate(ds.inventory, 'asOf')),
        backlog: E.iso(maxDate(ds.backlog, 'asOf')) || E.iso(maxDate(ds.backlog, 'orderDate')),
        pipeline: ds.sources.pipeline || [], inventoryFiles: ds.sources.inventory || [], backlogFiles: ds.sources.backlog || [] },
      scopes: scopeList(all, ds),
      pipeline: pipelineView(ds, curFq, nextFq, inScope, opts.excludeForecast),
      qtd: qtdView(ctx),
      years: yearsView(ctx),
      productLines: plView(ctx),
      partners: partnerView(ctx, ds, curFq, nextFq, inScope),
      inventory: inventoryView(ctx, ds, curFq, nextFq, inScope),
      counts: { pos: all.length, pipeline: ds.pipeline.length, inventory: ds.inventory.length, backlog: ds.backlog.length }
    };
  }

  function maxDate(arr, k) {
    return arr.reduce(function (m, x) { return x[k] && (!m || x[k] > m) ? x[k] : m; }, null);
  }

  function scopeList(all, ds) {
    var by = {};
    all.forEach(function (r) {
      var s = by[r.distKey] || (by[r.distKey] = { key: r.distKey, name: r.dist, net: 0 });
      s.net += r.net;
    });
    ds.pipeline.forEach(function (l) {
      var k = distKey(l.distributor);
      if (!by[k]) by[k] = { key: k, name: l.distributor || 'Direct / Tier 1', net: 0 };
    });
    return Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.net - a.net; });
  }

  // 1. Pipeline: current and next quarter by stage
  var OPEN_STAGES = ['Closed - Won', 'Secure', 'Validate', 'Qualify', 'Identify'];
  var FORECAST_NAME = /-(F|R)\d*\s*$/i;

  function pipelineView(ds, curFq, nextFq, inScope, excludeForecast) {
    var lines = ds.pipeline.map(function (l) {
      return Object.assign({}, l, { q: l.shipDate ? fqOf(l.shipDate) : l.fq.replace(/\s+/g, ' '),
        forecast: FORECAST_NAME.test(l.oppName) });
    }).filter(function (l) {
      return OPEN_STAGES.indexOf(l.stage) >= 0 && inScope(distKey(l.distributor)) && (l.q === curFq || l.q === nextFq) &&
        !(excludeForecast && l.forecast);
    });
    var stages = OPEN_STAGES.map(function (s) {
      var ls = lines.filter(function (l) { return l.stage === s; });
      return { stage: s, cur: sum(ls.filter(isQ(curFq)), amt), next: sum(ls.filter(isQ(nextFq)), amt),
        opps: Object.keys(groupBy(ls, function (l) { return l.oppNo; })).length };
    });
    function isQ(q) { return function (l) { return l.q === q; }; }
    function amt(l) { return l.amount; }
    var opps = groupBy(lines, function (l) { return l.oppNo; });
    var oppRows = Object.keys(opps).map(function (k) {
      var ls = opps[k], l0 = ls[0];
      return { oppNo: k, name: l0.oppName, stage: l0.stage, endUser: l0.endUser, partner: l0.partner,
        distributor: l0.distributor, owner: l0.owner, forecast: l0.forecast,
        cur: sum(ls.filter(isQ(curFq)), amt), next: sum(ls.filter(isQ(nextFq)), amt),
        lines: ls.length, products: ls.map(function (l) { return l.product; }) };
    }).sort(function (a, b) { return (b.cur + b.next) - (a.cur + a.next); });
    var byPl = groupBy(lines, function (l) { return l.productLine || 'Other'; });
    var pl = Object.keys(byPl).map(function (k) {
      return { pl: k, cur: sum(byPl[k].filter(isQ(curFq)), amt), next: sum(byPl[k].filter(isQ(nextFq)), amt) };
    }).sort(function (a, b) { return (b.cur + b.next) - (a.cur + a.next); });
    var byPart = {};
    lines.forEach(function (l) {
      var p = byPart[l.product] || (byPart[l.product] = { qty: 0, amount: 0, opps: {} });
      p.qty += l.qty; p.amount += l.amount; p.opps[l.oppNo] = l.oppName || l.oppNo;
    });
    return {
      loaded: ds.pipeline.length > 0, curFq: curFq, nextFq: nextFq, stages: stages, opps: oppRows, productLines: pl,
      lines: lines, byPart: byPart,
      total: { cur: sum(lines.filter(isQ(curFq)), amt), next: sum(lines.filter(isQ(nextFq)), amt) },
      forecast: { cur: sum(lines.filter(function (l) { return l.forecast && l.q === curFq; }), amt),
        next: sum(lines.filter(function (l) { return l.forecast && l.q === nextFq; }), amt) }
    };
  }

  // 2. QTD: current quarter POS against the same fiscal weeks a year earlier
  function qtdView(c) {
    var start = qStartWeek(c.cq), end = c.lastWeek >= start ? c.lastWeek : start - 1;
    var inQ = function (y, upTo) {
      return function (r) { return r.year === y && r.q === c.cq && (upTo == null || r.week <= upTo); };
    };
    var cur = c.rows.filter(inQ(c.cy)), ly = c.rows.filter(inQ(c.cy - 1, end)), lyFull = c.rows.filter(inQ(c.cy - 1));
    var ly2 = c.rows.filter(inQ(c.cy - 2, end));
    var hkCur = sum(c.all.filter(inQ(c.cy)), net);
    var weeks = [];
    var lastQWeek = Math.max(start + 12, lyFull.reduce(function (m, r) { return Math.max(m, r.week); }, 0));
    for (var w = start; w <= lastQWeek; w++) {
      weeks.push({ week: w, cur: w <= end ? sum(cur.filter(wk(w)), net) : null, ly: sum(lyFull.filter(wk(w)), net) });
    }
    function wk(w) { return function (r) { return r.week === w; }; }
    return {
      fq: c.cy + ' Q' + c.cq, weeksIn: Math.max(0, end - start + 1), weeksTotal: lastQWeek - start + 1,
      fromWeek: start, toWeek: end,
      net: sum(cur, net), qty: sum(cur, qty), ly: sum(ly, net), ly2: sum(ly2, net), lyFull: sum(lyFull, net),
      hkShare: hkCur ? sum(cur, net) / hkCur : null,
      weeks: weeks,
      byPl: compare(cur, ly, function (r) { return r.pl; }, PL_ORDER),
      partners: compare(cur, ly, function (r) { return r.reseller; }).slice(0, 12),
      endUsers: compare(cur.filter(function (r) { return r.endUser; }), ly.filter(function (r) { return r.endUser; }),
        function (r) { return r.endUser; }).slice(0, 12),
      parts: compare(cur, ly, function (r) { return r.part; }).slice(0, 12).map(function (x) {
        x.qty = sum(cur.filter(function (r) { return r.part === x.key; }), qty);
        return x;
      })
    };
  }
  function net(r) { return r.net; }
  function qty(r) { return r.qty; }
  function compare(cur, prev, keyFn, order) {
    var m = {};
    cur.forEach(function (r) { var k = keyFn(r); (m[k] = m[k] || { key: k, cur: 0, prev: 0 }).cur += r.net; });
    prev.forEach(function (r) { var k = keyFn(r); (m[k] = m[k] || { key: k, cur: 0, prev: 0 }).prev += r.net; });
    var out = Object.keys(m).map(function (k) { return m[k]; });
    if (order) return out.sort(function (a, b) { return rank(order, a.key) - rank(order, b.key) || b.cur - a.cur; });
    return out.sort(function (a, b) { return b.cur - a.cur || b.prev - a.prev; });
  }
  function rank(order, k) { var i = order.indexOf(k); return i < 0 ? order.length : i; }

  // 3. Business comparison across fiscal years
  function yearsView(c) {
    var ytd = function (r) { return r.week <= c.lastWeek; };
    var out = c.years.map(function (y) {
      var ys = c.rows.filter(function (r) { return r.year === y; }), hk = c.all.filter(function (r) { return r.year === y; });
      var cum = [], run = 0, byWeek = groupBy(ys, function (r) { return r.week; });
      var maxW = ys.reduce(function (m, r) { return Math.max(m, r.week); }, 0);
      for (var w = 1; w <= 53; w++) { run += sum(byWeek[w] || [], net); cum.push(w <= maxW ? run : null); }
      return {
        year: y, net: sum(ys, net), qty: sum(ys, qty), ytd: sum(ys.filter(ytd), net),
        hk: sum(hk, net), hkYtd: sum(hk.filter(ytd), net),
        quarters: [1, 2, 3, 4].map(function (q) { return sum(ys.filter(function (r) { return r.q === q; }), net); }),
        partners: count(ys, 'resellerKey'), endUsers: count(ys.filter(function (r) { return r.endUser; }), 'endUser'),
        skus: count(ys, 'part'), cum: cum, partial: y === c.cy,
        project: sum(ys.filter(function (r) { return r.project; }), net)
      };
    });
    var byDist = {};
    c.all.forEach(function (r) {
      var d = byDist[r.distKey] || (byDist[r.distKey] = { key: r.distKey, name: r.dist, years: {} });
      d.years[r.year] = (d.years[r.year] || 0) + r.net;
    });
    return { years: out, lastWeek: c.lastWeek, cy: c.cy,
      distributors: Object.keys(byDist).map(function (k) { return byDist[k]; })
        .sort(function (a, b) { return (b.years[c.cy] || 0) - (a.years[c.cy] || 0); }) };
  }
  function count(arr, k) { var s = {}; arr.forEach(function (r) { s[r[k]] = 1; }); return Object.keys(s).length; }

  // 4. Product lines: full year and YTD (same fiscal weeks) per year
  function plView(c) {
    var ytd = function (r) { return r.week <= c.lastWeek; };
    function roll(keyFn, order) {
      var m = {};
      c.rows.forEach(function (r) {
        var k = keyFn(r), o = m[k] || (m[k] = { key: k, pl: r.pl, full: {}, ytd: {}, qty: {} });
        o.full[r.year] = (o.full[r.year] || 0) + r.net;
        o.qty[r.year] = (o.qty[r.year] || 0) + r.qty;
        if (ytd(r)) o.ytd[r.year] = (o.ytd[r.year] || 0) + r.net;
      });
      return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) {
        return order ? rank(order, a.key) - rank(order, b.key) || (b.full[c.cy] || 0) - (a.full[c.cy] || 0)
          : (b.ytd[c.cy] || 0) - (a.ytd[c.cy] || 0);
      });
    }
    return {
      lines: roll(function (r) { return r.pl; }, PL_ORDER),
      subLines: roll(function (r) { return r.pl + ' › ' + r.spl; }).map(function (x) { x.key = x.key.split(' › ')[1]; return x; })
        .sort(function (a, b) { return rank(PL_ORDER, a.pl) - rank(PL_ORDER, b.pl) || (b.ytd[c.cy] || 0) - (a.ytd[c.cy] || 0); }),
      families: roll(function (r) { return r.family || r.part; }).slice(0, 15),
      years: c.years, cy: c.cy, lastWeek: c.lastWeek
    };
  }

  // 5. Partner coverage
  function partnerView(c, ds, curFq, nextFq, inScope) {
    var ytd = function (r) { return r.week <= c.lastWeek; };
    var m = {};
    c.rows.forEach(function (r) {
      var p = m[r.resellerKey] || (m[r.resellerKey] = { key: r.resellerKey, name: r.reseller, full: {}, ytd: {},
        endUsers: {}, last: '', lastYear: 0, plYears: {}, pipeline: 0 });
      if (r.year >= p.lastYear) { p.name = r.reseller; p.lastYear = r.year; }
      p.full[r.year] = (p.full[r.year] || 0) + r.net;
      if (ytd(r)) p.ytd[r.year] = (p.ytd[r.year] || 0) + r.net;
      var py = p.plYears[r.year] || (p.plYears[r.year] = {});
      py[r.pl] = (py[r.pl] || 0) + r.net;
      if (r.year === c.cy && r.endUser) p.endUsers[r.endUser] = 1;
      var stamp = r.year + '-W' + (r.week < 10 ? '0' : '') + r.week;
      if (stamp > p.last) p.last = stamp;
    });
    var list = Object.keys(m).map(function (k) { return m[k]; });

    // Pipeline by channel partner (current + next quarter), matched to POS resellers by name.
    var pipe = {};
    ds.pipeline.forEach(function (l) {
      if (OPEN_STAGES.indexOf(l.stage) < 0 || !inScope(distKey(l.distributor)) || !l.partner) return;
      var q = l.shipDate ? fqOf(l.shipDate) : l.fq;
      if (q !== curFq && q !== nextFq) return;
      pipe[l.partner] = (pipe[l.partner] || 0) + l.amount;
    });
    Object.keys(pipe).forEach(function (name) {
      var hit = list.filter(function (p) { return E.sameEndUser(p.name, name); })[0];
      if (hit) hit.pipeline += pipe[name];
      else list.push({ key: 'pipe:' + name, name: name, full: {}, ytd: {}, endUsers: {}, last: '',
        plYears: {}, pipeline: pipe[name], pipelineOnly: true });
    });

    var cy = c.cy, ly = cy - 1;
    list.forEach(function (p) {
      var a = p.ytd[cy] || 0, b = p.ytd[ly] || 0, earlier = c.years.some(function (y) { return y < cy && p.full[y]; });
      p.endUserCount = Object.keys(p.endUsers).length;
      p.plCy = p.plYears[cy] || {};
      p.plCount = Object.keys(p.plCy).length;
      p.growth = b ? a / b - 1 : null;
      p.status = p.pipelineOnly ? 'pipeline' :
        !a ? (earlier ? 'lapsed' : 'none') :
        !earlier ? 'new' :
        !b ? 'returning' :
        a >= b * 1.1 ? 'growing' : a <= b * 0.9 ? 'declining' : 'steady';
    });
    list.sort(function (x, y) { return (y.full[cy] || 0) - (x.full[cy] || 0) || (y.full[ly] || 0) - (x.full[ly] || 0) || y.pipeline - x.pipeline; });

    var active = function (y) { return list.filter(function (p) { return p.full[y] > 0; }).length; };
    var cyTotal = sum(list, function (p) { return p.full[cy] || 0; });
    var top5 = sum(list.slice(0, 5), function (p) { return p.full[cy] || 0; });
    var byStatus = groupBy(list, function (p) { return p.status; });
    return {
      list: list, cy: cy, years: c.years, lastWeek: c.lastWeek,
      activeByYear: c.years.map(function (y) { return { year: y, n: active(y) }; }),
      top5Share: cyTotal ? top5 / cyTotal : null,
      statusCount: Object.keys(byStatus).reduce(function (o, k) { o[k] = byStatus[k].length; return o; }, {}),
      lapsedValue: sum(byStatus.lapsed || [], function (p) { return p.full[ly] || 0; }),
      pls: PL_ORDER
    };
  }

  // 6. Inventory: stock vs reseller backlog, sell-out run rate and pipeline demand
  var DAY = 864e5;
  function inventoryView(c, ds, curFq, nextFq, inScope) {
    var parts = {};
    function P(part) {
      return parts[part] || (parts[part] = { part: part, onHand: 0, committed: 0, value: 0, backlog: 0, backlogLines: 0,
        oldest: null, u13: 0, u26: 0, u13run: 0, n13weeks: {}, pipeQty: 0, pipeOpps: {}, family: '', pl: '' });
    }
    var inv = ds.inventory.filter(function (r) { return inScope(distKey(r.dist)); });
    var bl = ds.backlog.filter(function (r) { return inScope(distKey(r.dist)); });
    inv.forEach(function (r) { var p = P(r.part); p.onHand += r.onHand; p.committed += r.committed; p.value += r.onHand * r.unit; });
    bl.forEach(function (b) {
      var p = P(b.part); p.backlog += b.qty; p.backlogLines++;
      if (b.orderDate && (!p.oldest || b.orderDate < p.oldest)) p.oldest = b.orderDate;
    });
    // Sell-out run rate: the latest 13 and 26 fiscal weeks of POS in scope.
    var latest = c.rows.reduce(function (m, r) { return Math.max(m, r.wk); }, 0);
    c.rows.forEach(function (r) {
      var age = latest - r.wk;
      if (age >= 26) return;
      var p = parts[r.part] || (age < 13 ? P(r.part) : null);
      if (!p) return;
      p.u26 += r.qty;
      if (age < 13) { p.u13 += r.qty; p.n13weeks[r.wk] = 1; if (!r.project) p.u13run += r.qty; }
      p.family = p.family || r.family; p.pl = p.pl || r.pl;
    });
    c.rows.forEach(function (r) { var p = parts[r.part]; if (p) { p.family = p.family || r.family; p.pl = p.pl || r.pl; } });
    ds.pipeline.forEach(function (l) {
      // Open Secure / Validate demand; Won lines are already ordered.
      if (['Secure', 'Validate'].indexOf(l.stage) < 0 || !inScope(distKey(l.distributor))) return;
      var q = l.shipDate ? fqOf(l.shipDate) : l.fq;
      if (q !== curFq && q !== nextFq) return;
      var p = parts[l.product];
      if (!p) return;
      p.pipeQty += l.qty; p.pipeOpps[l.oppNo] = l.oppName || l.oppNo;
    });

    var asOf = maxDate(inv, 'asOf') || maxDate(bl, 'asOf') || new Date();
    var list = Object.keys(parts).map(function (k) {
      var p = parts[k];
      p.unit = p.onHand ? p.value / p.onHand : 0;
      p.free = p.onHand - p.committed - p.backlog;
      p.weekly = p.u13 / 13;
      p.cover = p.weekly > 0 ? Math.max(0, p.free) / p.weekly : null;
      p.oldestDays = p.oldest ? Math.round((asOf - p.oldest) / DAY) : null;
      p.weeksSold = Object.keys(p.n13weeks).length;
      delete p.n13weeks;
      classify(p);
      return p;
    }).filter(function (p) { return p.onHand || p.backlog || p.status === 'stock-gap'; });
    list.sort(function (a, b) { return STATUS_RANK[a.status] - STATUS_RANK[b.status] || b.value - a.value || b.u13 - a.u13; });

    var stocked = list.filter(function (p) { return p.onHand > 0; });
    var totalValue = sum(stocked, function (p) { return p.value; });
    var by = groupBy(list, function (p) { return p.status; });
    var val = function (s) { return sum(by[s] || [], function (p) { return p.value; }); };
    return {
      loaded: ds.inventory.length > 0 || ds.backlog.length > 0, asOf: asOf,
      list: list, totalValue: totalValue, skus: stocked.length,
      units: sum(stocked, function (p) { return p.onHand; }),
      backlogUnits: sum(bl, function (b) { return b.qty; }), backlogLines: bl.length,
      backlogOrders: Object.keys(groupBy(bl, function (b) { return b.resellerOrder; })).length,
      counts: Object.keys(by).reduce(function (o, k) { o[k] = by[k].length; return o; }, {}),
      slowValue: val('no-sales') + val('slow') + val('overstock'),
      weeklySell: sum(stocked, function (p) { return p.weekly * p.unit; })
    };
  }

  var STATUS_RANK = { short: 0, 'stock-gap': 1, 'no-sales': 2, overstock: 3, slow: 4, low: 5, 'pipeline-gap': 6, healthy: 7, reserved: 8 };
  function classify(p) {
    var r = [];
    if (p.free < 0) {
      p.status = 'short';
      r.push('Reseller backlog is ' + (-p.free) + ' more than stock. Confirm the Zebra order and ETA cover it; expedite or offer an alternative.');
    } else if (!p.onHand && p.u13run >= 10 && p.weeksSold >= 3) {
      p.status = 'stock-gap';
      r.push('Sold ' + p.u13run + ' run-rate units in ' + p.weeksSold + ' of the last 13 weeks, none in stock. Consider stocking ~' +
        Math.ceil(p.u13run / 13 * 6) + ' (6 weeks).');
    } else if (p.free === 0 && p.backlog > 0) {
      p.status = 'reserved';
      r.push('All stock is held for reseller backlog' + (p.oldestDays > 30 ? '; oldest order ' + p.oldestDays + ' days. Ship it.' : '.'));
    } else if (p.free > 0 && p.u26 === 0) {
      p.status = 'no-sales';
      r.push('No sell-out in 26 weeks. Push to partners (bundle or promo), match to pipeline, or ask Zebra about stock rotation.');
    } else if (p.free > 0 && p.u13 === 0) {
      p.status = 'slow';
      r.push('No sell-out in the last 13 weeks (' + p.u26 + ' in the 13 before). Offer it to the partners who bought it.');
    } else if (p.cover != null && p.cover > 13) {
      p.status = 'overstock';
      r.push(Math.round(p.cover) + ' weeks of cover. Hold replenishment; feature it in partner promotions.');
    } else if (p.cover != null && p.cover < 4) {
      p.status = 'low';
      r.push('About ' + p.cover.toFixed(1) + ' weeks of cover. Replenish ~' + Math.max(1, Math.ceil(p.weekly * 8 - p.free)) + ' for 8 weeks.');
    } else {
      p.status = 'healthy';
      r.push(Math.round(p.cover) + ' weeks of cover.');
    }
    if (p.pipeQty > 0) {
      var free = Math.max(0, p.free);
      if (p.pipeQty > free) {
        r.push('Pipeline needs ' + p.pipeQty + ' (' + Object.keys(p.pipeOpps).length + ' opp' + (Object.keys(p.pipeOpps).length > 1 ? 's' : '') +
          '); ' + (free ? 'stock covers ' + free + '.' : 'nothing free.'));
        if (p.status === 'healthy' || p.status === 'low') p.status = 'pipeline-gap';
      } else {
        r.push('Free stock covers pipeline (' + p.pipeQty + '). Steer the open opps to VAD stock.');
      }
    }
    if (p.backlog > 0 && p.free >= 0 && p.oldestDays > 45 && p.status !== 'reserved') {
      r.push('Oldest reseller order is ' + p.oldestDays + ' days old.');
    }
    p.advice = r;
  }

  var api = {
    isPos: isPos, tableFromGrid: tableFromGrid, pickTable: pickTable, normPos: normPos, buildPos: buildPos,
    posSlot: posSlot, review: review, fqOf: fqOf, addQ: addQ, PL_ORDER: PL_ORDER, POS_KEEP: POS_KEEP
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ZReview = api;
})(this);
