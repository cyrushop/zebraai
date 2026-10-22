/* Page logic: load workbooks, keep them in IndexedDB, draw the summaries. */
(function () {
  'use strict';
  var TABS = ['overview', 'products', 'channel', 'customers', 'notes'];
  var COLORS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s6)', 'var(--s7)', 'var(--s8)'];
  var $ = function (id) { return document.getElementById(id); };
  var state = { sheets: [], result: null, S: null, tab: 'overview', scope: 'all' };

  // ---------------------------------------------------------------- storage
  function db() {
    return new Promise(function (ok, fail) {
      var r = indexedDB.open('zebra-hk-pos', 1);
      r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
      r.onsuccess = function () { ok(r.result); };
      r.onerror = function () { fail(r.error); };
    });
  }
  function save() {
    return db().then(function (d) {
      return new Promise(function (ok) {
        var tx = d.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(state.sheets, 'sheets');
        tx.oncomplete = ok; tx.onerror = ok;
      });
    }).catch(function () {});
  }
  function load() {
    return db().then(function (d) {
      return new Promise(function (ok) {
        var g = d.transaction('kv').objectStore('kv').get('sheets');
        g.onsuccess = function () { ok(g.result || []); };
        g.onerror = function () { ok([]); };
      });
    }).catch(function () { return []; });
  }

  // ---------------------------------------------------------------- files
  function readFile(f) {
    return f.arrayBuffer().then(function (buf) {
      var wb = XLSX.read(buf, { type: 'array' });
      return wb.SheetNames.map(function (n) {
        return { file: f.name, sheet: n, grid: XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: null }) };
      }).filter(function (s) { return ZPos.readSheet(s); });
    });
  }
  function addFiles(list) {
    var files = Array.prototype.slice.call(list || []);
    if (!files.length) return;
    $('status').textContent = 'Reading ' + files.length + ' file' + (files.length > 1 ? 's' : '') + '…';
    Promise.all(files.map(function (f) {
      return readFile(f).catch(function () { return { error: f.name }; });
    })).then(function (res) {
      var bad = [];
      res.forEach(function (sheets, i) {
        if (sheets.error || !sheets.length) { bad.push(files[i].name); return; }
        var name = files[i].name;
        state.sheets = state.sheets.filter(function (s) { return s.file !== name; }).concat(sheets);
      });
      rebuild();
      save();
      $('status').textContent = bad.length
        ? 'No POS sheet found in: ' + bad.join(', ') + '. The others were added.'
        : 'Added ' + files.length + ' file' + (files.length > 1 ? 's' : '') + '.';
    });
  }
  function rebuild() {
    state.result = state.sheets.length ? ZPos.combine(state.sheets) : null;
    state.S = state.result && state.result.lines.length ? ZPos.summarize(state.result.lines) : null;
    $('btn-csv').disabled = $('btn-clear').disabled = !state.S;
    $('empty').hidden = !!state.S;
    $('main').hidden = !state.S;
    drawFiles();
    render();
  }
  function drawFiles() {
    var ul = $('used');
    ul.replaceChildren();
    if (!state.result) return;
    state.result.used.forEach(function (u) {
      var li = document.createElement('li');
      var b = document.createElement('b');
      b.textContent = u.year;
      li.appendChild(b);
      li.appendChild(document.createTextNode(': ' + u.file + ' › ' + u.sheet + ' · ' + u.quarters.join(' ') + ' · ' +
        ZC.num(u.rows) + ' lines · ' + ZC.usdFull(u.sales)));
      ul.appendChild(li);
    });
    state.result.skipped.forEach(function (s) {
      var li = document.createElement('li');
      li.textContent = 'Skipped ' + s.file + ' › ' + s.sheet + ': ' + s.reason;
      ul.appendChild(li);
    });
  }

  // ---------------------------------------------------------------- drawing
  var S = function () { return state.S; };
  var years = function () { return S().years; };
  var yLabel = function (y) { return state.scope === 'q4' ? 'Q4 ' + y : String(y); };
  var yearColor = function (y) { return COLORS[years().indexOf(y) % COLORS.length]; };
  var yearSeries = function () { return years().map(function (y) { return { name: yLabel(y), color: yearColor(y), year: y }; }); };
  var inScope = function (rows) { return rows.filter(function (r) { return r.scope === state.scope; }); };
  var find = function (rows, f) { return rows.find(f) || {}; };

  function kpi(id, label, k, fmt, vsLabel) {
    $(id + '-l').textContent = label;
    $(id).textContent = fmt(k.value);
    var d = $(id + '-d');
    d.replaceChildren();
    var sp = document.createElement('span');
    sp.textContent = ZC.pct(k.change);
    sp.className = k.change > 0 ? 'up' : k.change < 0 ? 'down' : '';
    d.appendChild(sp);
    d.appendChild(document.createTextNode(' ' + vsLabel));
  }

  function drawHeader() {
    var s = S(), k = s.kpi;
    var t = $('takeaway');
    t.replaceChildren();
    var add = function (text, bold, cls) {
      var el = document.createElement(bold ? 'b' : 'span');
      el.textContent = text;
      if (cls) el.className = cls;
      t.appendChild(el);
    };
    add('FY' + s.last + ' sell-out was ');
    add(ZC.usd(k.sales.value), true);
    add(', ');
    add(ZC.pct(k.sales.change), true);
    add(' against FY' + s.prev);
    if (s.first !== s.prev) { add(' and '); add(ZC.pct(k.vsFirst.change), true); add(' against FY' + s.first); }
    add('. Q4 ' + s.last + ' was ');
    add(ZC.usd(k.q4.value), true);
    add(' (' + ZC.pct(k.q4.change) + ' vs Q4 ' + s.prev + ').');

    kpi('k-sales', 'FY' + s.last + ' sales', k.sales, ZC.usd, 'vs FY' + s.prev);
    kpi('k-q4', 'Q4 ' + s.last + ' sales', k.q4, ZC.usd, 'vs Q4 ' + s.prev);
    kpi('k-first', 'FY' + s.last + ' vs FY' + s.first, { value: k.vsFirst.change, change: k.vsFirst.change }, ZC.pct, 'FY' + s.first + ' was ' + ZC.usd(k.vsFirst.prior));
    kpi('k-qty', 'FY' + s.last + ' units', k.qty, ZC.num, 'vs FY' + s.prev);
    kpi('k-eu', 'FY' + s.last + ' end users buying', k.endUsers, ZC.num, 'vs FY' + s.prev);
  }

  function drawOverview() {
    var ys = years(), rows = inScope(S().yearly);
    $('n-yearly').textContent = state.scope === 'q4' ? 'Q4 of each year only, SIP after rebate in USD.' : 'Full fiscal years, SIP after rebate in USD. Shaded bars have fewer than four quarters loaded.';
    var by = function (y) { return find(rows, function (r) { return r.year === y; }); };
    ZC.columns($('ch-yearly'), {
      groups: ys.map(yLabel), series: [{ name: 'Sales', color: COLORS[0] }], labels: true,
      value: function (gi) { return by(ys[gi]).sales; },
      faded: function (gi) { return state.scope === 'all' && by(ys[gi]).quarters < 4; },
      groupNote: state.scope === 'all' ? function (gi) { var q = by(ys[gi]).quarters; return q < 4 ? q + ' quarter' + (q > 1 ? 's' : '') : null; } : null,
      tipExtra: function (gi) { return [{ name: 'Units', value: ZC.num(by(ys[gi]).qty || 0) }, { name: 'End users', value: ZC.num(by(ys[gi]).end_users || 0) }]; }
    });
    var q = S().quarterly;
    ZC.columns($('ch-quarterly'), {
      groups: q.map(function (r) { return r.period; }), series: [{ name: 'Sales', color: COLORS[0] }],
      value: function (gi) { return q[gi].sales; }, colorOf: function (gi) { return yearColor(q[gi].year); },
      tipExtra: function (gi) { return [{ name: 'vs same quarter last year', value: q[gi].yoy == null ? 'n/a' : ZC.pct(q[gi].yoy) }]; }
    });
    ZC.legend($('lg-quarterly'), ys.map(function (y) { return { name: String(y), color: yearColor(y) }; }));
    var div = inScope(S().division);
    var names = Array.from(new Set(div.map(function (r) { return r.division; }))).filter(function (d) { return d !== 'Unspecified'; }).sort();
    var series = names.map(function (n, i) { return { name: n, color: COLORS[i] }; });
    ZC.columns($('ch-division'), {
      groups: ys.map(yLabel), series: series,
      value: function (gi, si) { return find(div, function (r) { return r.year === ys[gi] && r.division === names[si]; }).sales || 0; }
    });
    ZC.legend($('lg-division'), series);
  }

  function drawProducts() {
    var ys = years(), rows = inScope(S().category);
    var cats = ZPos.CATEGORIES;
    var v = function (y, c) { return find(rows, function (r) { return r.year === y && r.category === c; }).sales || 0; };
    var series = cats.map(function (c, i) { return { name: c, color: COLORS[i] }; });
    ZC.stack($('ch-catmix'), { groups: ys.map(yLabel), series: series, value: function (gi, si) { return v(ys[gi], cats[si]); } });
    ZC.legend($('lg-catmix'), series);
    var ser = yearSeries();
    ZC.hbars($('ch-catyear'), { items: cats, series: ser, value: function (ii, si) { return v(ser[si].year, cats[ii]); } });
    ZC.legend($('lg-catyear'), ser);
    rankedTable($('tb-families'), S().topFamilies, 'product_family', 'Product family', true);
  }

  function rankedChart(el, lg, rows, field) {
    var top = inScope(rows).slice(0, 10), ser = yearSeries();
    ZC.hbars(el, { items: top.map(function (r) { return r[field]; }), series: ser, value: function (ii, si) { return top[ii]['y' + ser[si].year]; } });
    ZC.legend(lg, ser);
  }
  function rankedTable(t, rows, field, label, withCat) {
    var ys = years(), last = ys.length - 1;
    var sig = ys.join(',') + (withCat ? 'c' : '');
    if (t._sig !== sig) {
      var tr = document.createElement('tr');
      var th = function (f, text, isNum, narrow) {
        var h = document.createElement('th');
        h.dataset.field = f;
        if (isNum) h.dataset.num = '1';
        if (narrow) h.className = 'hide-narrow';
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = text;
        h.appendChild(b);
        tr.appendChild(h);
      };
      th(field, label);
      if (withCat) th('category', 'Category', false, true);
      ys.forEach(function (y, i) { th('y' + y, String(y), true, i < last - 1); });
      if (ys.length > 1) th('change', 'Change ' + ys[last] + ' vs ' + ys[last - 1], true);
      t.tHead.replaceChildren(tr);
      t._sig = sig; t._bound = false; t._sort = { key: 'y' + ys[last], dir: -1 };
    }
    var cols = [{ key: field }];
    if (withCat) cols.push({ key: 'category', cls: 'hide-narrow' });
    ys.forEach(function (y, i) { cols.push({ key: 'y' + y, num: true, fmt: ZC.usdFull, cls: i < last - 1 ? 'hide-narrow' : null }); });
    if (ys.length > 1) cols.push({ key: 'change', num: true, fmt: ZC.usdFull, signed: true });
    ZC.table(t, inScope(rows), cols, function (r) { return r[field]; });
  }

  function drawChannel() {
    var ys = years(), all = S().distributor, rows = inScope(all);
    var tot = new Map();
    all.filter(function (r) { return r.scope === 'all'; }).forEach(function (r) { tot.set(r.distributor, (tot.get(r.distributor) || 0) + r.sales); });
    var order = Array.from(tot.keys()).sort(function (a, b) { return tot.get(b) - tot.get(a); });
    var present = order.filter(function (d) { return rows.some(function (r) { return r.distributor === d && r.sales !== 0; }); });
    var v = function (y, d) { return find(rows, function (r) { return r.year === y && r.distributor === d; }).sales || 0; };
    var series = present.map(function (d) { return { name: d, color: COLORS[order.indexOf(d) % COLORS.length] }; });
    ZC.stack($('ch-distmix'), { groups: ys.map(yLabel), series: series, value: function (gi, si) { return v(ys[gi], present[si]); } });
    ZC.legend($('lg-distmix'), series);
    var ser = yearSeries();
    ZC.hbars($('ch-distyear'), { items: present, series: ser, value: function (ii, si) { return v(ser[si].year, present[ii]); } });
    ZC.legend($('lg-distyear'), ser);
    rankedChart($('ch-resellers'), $('lg-resellers'), S().topResellers, 'reseller');
    rankedTable($('tb-resellers'), S().topResellers, 'reseller', 'Reseller');
  }

  function drawCustomers() {
    $('n-churn').textContent = state.scope === 'q4'
      ? 'End users buying in each Q4 against the Q4 before. Lost means bought in the prior Q4 but not this one.'
      : 'End users buying in each year against the year before. Lost means bought last year but not this one.';
    var rows = inScope(S().customers);
    var series = [{ name: 'New', color: COLORS[1], k: 'new_accounts' }, { name: 'Retained', color: COLORS[0], k: 'retained' }, { name: 'Lost', color: COLORS[3], k: 'lost' }];
    ZC.columns($('ch-churn'), {
      groups: rows.map(function (r) { return yLabel(r.year); }), series: series, fmt: ZC.num, tipFmt: ZC.num,
      value: function (gi, si) { return rows[gi][series[si].k]; },
      tipExtra: function (gi) {
        return [{ name: 'Sales from new', value: ZC.usdFull(rows[gi].new_sales) },
          { name: 'Sales from retained', value: ZC.usdFull(rows[gi].retained_sales) },
          { name: 'Lost users’ prior sales', value: ZC.usdFull(rows[gi].lost_prior_sales) }];
      }
    });
    ZC.legend($('lg-churn'), series);
    var vr = inScope(S().vertical);
    var vys = years().filter(function (y) { return vr.some(function (r) { return r.year === y; }); });
    var tot = new Map();
    vr.forEach(function (r) { tot.set(r.vertical, (tot.get(r.vertical) || 0) + r.sales); });
    var items = Array.from(tot.keys()).sort(function (a, b) { return tot.get(b) - tot.get(a); });
    var ser = yearSeries().filter(function (s) { return vys.indexOf(s.year) >= 0; });
    ZC.hbars($('ch-vertical'), {
      items: items, series: ser,
      value: function (ii, si) { return find(vr, function (r) { return r.year === ser[si].year && r.vertical === items[ii]; }).sales || 0; }
    });
    ZC.legend($('lg-vertical'), ser);
    rankedChart($('ch-endusers'), $('lg-endusers'), S().topEndUsers, 'end_user');
    rankedTable($('tb-endusers'), S().topEndUsers, 'end_user', 'End user');
  }

  function drawNotes() {
    var t = $('tb-coverage');
    if (!t._sig) {
      var tr = document.createElement('tr');
      [['year', 'Year'], ['quarters', 'Quarters'], ['sales', 'Sales'], ['qty', 'Units'], ['end_users', 'End users'], ['resellers', 'Resellers']].forEach(function (c, i) {
        var h = document.createElement('th');
        h.dataset.field = c[0];
        if (i) h.dataset.num = '1';
        var b = document.createElement('button');
        b.type = 'button';
        b.textContent = c[1];
        h.appendChild(b);
        tr.appendChild(h);
      });
      t.tHead.replaceChildren(tr);
      t._sig = 'cov'; t._sort = { key: 'year', dir: 1 };
    }
    ZC.table(t, S().yearly.filter(function (r) { return r.scope === 'all'; }), [
      { key: 'year', num: true }, { key: 'quarters', num: true }, { key: 'sales', num: true, fmt: ZC.usdFull },
      { key: 'qty', num: true, fmt: ZC.num }, { key: 'end_users', num: true, fmt: ZC.num }, { key: 'resellers', num: true, fmt: ZC.num }
    ], function (r) { return String(r.year); });
  }

  var DRAW = { overview: drawOverview, products: drawProducts, channel: drawChannel, customers: drawCustomers, notes: drawNotes };

  function render() {
    TABS.forEach(function (t) {
      $(t).hidden = t !== state.tab;
      $('tab-' + t).setAttribute('aria-selected', String(t === state.tab));
    });
    document.querySelectorAll('[data-scope]').forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.scope === state.scope)); });
    if (!state.S) { $('takeaway').textContent = 'Add your POS Excel files to see the analysis.'; return; }
    drawHeader();
    DRAW[state.tab]();
  }

  // ---------------------------------------------------------------- events
  document.querySelectorAll('[data-tab]').forEach(function (b) {
    b.addEventListener('click', function () { state.tab = b.dataset.tab; history.replaceState(null, '', '#' + state.tab); render(); });
  });
  document.querySelectorAll('[data-scope]').forEach(function (b) {
    b.addEventListener('click', function () { state.scope = b.dataset.scope; render(); });
  });
  $('file-input').addEventListener('change', function (e) { addFiles(e.target.files); e.target.value = ''; });
  var drop = $('drop');
  ['dragenter', 'dragover'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('drag'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('drag'); }); });
  drop.addEventListener('drop', function (e) { addFiles(e.dataTransfer.files); });
  $('btn-clear').addEventListener('click', function () {
    state.sheets = [];
    save();
    rebuild();
    $('status').textContent = 'Cleared. Add files to start again.';
  });
  $('btn-csv').addEventListener('click', function () {
    var blob = new Blob(['﻿' + ZPos.toCsv(state.result.lines)], { type: 'text/csv' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'zebra_hk_pos_combined.csv';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  });
  var resizeTimer;
  window.addEventListener('resize', function () { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 150); });

  if (TABS.indexOf(location.hash.slice(1)) >= 0) state.tab = location.hash.slice(1);
  load().then(function (sheets) {
    state.sheets = sheets;
    rebuild();
    if (sheets.length) $('status').textContent = 'Showing the files saved in this browser.';
  });
})();
