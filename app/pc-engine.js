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

  /* Price-increase events and RP rates, in % on the last PC unit price.
   *
   * events: Zebra list-price increases. For each event that the customer's
   * last PC has not absorbed, the event's rate for the part's category is
   * added (compounded when there are several).
   * rp: the smaller uplift for a repeat PC whose price already carries every
   * increase. A category with no event and no RP rate has no rule; the app
   * then uses the list-price change since the last PC.
   */
  var DEFAULT_RULES = {
    liftFrom: '2026-01-01',
    liftThreshold: 0.5,
    includePending: false,
    events: [
      // First PCs at the new EMC list prices appear on 2026-03-19 in the HK PC list.
      // RFID handhelds (incl. MC33XXR / TC22R) were not part of it.
      { id: 'e2026-03', label: '2026 年 3 月', date: '2026-03-19', rates: { emc: 15 } },
      { id: 'e2026-10', label: '2026 年 10 月', date: '2026-10-05',
        rates: { emc: 15, rfid15: 15, rfidFixed: 5, rfidHH: 5, adc: 4, ait: 3 } }
    ],
    rp: { emc: 15, rfid15: 3, rfidFixed: 3, rfidHH: 3, adc: 1, ait: 1 }
  };

  // Some Hong Kong PCs carry "China" as their sub region; they belong to Hong Kong.
  var REGION_ALIAS = { 'China': 'Hong Kong' };
  function regionOf(v) { return REGION_ALIAS[v] || v; }

  function categoryOf(r) {
    for (var i = 0; i < CATEGORIES.length; i++) if (CATEGORIES[i].test(r)) return CATEGORIES[i].id;
    return 'other';
  }

  // ------------------------------------------------------------- normalise
  function normPc(table) {
    var h = {};
    table.headers.forEach(function (x, i) { h[x] = i; });
    var g = function (r, k) { return h[k] == null ? null : r[h[k]]; };
    var seen = {}, seenPc = {};
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
        stdDisc: num(g(r, 'Discount')),
        stdNet: num(g(r, 'Standard Net Price (converted)')),
        fulfil: str(g(r, 'Fulfillment Type')),
        regionRaw: str(g(r, 'Owner Sub Region')),
        unit: num(g(r, 'Unit Special Price (converted)')),
        totalDisc: num(g(r, 'Total Discount'))
      };
      if (!o.pc || !o.part || o.unit == null) return;
      // The export repeats some PC lines verbatim.
      var k = [o.pc, o.part, o.unit, o.minQty, o.maxQty].join('|');
      if (seen[k]) return;
      seen[k] = 1;
      // The justification repeats on every line of a PC; keep it once.
      if (!seenPc[o.pc]) { seenPc[o.pc] = 1; o.just = str(g(r, 'Justification')); }
      o.region = regionOf(o.regionRaw);
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

  // Latest list price and standard discount per part, newest PC first.
  // Standard discount differs by fulfillment type, so keep the latest per type too.
  function latestPrices(rows) {
    var out = {};
    rows.slice().sort(byDateDesc).forEach(function (r) {
      if (r.list == null) return;
      var lv = { list: r.list, stdDisc: r.stdDisc, date: r.created, pc: r.pc, region: r.region };
      if (!out[r.part]) out[r.part] = lv;
      if (!out[r.part + '|' + r.fulfil]) out[r.part + '|' + r.fulfil] = lv;
    });
    return out;
  }

  /* rows: the PCs to look up (e.g. one region).
   * priceRows: where list prices and standard discounts come from; defaults
   * to rows. Pass every region so a region view still uses the newest price.
   */
  function buildIndex(rows, priceRows) {
    rows = rows.slice().sort(byDateDesc);
    var byPart = {}, byAcct = {}, accounts = {}, info = {};
    var latestList = latestPrices(priceRows || rows);
    var minD = null, maxD = null;
    rows.forEach(function (r) {
      (byPart[r.part] = byPart[r.part] || []).push(r);
      (byAcct[r.acctKey] = byAcct[r.acctKey] || []).push(r);
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

  function blank(v) { return v == null || v === '' || isNaN(+v); }

  // Events that carry a rate for the category, oldest first.
  function eventsFor(rules, cat) {
    return (rules.events || []).filter(function (e) { return e.rates && !blank(e.rates[cat]) && date(e.date); })
      .map(function (e) { return { id: e.id, label: e.label, date: date(e.date), rate: +e.rates[cat] }; })
      .sort(function (a, b) { return a.date - b.date; });
  }

  /* Recommendation for one customer + part.
   * hist: that customer's rows for the part, newest first.
   *
   * state: 'new' (no granted PC), 'full' (at least one increase not passed
   * on yet), 'repeat' (every increase already in the last PC price, or
   * raised ahead of it: RP rate), 'norule' (no event or RP rate for the
   * category: list-price change since the last PC).
   * steps: one entry per event, explaining what was added and why.
   */
  function assess(idx, hist, rules, partNo) {
    rules = rules || DEFAULT_RULES;
    var p = partNo || (hist[0] && hist[0].part);
    var inf = idx.info[p] || null;
    var cat = inf ? inf.cat : null;
    var granted = perPc(hist.filter(function (r) { return counts(r.statusGroup, rules); }));
    var res = { part: p, info: inf, cat: cat, history: perPc(hist), granted: granted, latest: idx.latestList[p] || null, steps: [] };
    if (!granted.length) { res.state = 'new'; return res; }
    var last = granted[0];
    if (idx.latestList[p + '|' + last.fulfil]) res.latest = idx.latestList[p + '|' + last.fulfil];
    var prev = null;
    for (var i = 1; i < granted.length; i++) {
      if (granted[i].created && last.created && granted[i].created < last.created) { prev = granted[i]; break; }
    }
    var thr = (+rules.liftThreshold || 0) / 100, from = date(rules.liftFrom);
    var rp = rules.rp && !blank(rules.rp[cat]) ? +rules.rp[cat] : null;
    res.last = last;
    res.prev = prev;
    res.lift = prev ? pct(last.unit, prev.unit) : null;
    res.listChange = res.latest ? pct(res.latest.list, last.list) : null;

    var evs = eventsFor(rules, cat), lastDone = null, pending = [];
    evs.forEach(function (e) {
      if (!last.created || last.created < e.date) { pending.push(e); return; }
      lastDone = e;
      var before = null;
      for (var j = 0; j < granted.length; j++) if (granted[j].created && granted[j].created < e.date) { before = granted[j]; break; }
      if (!before) { res.steps.push({ event: e, kind: 'covered', rate: 0 }); return; }
      var l = pct(last.unit, before.unit);
      if (l >= thr - 1e-12) res.steps.push({ event: e, kind: 'raised', rate: 0, base: before, lift: l });
      else res.steps.push({ event: e, kind: 'notRaised', rate: e.rate, base: before, lift: l });
    });
    // A rise on the last PC that no earlier event explains was a price
    // increase ahead of the next event: that event gets the RP rate.
    var early = pending.length && rp != null && res.lift != null && res.lift >= thr - 1e-12 &&
      (!from || last.created >= from) && (!lastDone || prev.created >= lastDone.date);
    pending.forEach(function (e, k) {
      if (k === 0 && early) res.steps.push({ event: e, kind: 'early', rate: rp, base: prev, lift: res.lift });
      else res.steps.push({ event: e, kind: 'pending', rate: e.rate });
    });

    var adds = res.steps.filter(function (x) { return x.kind === 'notRaised' || x.kind === 'pending' || x.kind === 'early'; });
    if (adds.length) {
      res.state = adds.every(function (x) { return x.kind === 'early'; }) ? 'repeat' : 'full';
      res.rate = round2((adds.reduce(function (m, x) { return m * (1 + x.rate / 100); }, 1) - 1) * 100);
      res.rateSource = 'rule';
    } else if (rp != null) {
      res.state = 'repeat';
      res.rate = rp;
      res.rateSource = 'rule';
    } else if (evs.length) {
      res.state = 'repeat';
      res.rate = null;
      res.rateSource = null;
    } else {
      res.state = 'norule';
      res.rate = res.listChange != null ? round2(Math.max(0, res.listChange) * 100) : null;
      res.rateSource = res.rate != null ? 'list' : null;
    }
    if (res.rate != null) {
      res.suggested = round2(last.unit * (1 + res.rate / 100));
      // Total rise against the price before the earliest raise we credited.
      var base = null;
      res.steps.forEach(function (x) { if ((x.kind === 'raised' || x.kind === 'early') && x.base && (!base || x.base.created < base.created)) base = x.base; });
      if (base) { res.cumulativeBase = base; res.cumulative = res.suggested / base.unit - 1; }
      if (res.latest && res.latest.list) {
        res.newDisc = 1 - res.suggested / res.latest.list;
        if (!blank(res.latest.stdDisc)) {
          res.newStdNet = round2(res.latest.list * (1 - res.latest.stdDisc / 100));
          res.aboveStd = res.suggested >= res.newStdNet;
        }
      }
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

  /* Read the fields of a justification written from the PC template.
   * The SFDC export turns full-width colons (and any Chinese) into "?", so
   * "?", ":" and "：" all count as the separator.
   */
  function parseJustification(text) {
    var t = str(text).replace(/\s+/g, ' ');
    var SEP = '\\s*[?:：]\\s*';
    var grab = function (label, next) {
      var m = t.match(new RegExp(label + SEP + '(.*?)\\s*(?=\\d{1,2}\\.\\s+(?:' + next + ')|$)', 'i'));
      return m ? m[1].trim() : '';
    };
    var margin = function (label) {
      var m = t.match(new RegExp(label + '\\s*[?:：]?\\s*([\\d.]+)\\s*%', 'i'));
      return m ? m[1] : '';
    };
    var prev = t.match(/Previous Repeat PC#?\s*[?:：]?\s*(\d{6,})/i);
    return {
      contact: grab('Customer Contact Information', 'Annual Agreement|Customer Demand'),
      distMargin: margin('Distributor Margin'),
      resellerMargin: margin('Reseller Margin'),
      demand: grab('Customer Demand', 'Zebra Product'),
      product: grab('Zebra Product & Solution', 'Competitor'),
      competitor: grab('Competitor & Model', 'Other Comments'),
      previousPc: prev ? prev[1] : ''
    };
  }

  /* What a new justification for this customer can start from: the newest
   * granted PC (the "previous PC#"), restricted to `parts` when any of them
   * has one, and the newest justification that names a contact.
   */
  function lastPcFor(idx, acctKey, parts, rules) {
    rules = rules || DEFAULT_RULES;
    var rows = idx.byAcct[acctKey] || [];
    var want = {};
    (parts || []).forEach(function (p) { want[p] = 1; });
    var granted = rows.filter(function (r) { return counts(r.statusGroup, rules); });
    var forParts = granted.filter(function (r) { return want[r.part]; });
    var last = (forParts.length ? forParts : granted)[0] || null;
    var just = null;
    for (var i = 0; i < rows.length && !just; i++) {
      if (!rows[i].just) continue;
      var f = parseJustification(rows[i].just);
      if (f.contact) just = { pc: rows[i].pc, created: rows[i].created, fields: f };
    }
    return { last: last, forParts: !!forParts.length, just: just };
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
    isPcHeader: isPcHeader, tableFromGrid: tableFromGrid, normPc: normPc, regionOf: regionOf, buildIndex: buildIndex, categoryOf: categoryOf,
    assess: assess, customerParts: customerParts, otherCustomers: otherCustomers, findAccounts: findAccounts,
    findParts: findParts, parsePartList: parsePartList, parseJustification: parseJustification, lastPcFor: lastPcFor,
    date: date, iso: iso
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PcEngine = api;
})(this);
