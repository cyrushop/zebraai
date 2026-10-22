/* Zebra HK POS sell-out engine.
 *
 * Works in the browser (window.ZPos) and in Node (module.exports) so the
 * file layouts and totals can be tested without a UI.
 *
 * Input: sheets {file, sheet, grid} where grid is a 2-D array of cell values
 * (SheetJS sheet_to_json with header: 1). Output: one harmonised line per POS
 * row, plus the summaries the page draws.
 */
(function (root) {
  'use strict';

  var DIRECT = 'DIRECT (DSR SELL-IN = SELL-OUT)';

  // Product lines differ by year (e.g. "Mobile" is mobile printers from 2024),
  // so they are grouped into categories that stay comparable.
  var CATEGORY = {
    'MOBILE COMPUTING': 'Mobile computing',
    'ADV DATA CAPTURE': 'Data capture & scanning',
    'FIXED IND SCAN & MACHINE VISION': 'Data capture & scanning',
    'DESKTOP': 'Barcode printers', 'TABLETOP': 'Barcode printers', 'MOBILE': 'Barcode printers',
    'RFID DEVICES': 'RFID', 'RFID': 'RFID',
    'CARD': 'Card printers',
    'CARD SUPPLIES': 'Supplies', 'BARCODE SUPPLIES': 'Supplies',
    'AFTERMARKET PRODUCTS': 'Accessories, software & services',
    'AFTERMARKET SERVICES': 'Accessories, software & services',
    'SOFTWARE AND PERIPHERALS': 'Accessories, software & services',
    'NON SELLABLE ITEMS': 'Accessories, software & services'
  };
  var CATEGORIES = ['Mobile computing', 'Data capture & scanning', 'Barcode printers', 'RFID', 'Card printers',
    'Supplies', 'Accessories, software & services'];

  function clean(v) {
    if (v == null) return 'Unspecified';
    var s = String(v).trim();
    return (s === '' || s.toUpperCase() === 'NULL') ? 'Unspecified' : s.toUpperCase();
  }
  function num(v) {
    var n = typeof v === 'number' ? v : parseFloat(String(v == null ? '' : v).replace(/,/g, ''));
    return isFinite(n) ? n : 0;
  }
  function first(r, keys) {
    for (var i = 0; i < keys.length; i++) {
      var v = r[keys[i]];
      if (v != null && String(v).trim() !== '' && String(v).trim().toUpperCase() !== 'NULL') return v;
    }
    return null;
  }
  // "2022 Q 4", "2025 Q4", "Q4" -> 4
  function quarterOf(v) {
    var m = /Q\s*([1-4])/i.exec(String(v == null ? '' : v));
    return m ? Number(m[1]) : null;
  }
  // "2023 Q 1", "2023 Week01", 2023 -> 2023
  function yearOf(v) {
    var m = /(20\d\d)/.exec(String(v == null ? '' : v));
    return m ? Number(m[1]) : null;
  }

  // ---------------------------------------------------------------- layouts
  // Each export has its own columns. Sales is always SIP / net amount after
  // sell-out rebate, in USD: the one value every year's file carries.
  var LAYOUTS = [
    {
      id: 'bi', label: 'BI extract (NetAmount_After_Rebate)',
      needs: ['StandardEndUserName', 'NetAmount_After_Rebate', 'Fiscal Year', 'Fiscal Quarter'],
      map: function (r) {
        return {
          year: yearOf(r['Fiscal Year']), q: quarterOf(r['Fiscal Quarter']), dist: r['DistributorName'],
          path: r['PathToM'], res: first(r, ['StandardResellerName', 'ResellerName']),
          eu: first(r, ['StandardEndUserName', 'EndUserName']), pl: r['ProductLine'], bu: r['Source'],
          vert: r['Enduservertical'], fam: r['ProductFamily'], qty: r['Quantity'], sales: r['NetAmount_After_Rebate']
        };
      }
    },
    {
      id: 'zyme2022', label: 'POS detail, 2022 layout (SIP After rebate)',
      needs: ['POS Source Record ID', 'SIP After rebate', 'Fiscal Quarter (Invoice)'],
      map: function (r) {
        return {
          year: yearOf(r['Fiscal Quarter (Invoice)']), q: quarterOf(r['Fiscal Quarter (Invoice)']),
          dist: r['Distributor Name'], res: r['Client Name - Raw'],
          eu: first(r, ['End User NVL', 'End User Name - Raw']), pl: r['Product Line'], bu: r['Business Division'],
          vert: r['Vertical_22.Vertical'], fam: r['Product Family'], qty: r['POS Quantity'], sales: r['SIP After rebate']
        };
      }
    },
    {
      id: 'zyme', label: 'POS detail, 2023–2024 layout (SIP After rebate)',
      needs: ['SIP After rebate', 'Fiscal Quarter (Invoice)', 'Eud User NVL'],
      map: function (r) {
        return {
          year: yearOf(r['Fiscal Quarter (Invoice)']), q: quarterOf(r['Fiscal Quarter (Invoice)']),
          dist: r['Distributor Name'], res: first(r, ['Reseller Name (Translated)', 'Client Name - Raw']),
          eu: first(r, ['Eud User NVL', 'End User Name - Raw']), pl: r['Product Line'], bu: r['Business Division'],
          vert: r['Vertical'], fam: r['Product Family'], qty: r['POS Quantity'], sales: r['SIP After rebate']
        };
      }
    },
    {
      id: 'fy25', label: 'POS detail, FY25 layout (SIP After rabe Amount)',
      needs: ['SIP After rabe Amount', 'Invoice Fiscal Quarter'],
      map: function (r) {
        return {
          year: yearOf(r['Invoice Fiscal Year'] || r['Invoice Fiscal Quarter']), q: quarterOf(r['Invoice Fiscal Quarter']),
          dist: r['Submitting Account Name'], res: r['Client Name - Raw Capitalized_cc'],
          eu: first(r, ['NVL End User', 'End User Name - Raw']), pl: r['Product Line'], bu: r['Business Division_cc'],
          vert: null, fam: r['Product Family'], qty: r['POS Quantity - Submitted'], sales: r['SIP After rabe Amount']
        };
      }
    }
  ];

  function detect(headerRow) {
    var hs = {};
    (headerRow || []).forEach(function (h) { if (h != null) hs[String(h).trim()] = 1; });
    for (var i = 0; i < LAYOUTS.length; i++) {
      if (LAYOUTS[i].needs.every(function (n) { return hs[n]; })) return LAYOUTS[i];
    }
    return null;
  }

  // Read one sheet. The header may sit below a pivot title, so the first
  // rows are searched for it.
  function readSheet(s) {
    var grid = s.grid || [];
    for (var h = 0; h < Math.min(grid.length, 6); h++) {
      var layout = detect(grid[h]);
      if (!layout) continue;
      var head = grid[h].map(function (x) { return x == null ? null : String(x).trim(); });
      var lines = [];
      for (var i = h + 1; i < grid.length; i++) {
        var row = grid[i];
        if (!row || row.every(function (v) { return v == null || v === ''; })) continue;
        var o = {};
        head.forEach(function (k, j) { if (k) o[k] = row[j]; });
        var m = layout.map(o);
        if (!m.year || !m.q) continue;
        var pl = clean(m.pl), d = clean(m.dist);
        lines.push({
          year: m.year, quarter: 'Q' + m.q, period: m.year + ' Q' + m.q,
          distributor: (d === 'Unspecified' || String(m.path || '').trim() === 'Tier 1') ? DIRECT : d,
          reseller: clean(m.res), end_user: clean(m.eu), product_line: pl,
          category: CATEGORY[pl] || 'Accessories, software & services',
          division: clean(m.bu), vertical: clean(m.vert), product_family: clean(m.fam),
          qty: num(m.qty), sales: num(m.sales)
        });
      }
      return { file: s.file, sheet: s.sheet, layout: layout.id, layoutLabel: layout.label, lines: lines };
    }
    return null;
  }

  // Combine sheets from any number of workbooks.
  // - In one workbook, only the largest matching sheet is used: the others
  //   are pivot drill-downs of it (e.g. FY25 詳細資料1) and would double count.
  // - When two files cover the same year, the one with more quarters wins,
  //   then the one with more lines (a full-year extract beats a Q4 extract).
  function combine(sheets) {
    var byFile = {}, notes = [];
    sheets.forEach(function (s) {
      var t = readSheet(s);
      if (!t) return;
      var cur = byFile[s.file];
      if (!cur || t.lines.length > cur.lines.length) {
        if (cur) notes.push({ file: cur.file, sheet: cur.sheet, reason: 'Smaller sheet in the same workbook (likely a pivot drill-down)' });
        byFile[s.file] = t;
      } else {
        notes.push({ file: t.file, sheet: t.sheet, reason: 'Smaller sheet in the same workbook (likely a pivot drill-down)' });
      }
    });
    var files = Object.keys(byFile).map(function (k) { return byFile[k]; });
    var cand = {};
    files.forEach(function (t) {
      var ys = {};
      t.lines.forEach(function (l) { (ys[l.year] = ys[l.year] || []).push(l); });
      Object.keys(ys).forEach(function (y) {
        var ls = ys[y], qs = {};
        ls.forEach(function (l) { qs[l.quarter] = 1; });
        (cand[y] = cand[y] || []).push({ t: t, lines: ls, quarters: Object.keys(qs).sort() });
      });
    });
    var lines = [], used = [];
    Object.keys(cand).sort().forEach(function (y) {
      var c = cand[y].sort(function (a, b) { return (b.quarters.length - a.quarters.length) || (b.lines.length - a.lines.length); });
      var win = c[0];
      lines = lines.concat(win.lines);
      used.push({
        year: Number(y), file: win.t.file, sheet: win.t.sheet, layout: win.t.layoutLabel, quarters: win.quarters,
        rows: win.lines.length, sales: win.lines.reduce(function (a, l) { return a + l.sales; }, 0)
      });
      c.slice(1).forEach(function (o) {
        notes.push({ file: o.t.file, sheet: o.t.sheet, reason: 'Year ' + y + ' already covered by ' + win.t.file + ' (' + win.quarters.length + ' quarters vs ' + o.quarters.length + ')' });
      });
    });
    return { lines: lines, used: used, skipped: notes };
  }

  // ---------------------------------------------------------------- summaries
  function sumBy(lines, keyFn, val) {
    var m = new Map();
    lines.forEach(function (l) { var k = keyFn(l); m.set(k, (m.get(k) || 0) + (val ? val(l) : l.sales)); });
    return m;
  }
  function scoped(lines, scope) { return scope === 'q4' ? lines.filter(function (l) { return l.quarter === 'Q4'; }) : lines; }

  function shareBy(lines, field, years) {
    var out = [];
    ['all', 'q4'].forEach(function (scope) {
      var ls = scoped(lines, scope);
      var tot = sumBy(ls, function (l) { return l.year; });
      sumBy(ls, function (l) { return l.year + '|' + l[field]; }).forEach(function (v, k) {
        var i = k.indexOf('|'), y = Number(k.slice(0, i));
        var row = { scope: scope, year: y, sales: v, share: tot.get(y) ? v / tot.get(y) : 0 };
        row[field] = k.slice(i + 1);
        out.push(row);
      });
    });
    return out;
  }

  function topBy(lines, field, years, n) {
    var out = [];
    ['all', 'q4'].forEach(function (scope) {
      var m = new Map();
      scoped(lines, scope).forEach(function (l) {
        var k = l[field];
        if (k === 'Unspecified') return;
        var e = m.get(k);
        if (!e) {
          e = { scope: scope, total: 0, category: l.category };
          e[field] = k;
          years.forEach(function (y) { e['y' + y] = 0; });
          m.set(k, e);
        }
        e['y' + l.year] += l.sales;
        e.total += l.sales;
      });
      var last = years[years.length - 1], prev = years[years.length - 2];
      var arr = Array.from(m.values());
      arr.forEach(function (e) { e.change = prev ? e['y' + last] - e['y' + prev] : 0; });
      arr.sort(function (a, b) { return b.total - a.total; });
      out = out.concat(arr.slice(0, n));
    });
    return out;
  }

  function summarize(lines) {
    var years = Array.from(new Set(lines.map(function (l) { return l.year; }))).sort();
    var last = years[years.length - 1], prev = years[years.length - 2], firstY = years[0];
    var sum = function (f, k) { return lines.filter(f).reduce(function (a, l) { return a + l[k || 'sales']; }, 0); };
    var count = function (f, k) {
      return new Set(lines.filter(f).filter(function (l) { return l.sales > 0 && l[k] !== 'Unspecified'; }).map(function (l) { return l[k]; })).size;
    };
    var fy = function (y) { return function (l) { return l.year === y; }; };
    var q4 = function (y) { return function (l) { return l.year === y && l.quarter === 'Q4'; }; };
    var kpi = function (value, prior) { return { value: value, prior: prior, change: prior ? (value - prior) / Math.abs(prior) : null }; };

    var yearly = [];
    ['all', 'q4'].forEach(function (scope) {
      years.forEach(function (y) {
        var ls = scoped(lines, scope).filter(fy(y));
        var pos = ls.filter(function (l) { return l.sales > 0; });
        yearly.push({
          scope: scope, year: y,
          sales: ls.reduce(function (a, l) { return a + l.sales; }, 0),
          qty: ls.reduce(function (a, l) { return a + l.qty; }, 0),
          end_users: new Set(pos.map(function (l) { return l.end_user; })).size,
          resellers: new Set(pos.map(function (l) { return l.reseller; })).size,
          quarters: new Set(ls.map(function (l) { return l.quarter; })).size
        });
      });
    });

    var qm = new Map();
    lines.forEach(function (l) {
      var e = qm.get(l.period) || { period: l.period, year: l.year, quarter: l.quarter, sales: 0, qty: 0 };
      e.sales += l.sales; e.qty += l.qty;
      qm.set(l.period, e);
    });
    var quarterly = Array.from(qm.values()).sort(function (a, b) { return a.period < b.period ? -1 : 1; });
    quarterly.forEach(function (e) {
      var p = qm.get((e.year - 1) + ' ' + e.quarter);
      e.yoy = p && p.sales ? (e.sales - p.sales) / Math.abs(p.sales) : null;
    });

    var buyers = function (f) {
      var m = new Map();
      lines.filter(f).forEach(function (l) { if (l.end_user !== 'Unspecified') m.set(l.end_user, (m.get(l.end_user) || 0) + l.sales); });
      return m;
    };
    var customers = [];
    years.slice(1).forEach(function (y) {
      [['all', fy], ['q4', q4]].forEach(function (p) {
        var cur = buyers(p[1](y)), old = buyers(p[1](y - 1));
        var e = { scope: p[0], year: y, active: cur.size, new_accounts: 0, retained: 0, lost: 0, new_sales: 0, retained_sales: 0, lost_prior_sales: 0 };
        cur.forEach(function (v, k) { if (old.has(k)) { e.retained++; e.retained_sales += v; } else { e.new_accounts++; e.new_sales += v; } });
        old.forEach(function (v, k) { if (!cur.has(k)) { e.lost++; e.lost_prior_sales += v; } });
        customers.push(e);
      });
    });

    return {
      years: years, last: last, prev: prev, first: firstY,
      kpi: {
        sales: kpi(sum(fy(last)), sum(fy(prev))),
        q4: kpi(sum(q4(last)), sum(q4(prev))),
        vsFirst: kpi(sum(fy(last)), sum(fy(firstY))),
        qty: kpi(sum(fy(last), 'qty'), sum(fy(prev), 'qty')),
        endUsers: kpi(count(fy(last), 'end_user'), count(fy(prev), 'end_user')),
        resellers: kpi(count(fy(last), 'reseller'), count(fy(prev), 'reseller'))
      },
      yearly: yearly,
      quarterly: quarterly,
      division: shareBy(lines, 'division', years),
      category: shareBy(lines, 'category', years),
      distributor: shareBy(lines, 'distributor', years),
      vertical: shareBy(lines.filter(function (l) { return l.vertical !== 'Unspecified'; }), 'vertical', years),
      topEndUsers: topBy(lines, 'end_user', years, 20),
      topResellers: topBy(lines, 'reseller', years, 20),
      topFamilies: topBy(lines, 'product_family', years, 20),
      customers: customers
    };
  }

  // CSV of the combined lines, for checking in Excel.
  function toCsv(lines) {
    var cols = ['year', 'quarter', 'period', 'distributor', 'reseller', 'end_user', 'product_line', 'category', 'division',
      'vertical', 'product_family', 'qty', 'sales'];
    var esc = function (v) { var s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    return [cols.join(',')].concat(lines.map(function (l) { return cols.map(function (c) { return esc(l[c]); }).join(','); })).join('\n');
  }

  var api = {
    LAYOUTS: LAYOUTS, CATEGORIES: CATEGORIES, DIRECT: DIRECT,
    detect: detect, readSheet: readSheet, combine: combine, summarize: summarize, toCsv: toCsv,
    quarterOf: quarterOf, yearOf: yearOf
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ZPos = api;
})(this);
