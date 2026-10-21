/* Zebra HK pipeline ↔ order matching engine.
 *
 * Works in the browser (window.ZEngine) and in Node (module.exports) so the
 * matching rules can be tested against real exports without a UI.
 *
 * Input: raw tables {type, name, headers, rows} as produced by readFile() in
 * the page or by tools/build_initial_data.py.
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- detection
  var SIGNATURES = {
    pipeline: ['Opportunity Number', 'Product Name', 'Sales Stage'],
    dsr: ['Part Number', 'Line Item Status', 'Order Number'],
    backlog: ['Distributor to Reseller Order Number', 'Zebra Part Number', 'Quantity'],
    inventory: ['Zebra Part Number', 'On-Hand Quantity']
  };

  function detectType(headerRow) {
    var hs = {};
    (headerRow || []).forEach(function (h) { if (h != null) hs[String(h).trim()] = 1; });
    for (var t in SIGNATURES) {
      if (SIGNATURES[t].every(function (r) { return hs[r]; })) return t;
    }
    return null;
  }

  // Find the typed table inside a 2-D sheet (header row may not be row 0).
  function tableFromGrid(grid, name) {
    for (var i = 0; i < Math.min(grid.length, 15); i++) {
      var t = detectType(grid[i]);
      if (!t) continue;
      var headers = grid[i].map(function (h) { return h == null ? '' : String(h).trim(); });
      var rows = grid.slice(i + 1).filter(function (r) {
        return r && r.some(function (v) { return v !== null && v !== undefined && v !== ''; });
      });
      return { type: t, name: name, headers: headers, rows: rows };
    }
    return null;
  }

  // ------------------------------------------------------------------ helpers
  function str(v) { return v == null ? '' : String(v).trim(); }
  function id(v) { return str(v).replace(/\.0+$/, ''); }
  function num(v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return v;
    var n = parseFloat(String(v).replace(/[,\s]/g, ''));
    return isNaN(n) ? 0 : n;
  }
  function part(v) { return str(v).toUpperCase(); }

  // Accepts Date, ISO string, Excel serial or dd/mm/yyyy (SFDC HK locale).
  function date(v, dmy) {
    if (v == null || v === '') return null;
    if (v instanceof Date) return isNaN(v) ? null : v;
    if (typeof v === 'number') return new Date(Math.round((v - 25569) * 864e5));
    var s = String(v).trim();
    var m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/);
    if (m) {
      var a = +m[1], b = +m[2], y = +m[3];
      var day = dmy === false ? b : a, mon = dmy === false ? a : b;
      if (mon > 12) { var x = day; day = mon; mon = x; }
      return new Date(Date.UTC(y, mon - 1, day));
    }
    var d = new Date(s);
    return isNaN(d) ? null : d;
  }
  function iso(d) { return d ? d.toISOString().slice(0, 10) : ''; }

  function rowsAsObjects(table) {
    var h = table.headers;
    return table.rows.map(function (r) {
      var o = {};
      for (var i = 0; i < h.length; i++) if (h[i]) o[h[i]] = r[i];
      return o;
    });
  }

  // Distributor / account key: first meaningful word of the name.
  // "VSTECS (HK) LIMITED", "VSTECS HK" -> vstecs; "Chinetek(HK)" -> chinetek.
  function accountKey(name) {
    var w = str(name).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ');
    return w[0] || '';
  }

  // End-user name normaliser for fuzzy matching.
  var STOP = ('limited ltd co company corp corporation inc hk hong kong the group holdings holding ' +
    'international intl asia pacific far east retail of and sar china').split(' ');
  var STOPSET = {};
  STOP.forEach(function (w) { STOPSET[w] = 1; });
  function nameTokens(s) {
    var toks = str(s).toLowerCase().replace(/&/g, ' and ').replace(/[’'`?]/g, '')
      .replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
    var out = [], buf = '';
    toks.forEach(function (t) {            // "a s watson" -> "as watson"
      if (t.length === 1) { buf += t; return; }
      if (buf) { out.push(buf); buf = ''; }
      out.push(t);
    });
    if (buf) out.push(buf);
    return out.filter(function (t) { return !STOPSET[t]; });
  }
  function sameEndUser(a, b) {
    var ta = nameTokens(a), tb = nameTokens(b);
    if (!ta.length || !tb.length) return false;
    if (ta.join(' ') === tb.join(' ')) return true;
    var small = ta.length <= tb.length ? ta : tb, big = small === ta ? tb : ta;
    var bigset = {};
    big.forEach(function (t) { bigset[t] = 1; });
    var all = small.every(function (t) { return bigset[t]; });
    return all && (small.length >= 2 || small[0].length >= 4);
  }

  // ------------------------------------------------------------ normalisers
  var STAGE_RANK = { 'Closed - Won': 0, 'Secure': 1, 'Validate': 2 };
  // Only these stages are matched. Identify / Qualify are too early to have orders;
  // Closed-Lost / Closed-Other never will.
  var MATCH_STAGES = /^(Closed - Won|Secure|Validate)$/;
  // Opp names ending -F / -R (also -F2, -R3 …) are forecast / run-rate opps: not checked.
  var IGNORE_NAME = /-(F|R)\d*\s*$/i;

  function normPipeline(table) {
    // Detect date order: SFDC exports follow the user's locale.
    var objs = rowsAsObjects(table), dmy = true;
    objs.slice(0, 200).forEach(function (o) {
      var m = str(o['Created Date']).match(/^(\d{1,2})\/(\d{1,2})\//);
      if (m && +m[2] > 12) dmy = false;
    });
    return objs.map(function (o, i) {
      var qty = num(o['Schedule Quantity']), amt = num(o['Schedule Amount (converted)']);
      var notes = str(o['Forecast Notes']);
      var inv = notes.match(/Fulfil+ment by Disty inventory\?\s*([YN])/i);
      return {
        idx: i,
        oppNo: str(o['Opportunity Number']),
        oppName: str(o['Opportunity Name']),
        stage: str(o['Sales Stage']),
        stageRank: STAGE_RANK.hasOwnProperty(str(o['Sales Stage'])) ? STAGE_RANK[str(o['Sales Stage'])] : 9,
        fq: str(o['First Ship Fiscal Quarter New']),
        fulfillment: str(o['Fulfillment Type']),
        pc: id(o['PC Number']),
        product: part(o['Product Name']),
        productLine: str(o['Product Line']),
        qty: qty,
        amount: amt,
        unit: qty ? amt / qty : 0,
        shipDate: date(o['Schedule Date'] || o['First Ship Date'], dmy),
        orderDate: date(o['Order Date'], dmy),
        created: date(o['Created Date'], dmy),
        distributor: str(o['Primary Distributor']),
        partner: str(o['Primary Channel Partner']),
        endUser: str(o['Account Name']),
        commit: str(o['Commit Category']),
        repInvFlag: inv ? inv[1].toUpperCase() : '',
        owner: str(o['Opportunity Owner'])
      };
    }).filter(function (l) { return l.oppNo && l.product; });
  }

  var EXCLUDE_ORDER_TYPES = /return|credit|service/i;

  function normDsr(table) {
    return rowsAsObjects(table).map(function (o, i) {
      var qty = num(o['Quantity']), amt = num(o['Amount USD SUM']);
      var p = part(o['Part Number']), pto = part(o['PTO - Part Number']);
      var ptoAmt = num(o['PTO - Line Amount (Gbl Currency - USD)']);
      var unit = qty && amt ? amt / qty : (qty && ptoAmt && p === pto ? ptoAmt / qty : null);
      return {
        idx: i,
        account: str(o['Account Name']),
        accountNo: id(o['Account Number']),
        country: str(o['Account Country']),
        reseller: str(o['Reseller Translated Name']),
        endUser: str(o['End User Name']),
        rtm: str(o['Route To Market']),
        orderType: str(o['APAC Order Type']),
        status: str(o['Line Item Status']),
        po: str(o['Purchase Order Number']),
        orderNo: id(o['Order Number']),
        line: str(o['Oracle Line  Number'] || o['Oracle Line Number']),
        booked: date(o['Line Booked Date'] || o['Order Date']),
        ssd: date(o['Scheduled Ship Date']),
        invDate: date(o['ERP Invoice Date']),
        part: p,
        productLine: str(o['Product Line']),
        pc: id(o['Price Concession Number']),
        oppNo: str(o['Opportunity Number']),
        qty: qty,
        amount: amt,
        unit: unit
      };
    }).filter(function (d) {
      return d.part && d.qty > 0 && !EXCLUDE_ORDER_TYPES.test(d.orderType) &&
        (!d.country || d.country === 'Hong Kong');
    });
  }

  function normInventory(table) {
    return rowsAsObjects(table).map(function (o) {
      return {
        dist: str(o['Distributor Name']),
        distNo: id(o['Distributor Account Number']),
        asOf: date(o['Inventory As Of Date']),
        part: part(o['Zebra Part Number']),
        onHand: num(o['On-Hand Quantity']),
        committed: num(o['Committed Quantity']),
        onOrder: num(o['On-Order Quantity']),
        inTransit: num(o['In-Transit Quantity']),
        unit: num(o['Unit Inventory Price'])
      };
    }).filter(function (r) { return r.part; });
  }

  function normBacklog(table) {
    return rowsAsObjects(table).map(function (o, i) {
      return {
        idx: i,
        dist: str(o['Distributor Name']),
        distNo: id(o['Distributor Account Number']),
        resellerOrder: str(o['Distributor to Reseller Order Number']),
        orderDate: date(o['Distributor to Reseller Order Date']),
        zebraSO: id(o['Zebra Sales Order Number']),
        ssd: date(o['Scheduled Shipping Date']),
        asOf: date(o['Backlog As Of Date']),
        po: str(o['PO Number']),
        part: part(o['Zebra Part Number']),
        qty: num(o['Quantity']),
        pc: id(o['Price Concession Number/Project']),
        dealReg: str(o['Deal Registration Number'])
      };
    }).filter(function (r) { return r.part && r.qty > 0; });
  }

  // ------------------------------------------------------------- dataset
  // Merge tables: latest pipeline + latest DSR win; inventory/backlog are kept
  // per distributor (a new upload for the same VAD replaces the old one).
  function buildDataset(tables) {
    var ds = { pipeline: [], dsr: [], inventory: [], backlog: [], sources: {} };
    var latest = {}, perDist = { inventory: {}, backlog: {} };
    tables.forEach(function (t) {
      if (t.type === 'pipeline' || t.type === 'dsr') latest[t.type] = t;
      else if (t.type === 'inventory' || t.type === 'backlog') {
        var rows = t.type === 'inventory' ? normInventory(t) : normBacklog(t);
        var key = rows.length ? (rows[0].distNo || accountKey(rows[0].dist)) : t.name;
        perDist[t.type][key] = { table: t, rows: rows };
      }
    });
    if (latest.pipeline) { ds.pipeline = normPipeline(latest.pipeline); ds.sources.pipeline = [latest.pipeline.name]; }
    if (latest.dsr) { ds.dsr = normDsr(latest.dsr); ds.sources.dsr = [latest.dsr.name]; }
    ['inventory', 'backlog'].forEach(function (k) {
      ds.sources[k] = [];
      Object.keys(perDist[k]).forEach(function (d) {
        ds[k] = ds[k].concat(perDist[k][d].rows);
        ds.sources[k].push(perDist[k][d].table.name);
      });
    });
    return ds;
  }

  // ------------------------------------------------------------- matching
  /* Each pipeline line gets "coverage" pieces, allocated in this order so a
   * DSR line or a unit of stock is never counted twice:
   *   1 opp   – DSR line carries the same Opportunity # (or PC #) and part
   *   2 eu    – DSR line for the same end user + part, not tied to another
   *             opp in this pipeline
   *   3 stock – DSR order with no PC at the same VAD/partner, booked after the
   *             opp was created, whose PO basket covers this opp's parts
   *   4 inv   – free VAD on-hand stock of the part
   *   5 inc   – Zebra open order with no PC for the part at that VAD (preload
   *             stock arriving), not already committed to a VST reseller order
   * Pieces 2–5 without a PC were bought at standard discount / DNP, so they are
   * backend-claim candidates.
   */
  var DAY = 864e5;

  function analyse(ds, opts) {
    opts = opts || {};
    var pipeline = ds.pipeline, dsr = ds.dsr;
    var pipeOpps = {};
    pipeline.forEach(function (l) { pipeOpps[l.oppNo] = 1; });

    var dsrLeft = dsr.map(function (d) { return d.qty; });
    var byOppPart = {}, byPc = {}, byPart = {}, byPo = {}, oppParts = {};
    dsr.forEach(function (d, i) {
      if (d.oppNo) {
        (byOppPart[d.oppNo + '|' + d.part] = byOppPart[d.oppNo + '|' + d.part] || []).push(i);
        (oppParts[d.oppNo] = oppParts[d.oppNo] || {})[d.part] = 1;
      }
      if (d.pc) (byPc[d.pc + '|' + d.part] = byPc[d.pc + '|' + d.part] || []).push(i);
      (byPart[d.part] = byPart[d.part] || []).push(i);
      if (d.po) (byPo[d.po] = byPo[d.po] || []).push(i);
    });

    // VST backlog ↔ DSR (backlog PO number = VAD PO to Zebra).
    var backlogByPoPart = {};
    ds.backlog.forEach(function (b) {
      var k = accountKey(b.dist) + '|' + b.po + '|' + b.part;
      (backlogByPoPart[k] = backlogByPoPart[k] || []).push(b);
    });
    var backlogRows = ds.backlog.map(function (b) {
      var lines = (byPo[b.po] || []).filter(function (i) {
        return dsr[i].part === b.part && accountKey(dsr[i].account) === accountKey(b.dist);
      }).map(function (i) { return dsr[i]; });
      var open = lines.filter(function (d) { return d.status === 'Open Order'; });
      var zebra = !lines.length ? 'not-in-dsr' : open.length ? 'zebra-open' : 'zebra-shipped';
      var opp = lines.filter(function (d) { return d.oppNo; })[0];
      return { b: b, dsrLines: lines, zebra: zebra, oppNo: opp ? opp.oppNo : '', pc: opp ? opp.pc : '',
        endUser: opp ? opp.endUser : '', reseller: opp ? opp.reseller : '' };
    });
    // DSR lines already promised to a reseller order at the VAD.
    var dsrInBacklog = {};
    backlogRows.forEach(function (r) { r.dsrLines.forEach(function (d) { dsrInBacklog[d.idx] = r; }); });

    // Free VAD stock = on-hand − committed − backlog qty that Zebra already
    // shipped (or that is not in the DSR, so must come from stock).
    var stock = {};
    ds.inventory.forEach(function (r) {
      var k = accountKey(r.dist) + '|' + r.part;
      var s = stock[k] || (stock[k] = { dist: r.dist, key: accountKey(r.dist), part: r.part, onHand: 0, committed: 0,
        backlogHold: 0, value: 0, asOf: r.asOf, alloc: [] });
      s.onHand += r.onHand; s.committed += r.committed; s.value += r.onHand * r.unit;
    });
    backlogRows.forEach(function (r) {
      if (r.zebra === 'zebra-open') return;
      var s = stock[accountKey(r.b.dist) + '|' + r.b.part];
      if (s) s.backlogHold += r.b.qty;
    });
    Object.keys(stock).forEach(function (k) {
      var s = stock[k];
      s.unit = s.onHand ? s.value / s.onHand : 0;
      s.free = Math.max(0, s.onHand - s.committed - s.backlogHold);
      s.left = s.free;
    });

    // Order lines: won first, then by stage and ship date.
    var ignored = { lines: 0, opps: {} };
    var active = pipeline.filter(function (l) {
      if (!MATCH_STAGES.test(l.stage)) return false;
      if (IGNORE_NAME.test(l.oppName)) { ignored.lines++; ignored.opps[l.oppNo] = 1; return false; }
      return true;
    });
    active.sort(function (a, b) {
      return a.stageRank - b.stageRank || ((a.shipDate || 0) - (b.shipDate || 0)) || a.idx - b.idx;
    });

    var res = {};
    active.forEach(function (l) {
      res[l.idx] = { line: l, pieces: [], hints: [], need: l.qty, covered: 0 };
    });
    function lineKey(l) { return l.idx; }
    function take(r, i, kind, extra) {
      var want = r.need - r.covered;
      if (want <= 0 || dsrLeft[i] <= 0) return;
      var q = Math.min(want, dsrLeft[i]);
      dsrLeft[i] -= q;
      r.covered += q;
      var d = dsr[i];
      r.pieces.push(Object.assign({ kind: kind, qty: q, dsr: d, priced: d.pc ? 'pc' : 'std',
        vst: dsrInBacklog[d.idx] || null }, extra || {}));
    }
    function accountKeysFor(l) {
      var keys = {};
      if (l.distributor) keys[accountKey(l.distributor)] = 1;
      else {
        if (l.partner) keys[accountKey(l.partner)] = 1;
        keys[accountKey(l.endUser)] = 1;
      }
      return keys;
    }
    var mindate = function (l, days) { return l.created ? new Date(l.created.getTime() - days * DAY) : null; };

    // 1. Opportunity / PC linked
    active.forEach(function (l) {
      var r = res[lineKey(l)];
      var idxs = (byOppPart[l.oppNo + '|' + l.product] || []).concat(l.pc ? (byPc[l.pc + '|' + l.product] || []) : []);
      idxs.sort(function (a, b) { return (dsr[a].booked || 0) - (dsr[b].booked || 0); });
      idxs.forEach(function (i) { take(r, i, 'opp'); });
    });
    // Opp in DSR but this part missing → substitution hint
    active.forEach(function (l) {
      var r = res[lineKey(l)];
      if (r.covered === 0 && oppParts[l.oppNo] && !oppParts[l.oppNo][l.product]) {
        r.hints.push({ kind: 'opp-other-parts', parts: Object.keys(oppParts[l.oppNo]) });
      }
    });

    // 2. End user + part
    active.forEach(function (l) {
      var r = res[lineKey(l)];
      if (r.covered >= r.need) return;
      var since = mindate(l, 30);
      (byPart[l.product] || []).forEach(function (i) {
        var d = dsr[i];
        if (!d.endUser || dsrLeft[i] <= 0) return;
        if (d.oppNo && pipeOpps[d.oppNo] && d.oppNo !== l.oppNo) return;
        if (since && d.booked && d.booked < since) return;
        if (!sameEndUser(d.endUser, l.endUser)) return;
        take(r, i, 'eu');
      });
    });

    // 3. Stock order without PC, matched by PO basket
    var oppLines = {};
    active.forEach(function (l) { (oppLines[l.oppNo] = oppLines[l.oppNo] || []).push(l); });
    Object.keys(oppLines).forEach(function (opp) {
      var lines = oppLines[opp].filter(function (l) { return res[l.idx].covered < res[l.idx].need; });
      if (!lines.length) return;
      var parts = {};
      lines.forEach(function (l) { parts[l.product] = 1; });
      var nParts = Object.keys(parts).length;
      var l0 = lines[0], keys = accountKeysFor(l0), since = mindate(l0, 14);
      // PO must be booked between opp creation and ~90 days after its latest ship date
      var lastShip = lines.reduce(function (m, l) { return l.shipDate && (!m || l.shipDate > m) ? l.shipDate : m; }, null);
      var until = lastShip ? new Date(lastShip.getTime() + 90 * DAY) : null;
      // candidate POs: no-PC lines at the right account containing any part
      var poHits = {};
      Object.keys(parts).forEach(function (p) {
        (byPart[p] || []).forEach(function (i) {
          var d = dsr[i];
          if (d.pc || d.oppNo || dsrLeft[i] <= 0 || !keys[accountKey(d.account)]) return;
          if (since && d.booked && d.booked < since) return;
          if (until && d.booked && d.booked > until) return;
          var h = poHits[d.po] || (poHits[d.po] = { parts: {}, idxs: [] });
          h.parts[p] = 1; h.idxs.push(i);
        });
      });
      Object.keys(poHits).map(function (po) {
        var h = poHits[po], n = Object.keys(h.parts).length;
        return { po: po, h: h, n: n, cov: n / nParts };
      }).sort(function (a, b) { return b.cov - a.cov; }).forEach(function (c) {
        var conf = null;
        if (nParts >= 2 && c.n >= 2 && c.cov >= 0.6) conf = 'high';
        else if (nParts >= 2 && c.n >= 2 && c.cov >= 0.4) conf = 'medium';
        else if (nParts === 1) {
          // single-part opp: exact qty on one PO line counts as medium
          var q = lines.reduce(function (s, l) { return s + l.qty - res[l.idx].covered; }, 0);
          if (c.h.idxs.some(function (i) { return dsr[i].qty === q; })) conf = 'medium';
        }
        if (!conf) {
          lines.forEach(function (l) {
            if (c.h.parts[l.product]) res[l.idx].hints.push({ kind: 'stock-part-only', po: c.po });
          });
          return;
        }
        lines.forEach(function (l) {
          if (!c.h.parts[l.product]) return;
          c.h.idxs.forEach(function (i) {
            if (dsr[i].part === l.product) take(res[l.idx], i, 'stock', { conf: conf, basket: c.n + '/' + nParts });
          });
        });
      });
    });

    // Stock on hand today only helps lines that still have to ship.
    var invAsOf = ds.inventory.reduce(function (m, x) { return x.asOf && (!m || x.asOf > m) ? x.asOf : m; }, null) ||
      opts.today || new Date();
    var stockFrom = new Date(invAsOf.getTime() - 60 * DAY);
    function current(l) { return !l.shipDate || l.shipDate >= stockFrom; }

    // 4. Free VAD stock (primary distributor first, then other VADs as hints)
    active.forEach(function (l) {
      var r = res[lineKey(l)];
      if (r.covered >= r.need || !current(l)) return;
      Object.keys(accountKeysFor(l)).forEach(function (k) {
        var s = stock[k + '|' + l.product];
        if (!s || s.left <= 0) return;
        var q = Math.min(s.left, r.need - r.covered);
        s.left -= q; r.covered += q;
        s.alloc.push({ line: l, qty: q });
        r.pieces.push({ kind: 'inv', qty: q, stock: s, priced: 'std', unit: s.unit });
      });
    });

    // 5. Incoming no-PC Zebra open orders (preload) not tied to a reseller order
    active.forEach(function (l) {
      var r = res[lineKey(l)];
      if (r.covered >= r.need || !current(l)) return;
      var keys = accountKeysFor(l);
      (byPart[l.product] || []).forEach(function (i) {
        var d = dsr[i];
        if (d.status !== 'Open Order' || d.pc || d.oppNo || !keys[accountKey(d.account)]) return;
        if (dsrInBacklog[d.idx]) return;
        take(r, i, 'inc');
      });
    });

    // Other-VAD stock hint for whatever is still uncovered
    active.forEach(function (l) {
      var r = res[lineKey(l)];
      if (r.covered >= r.need || !current(l)) return;
      var keys = accountKeysFor(l);
      Object.keys(stock).forEach(function (k) {
        var s = stock[k];
        if (s.part === l.product && !keys[s.key] && s.left > 0) {
          r.hints.push({ kind: 'other-vad-stock', dist: s.dist, qty: s.left });
        }
      });
    });

    // ---------------------------------------------------------- status
    var lines = active.map(function (l) {
      var r = res[l.idx];
      var sum = function (k) { return r.pieces.filter(function (p) { return p.kind === k; }).reduce(function (s, p) { return s + p.qty; }, 0); };
      r.q = { opp: sum('opp'), eu: sum('eu'), stock: sum('stock'), inv: sum('inv'), inc: sum('inc') };
      r.shipped = r.pieces.filter(function (p) { return p.dsr && p.dsr.status === 'Shipped'; }).reduce(function (s, p) { return s + p.qty; }, 0);
      r.open = r.pieces.filter(function (p) { return p.dsr && p.dsr.status === 'Open Order'; }).reduce(function (s, p) { return s + p.qty; }, 0);
      r.claimQty = r.pieces.filter(function (p) { return p.priced === 'std'; }).reduce(function (s, p) { return s + p.qty; }, 0);
      r.claimEst = r.pieces.filter(function (p) { return p.priced === 'std'; }).reduce(function (s, p) {
        var u = p.dsr ? p.dsr.unit : p.unit;
        return s + (u && l.unit ? Math.max(0, u - l.unit) * p.qty : 0);
      }, 0);
      r.vstConfirmed = r.pieces.some(function (p) { return p.vst; });
      r.status = statusOf(r);
      return r;
    });

    return {
      lines: lines,
      byIdx: res,
      stock: stock,
      backlog: backlogRows,
      zebraOpen: zebraOpenView(ds, res, pipeOpps, dsrInBacklog, dsrLeft),
      ignored: { lines: ignored.lines, opps: Object.keys(ignored.opps).length },
      asOf: asOfDates(ds)
    };
  }

  function statusOf(r) {
    var l = r.line;
    if (r.covered <= 0) {
      if (r.hints.some(function (h) { return h.kind === 'opp-other-parts'; })) return 'substituted';
      return 'not-ordered';
    }
    var full = r.covered >= r.need;
    var main = ['opp', 'eu', 'stock', 'inv', 'inc'].filter(function (k) { return r.q[k] > 0; })[0];
    if (!full) return 'partial';
    if (main === 'opp') return r.open > 0 ? 'zebra-backlog' : 'shipped';
    if (main === 'eu') return r.claimQty ? 'eu-claim' : (r.open > 0 ? 'zebra-backlog' : 'shipped');
    if (main === 'stock') return 'stock-claim';
    if (main === 'inv') return 'vad-stock';
    return 'incoming';
  }

  // Zebra backlog view: every DSR open order line and what it is tied to.
  function zebraOpenView(ds, res, pipeOpps, dsrInBacklog) {
    var usedBy = {};
    Object.keys(res).forEach(function (k) {
      res[k].pieces.forEach(function (p) {
        if (p.dsr) (usedBy[p.dsr.idx] = usedBy[p.dsr.idx] || []).push({ line: res[k].line, qty: p.qty, kind: p.kind });
      });
    });
    return ds.dsr.filter(function (d) { return d.status === 'Open Order'; }).map(function (d) {
      var tie = d.oppNo ? (pipeOpps[d.oppNo] ? 'opp-in-pipeline' : 'opp-not-in-pipeline') : (d.pc ? 'pc-only' : 'no-pc');
      return { d: d, tie: tie, usedBy: usedBy[d.idx] || [], vst: dsrInBacklog[d.idx] || null };
    });
  }

  function asOfDates(ds) {
    var max = function (arr, f) {
      return arr.reduce(function (m, x) { var v = f(x); return v && (!m || v > m) ? v : m; }, null);
    };
    return {
      pipeline: max(ds.pipeline, function (l) { return l.created; }),
      dsr: max(ds.dsr, function (d) { return d.booked; }),
      inventory: max(ds.inventory, function (r) { return r.asOf; }),
      backlog: max(ds.backlog, function (b) { return b.asOf || b.orderDate; })
    };
  }

  var api = {
    detectType: detectType, tableFromGrid: tableFromGrid, buildDataset: buildDataset, analyse: analyse,
    sameEndUser: sameEndUser, accountKey: accountKey, parseDate: date, iso: iso
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ZEngine = api;
})(this);
