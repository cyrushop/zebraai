/* Zebra HK price concession (PC) history and price-uplift engine.
 *
 * Works in the browser (window.PcEngine) and in Node (module.exports) so the
 * uplift rules can be tested without a UI.
 *
 * Input: a raw table {name, headers, rows} read from the SFDC "PC list"
 * export (an HTML table saved as .xls).
 */
(function (root) {
  'use strict';

  var SIGNATURE = ['PC #', 'Price Concession Name', 'Unit Special Price (converted)'];

  function isPcHeader(headerRow) {
    var hs = {};
    (headerRow || []).forEach(function (h) { if (h != null) hs[String(h).trim()] = 1; });
    return SIGNATURE.every(function (r) { return hs[r]; });
  }

  // Find the PC table inside a 2-D sheet (header row may not be row 0).
  function tableFromGrid(grid, name) {
    for (var i = 0; i < Math.min(grid.length, 15); i++) {
      if (!isPcHeader(grid[i])) continue;
      var headers = grid[i].map(function (h) { return h == null ? '' : String(h).trim(); });
      var rows = grid.slice(i + 1).filter(function (r) {
        return r && r.some(function (v) { return v !== null && v !== undefined && v !== ''; });
      });
      return { name: name, headers: headers, rows: rows };
    }
    return null;
  }

  // ------------------------------------------------------------------ helpers
  function str(v) { return v == null ? '' : String(v).trim(); }
  function id(v) { return str(v).replace(/\.0+$/, ''); }
  function num(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return v;
    var n = parseFloat(String(v).replace(/[,\s]/g, ''));
    return isNaN(n) ? null : n;
  }
  function part(v) { return str(v).toUpperCase(); }

  // dd/mm/yyyy[ hh:mm] (SFDC HK locale), ISO string, Date or Excel serial.
  function date(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date) return isNaN(v) ? null : v;
    if (typeof v === 'number') return new Date(Math.round((v - 25569) * 864e5));
    var s = String(v).trim();
    var m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
    if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
    var d = new Date(s);
    return isNaN(d) ? null : d;
  }
  function iso(d) { return d ? d.toISOString().slice(0, 10) : ''; }

  // Approved and Expired PCs were granted; the rest never set a price.
  var STATUS_GROUP = {
    'Approved': 'approved',
    'Expired': 'approved',
    'Pending': 'pending',
    'Awaiting Approval': 'pending',
    'Expired before Approval': 'notgranted',
    'Rejected': 'notgranted',
    'Cancelled': 'notgranted'
  };

  // ------------------------------------------------------------- categories
  // Order matters: the first match wins.
  var CATEGORIES = [
    { id: 'rfid15', label: 'RFID HH: MC33XXR / TC22R', test: function (r) {
      return r.line === 'RFID Devices' && /^(MC33XXR|TC22R)/i.test(r.family);
    } },
    { id: 'rfidFixed', label: 'RFID Fixed Readers & Acc.', test: function (r) {
      return r.line === 'RFID Devices' && r.subLine === 'RFID Fixed Readers' && !/software/i.test(r.family + ' ' + r.subFamily);
    } },
    { id: 'rfidHH', label: 'RFID HH Readers', test: function (r) {
      return r.line === 'RFID Devices' && r.subLine === 'RFID HH Readers';
    } },
    { id: 'rfidOther', label: 'RFID other (OH readers, software)', test: function (r) { return r.line === 'RFID Devices'; } },
    { id: 'adc', label: 'ADC scanners', test: function (r) { return r.line === 'Adv Data Capture'; } },
    { id: 'emcAcc', label: 'EMC accessories', test: function (r) {
      return r.line === 'Mobile Computing' && /-ACC$/i.test(r.family);
    } },
    { id: 'emc', label: 'EMC mobile computers', test: function (r) {
      return r.line === 'Mobile Computing' && !/software/i.test(r.subLine);
    } },
    { id: 'ait', label: 'AIT printers, supplies & parts', test: function (r) { return r.bu === 'AIT'; } },
    { id: 'svc', label: 'Services (OneCare etc.)', test: function (r) { return /svcs|services/i.test(r.line); } },
    { id: 'other', label: 'Other', test: function () { return true; } }
  ];

  // Uplift in % on the last PC unit price. `full`: the last PC was not raised
  // yet. `repeat`: it was (RP). null = no rule; the app falls back to the list
  // price change since that PC.
  var DEFAULT_RULES = {
    effDate: '2026-10-05',
    liftFrom: '2026-01-01',
    liftThreshold: 0.5,
    includePending: false,
    rates: {
      rfid15: { full: 15, repeat: 3 },
      rfidFixed: { full: 5, repeat: 3 },
      rfidHH: { full: 5, repeat: 3 },
      rfidOther: { full: null, repeat: null },
      adc: { full: 4, repeat: 1 },
      emcAcc: { full: null, repeat: null },
      emc: { full: 15, repeat: null },
      ait: { full: 3, repeat: 1 },
      svc: { full: null, repeat: null },
      other: { full: null, repeat: null }
    }
  };

  function categoryOf(r) {
    for (var i = 0; i < CATEGORIES.length; i++) if (CATEGORIES[i].test(r)) return CATEGORIES[i].id;
    return 'other';
  }

  // ------------------------------------------------------------- normalise
  function normPc(table) {
    var h = {};
    table.headers.forEach(function (x, i) { h[x] = i; });
    var g = function (r, k) { return h[k] == null ? null : r[h[k]]; };
    var seen = {};
    var out = [];
    table.rows.forEach(function (r) {
      var o = {
        pc: id(g(r, 'PC #')),
        pcName: str(g(r, 'Price Concession Name')),
        source: str(g(r, 'PC Source')),
        created: date(g(r, 'Price Concession: Created Date')),
        decided: date(g(r, 'Approved/ Rejected Date')),
        expires: date(g(r, 'Expiration Date')),
        status: str(g(r, 'Status')),
        stage: str(g(r, 'Sales Stage')),
        accountNo: id(g(r, 'Siebel Account Number')),
        account: str(g(r, 'Account Name')),
        reseller: str(g(r, 'Reseller')),
        distributor: str(g(r, 'Distributor')),
        opp: str(g(r, 'Opportunity Number')),
        owner: str(g(r, 'Opportunity Owner')),
        part: part(g(r, 'Line Item Reseller: Product') || g(r, 'Product: Product Name')),
        bu: str(g(r, 'Product: Product Conversion Source')),
        line: str(g(r, 'Product Line')),
        subLine: str(g(r, 'Product: Product Sub Line')),
        family: str(g(r, 'Product Family')),
        subFamily: str(g(r, 'Product: Product Sub Family')),
        minQty: num(g(r, 'Min Qty')),
        maxQty: num(g(r, 'Max Qty')),
        list: num(g(r, 'Siebel List Price (converted)')),
        stdNet: num(g(r, 'Standard Net Price (converted)')),
        unit: num(g(r, 'Unit Special Price (converted)')),
        totalDisc: num(g(r, 'Total Discount'))
      };
      if (!o.pc || !o.part || o.unit == null) return;
      // The export repeats some PC lines verbatim.
      var k = [o.pc, o.part, o.unit, o.minQty, o.maxQty].join('|');
      if (seen[k]) return;
      seen[k] = 1;
      o.statusGroup = STATUS_GROUP[o.status] || 'notgranted';
      o.cat = categoryOf(o);
      o.acctKey = o.accountNo || ('name:' + o.account.toUpperCase());
      out.push(o);
    });
    return out;
  }

  function byDateDesc(a, b) {
    var d = (b.created ? +b.created : 0) - (a.created ? +a.created : 0);
    if (d) return d;
    return (b.decided ? +b.decided : 0) - (a.decided ? +a.decided : 0) || (b.pc > a.pc ? 1 : b.pc < a.pc ? -1 : 0);
  }

  function buildIndex(rows) {
    rows = rows.slice().sort(byDateDesc);
    var byPart = {}, byAcct = {}, latestList = {}, accounts = {}, info = {};
    var minD = null, maxD = null;
    rows.forEach(function (r) {
      (byPart[r.part] = byPart[r.part] || []).push(r);
      (byAcct[r.acctKey] = byAcct[r.acctKey] || []).push(r);
      // rows are newest first, so the first list price seen is the latest
      if (r.list != null && !latestList[r.part]) latestList[r.part] = { list: r.list, date: r.created, pc: r.pc };
      if (!info[r.part]) info[r.part] = { part: r.part, line: r.line, subLine: r.subLine, family: r.family, bu: r.bu, cat: r.cat };
      var a = accounts[r.acctKey];
      if (!a) a = accounts[r.acctKey] = { key: r.acctKey, no: r.accountNo, name: r.account, names: {}, pcs: {}, parts: {}, last: r.created };
      a.names[r.account] = 1;
      a.pcs[r.pc] = 1;
      a.parts[r.part] = 1;
      if (r.created) {
        if (!minD || r.created < minD) minD = r.created;
        if (!maxD || r.created > maxD) maxD = r.created;
      }
    });
    var accList = Object.keys(accounts).map(function (k) {
      var a = accounts[k];
      return { key: a.key, no: a.no, name: a.name, alias: Object.keys(a.names), pcCount: Object.keys(a.pcs).length,
        partCount: Object.keys(a.parts).length, last: a.last };
    }).sort(function (a, b) { return (+b.last || 0) - (+a.last || 0); });
    return { rows: rows, byPart: byPart, byAcct: byAcct, latestList: latestList, info: info, accounts: accList,
      parts: Object.keys(byPart).sort(), from: minD, to: maxD };
  }

  function counts(group, rules) {
    return group === 'approved' || (rules.includePending && group === 'pending');
  }

  // One line per PC: if a PC has several rows for the part (qty tiers), keep the lowest price.
  function perPc(hist) {
    var m = {}, out = [];
    hist.forEach(function (r) {
      var x = m[r.pc];
      if (!x) { m[r.pc] = r; out.push(r); } else if (r.unit < x.unit) out[out.indexOf(x)] = m[r.pc] = r;
    });
    return out;
  }

  function pct(a, b) { return a != null && b ? a / b - 1 : null; }
  function round2(n) { return Math.round(n * 100) / 100; }

  /* Recommendation for one customer + part.
   * hist: that customer's rows for the part, newest first.
   */
  function assess(idx, hist, rules, partNo) {
    rules = rules || DEFAULT_RULES;
    var p = partNo || (hist[0] && hist[0].part);
    var inf = idx.info[p] || null;
    var cat = inf ? inf.cat : null;
    var rate = cat && rules.rates[cat] ? rules.rates[cat] : { full: null, repeat: null };
    var granted = perPc(hist.filter(function (r) { return counts(r.statusGroup, rules); }));
    var res = { part: p, info: inf, cat: cat, history: perPc(hist), granted: granted, latest: idx.latestList[p] || null };
    if (!granted.length) { res.state = 'new'; return res; }
    var last = granted[0];
    var prev = null;
    for (var i = 1; i < granted.length; i++) {
      if (granted[i].created && last.created && granted[i].created < last.created) { prev = granted[i]; break; }
    }
    var eff = date(rules.effDate), from = date(rules.liftFrom);
    res.last = last;
    res.prev = prev;
    res.lift = prev ? pct(last.unit, prev.unit) : null;
    res.listChange = res.latest ? pct(res.latest.list, last.list) : null;
    var byDate = !!(eff && last.created && last.created >= eff);
    var byPrice = !byDate && res.lift != null && (!from || (last.created && last.created >= from)) &&
      res.lift * 100 >= (rules.liftThreshold || 0);
    res.raised = byDate || byPrice;
    res.reason = byDate ? 'date' : byPrice ? 'price' : null;
    res.state = res.raised ? 'repeat' : 'full';
    var r = res.raised ? rate.repeat : rate.full;
    if (r != null && r !== '') {
      res.rate = +r;
      res.rateSource = 'rule';
    } else if (res.listChange != null) {
      res.rate = round2(Math.max(0, res.listChange) * 100);
      res.rateSource = 'list';
    } else {
      res.rate = null;
      res.rateSource = null;
    }
    if (res.rate != null) {
      res.suggested = round2(last.unit * (1 + res.rate / 100));
      if (res.raised && res.lift != null) res.cumulative = (1 + res.lift) * (1 + res.rate / 100) - 1;
      if (res.latest && res.latest.list) res.newDisc = 1 - res.suggested / res.latest.list;
    }
    if (last.list) res.lastDisc = 1 - last.unit / last.list;
    return res;
  }

  function customerParts(idx, acctKey, rules, onlyParts) {
    var rows = idx.byAcct[acctKey] || [];
    var by = {};
    rows.forEach(function (r) { (by[r.part] = by[r.part] || []).push(r); });
    var list = onlyParts && onlyParts.length ? onlyParts : Object.keys(by);
    return list.map(function (p) { return assess(idx, by[p] || [], rules, p); });
  }

  // Latest granted price per other customer for a part, newest first.
  function otherCustomers(idx, partNo, exceptKey, rules) {
    var seen = {}, out = [];
    (idx.byPart[partNo] || []).forEach(function (r) {
      if (r.acctKey === exceptKey || seen[r.acctKey] || !counts(r.statusGroup, rules || DEFAULT_RULES)) return;
      seen[r.acctKey] = 1;
      out.push(r);
    });
    return out;
  }

  function findAccounts(idx, q) {
    q = str(q).toUpperCase();
    if (!q) return idx.accounts;
    return idx.accounts.filter(function (a) {
      return a.no === q || a.alias.some(function (n) { return n.toUpperCase().indexOf(q) >= 0; });
    });
  }

  function findParts(idx, q) {
    q = part(q).replace(/\s+/g, '');
    if (!q) return [];
    var exact = [], pre = [], sub = [];
    idx.parts.forEach(function (p) {
      if (p === q) exact.push(p);
      else if (p.indexOf(q) === 0) pre.push(p);
      else if (p.indexOf(q) > 0) sub.push(p);
    });
    return exact.concat(pre, sub);
  }

  // Parse a pasted part list: one per line or separated by commas/spaces/tabs.
  function parsePartList(text) {
    var seen = {}, out = [];
    str(text).split(/[\s,;]+/).forEach(function (t) {
      t = part(t);
      if (t && !seen[t]) { seen[t] = 1; out.push(t); }
    });
    return out;
  }

  var api = {
    SIGNATURE: SIGNATURE, CATEGORIES: CATEGORIES, DEFAULT_RULES: DEFAULT_RULES, STATUS_GROUP: STATUS_GROUP,
    isPcHeader: isPcHeader, tableFromGrid: tableFromGrid, normPc: normPc, buildIndex: buildIndex, categoryOf: categoryOf,
    assess: assess, customerParts: customerParts, otherCustomers: otherCustomers, findAccounts: findAccounts,
    findParts: findParts, parsePartList: parsePartList, date: date, iso: iso
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PcEngine = api;
})(this);
