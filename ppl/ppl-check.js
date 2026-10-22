/* PPL 合規檢查引擎（繁體中文版）。
 *
 * 由「PPL 合規檢查器（網頁版）」移植：七條合規標準、季度 × 階段透視、
 * Secure 未下單清單，另加 SFDC 連結。瀏覽器（window.PPLCheck）與 Node
 * （module.exports）都可用，方便用合成資料測試。
 *
 * 輸入：二維表格 grid（第一列或前 40 列內是表頭），儲存格為字串或數字。
 */
(function (root) {
  'use strict';

  var DEFAULTS = {
    recordType: 'Zebra Opportunity',
    minFirstShip: '2026-01-01',   // 只查 First Ship Date ≥ 這天
    s2MinEdit: '2026-05-01',      // 標準2：只看這天之後修改過的
    s7MinFirstShip: '2026-08-01', // 標準7：只看發貨日 ≥ 這天
    amountThreshold: 50000,
    maxUnmodifiedDays: 90,
    sfdcDomain: 'https://zebra.lightning.force.com'
  };

  var STAGE_COMMIT = { 'Identify': '', 'Qualify': '', 'Validate': 'Upside', 'Secure': 'Commit', 'Closed - Won': 'Shipped/booked' };
  var CHECK_STAGES = Object.keys(STAGE_COMMIT);
  var S2_STAGES = ['Identify', 'Qualify'];

  var RULES = [
    { id: 1, short: '階段與 Commit 不符', desc: 'Identify / Qualify 的 Commit 要空白，Validate = Upside，Secure = Commit，Closed - Won = Shipped/booked。' },
    { id: 2, short: '超過 90 天未更新', desc: 'Identify / Qualify 的 Last Modified Date 在 2026-05-01 之後，但距截止日（下週三）已超過 90 天。2026-05-01 之前修改的不提醒。' },
    { id: 3, short: '發貨日已過仍未關閉', desc: '發貨週（週一至週日）的 POS 報表在下週三收到，收到後才更新 SFDC。所以發貨週之後的週三過了，階段仍不是 Closed 才算違規；這週和上週（未到週三）發貨的不提醒。' },
    { id: 4, short: '≥ 50k 缺 Forecast Notes', desc: '整個機會的 Schedule Amount 合計 ≥ US$50,000，階段是 Validate 或 Secure，Forecast Notes 卻是空白。' },
    { id: 5, short: 'Fulfillment Type 空白', desc: 'Fulfillment Type 不可以空白。' },
    { id: 6, short: '未到發貨日已 Closed - Won', desc: 'First Ship Date 在截止日（下週三）之後，階段卻已是 Closed - Won。' },
    { id: 7, short: 'CRSD 問題', desc: '發貨日 ≥ 2026-08-01 的機會：CRSD 不可空白；First Ship Date 與 CRSD 可以不同日，但要在同一財季；Commit = Shipped/booked 時 CRSD 要早於今天。' }
  ];

  var STAGE_ORDER = ['Identify', 'Qualify', 'Validate', 'Secure', 'Closed - Won', 'Closed - Lost', 'Closed - Other', 'Run Rate'];
  var EXCLUDE_STAGES = ['Closed - Lost', 'Closed - Other'];

  // ------------------------------------------------------------ helpers
  function pad(n) { return String(n).padStart(2, '0'); }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function str(v) { return v == null ? '' : String(v).trim(); }
  function num(v) {
    if (typeof v === 'number') return v;
    var n = parseFloat(str(v).replace(/[,\s$]/g, ''));
    return isNaN(n) ? null : n;
  }
  function addDays(isoDay, n) {
    var p = isoDay.split('-');
    return ymd(new Date(+p[0], +p[1] - 1, +p[2] + n));
  }
  function todayOf(opts) { return opts && opts.today ? opts.today : ymd(new Date()); }

  // 截止日 = 下週三（今天是週三就是今天）
  function nextWednesday(today) {
    var p = today.split('-'), d = new Date(+p[0], +p[1] - 1, +p[2]);
    return ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + (3 - d.getDay() + 7) % 7));
  }

  // POS 更新期限：發貨週（週一至週日）之後的週三。這週的生意下週三才收到 POS 報表，收到後才更新 SFDC。
  function posDeadline(isoDay) {
    var p = isoDay.split('-'), d = new Date(+p[0], +p[1] - 1, +p[2]);
    var monday = (d.getDay() + 6) % 7;   // 0 = 週一
    return ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() - monday + 9));
  }

  // 自然季 = Zebra 財季（財年與曆年相同）
  function fq(isoDay) { return isoDay.slice(0, 4) + ' Q' + (Math.floor((+isoDay.slice(5, 7) - 1) / 3) + 1); }
  function qSort(a, b) {
    var pa = /(\d{4}) Q(\d)/.exec(a), pb = /(\d{4}) Q(\d)/.exec(b);
    if (pa && pb) return (+pa[1] - +pb[1]) || (+pa[2] - +pb[2]);
    return a < b ? -1 : a > b ? 1 : 0;
  }

  // 支援 YYYY-M-D、YYYY/M/D、M/D/YYYY、D/M/YYYY（首段 > 12 視為日）
  function parseDate(s) {
    s = str(s).split(' ')[0].split('T')[0];
    if (!s) return null;
    var m = /^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/.exec(s);
    if (m) return ymd(new Date(+m[1], +m[2] - 1, +m[3]));
    m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(s);
    if (m) {
      var a = +m[1], b = +m[2];
      return ymd(new Date(+m[3], (a > 12 ? b : a) - 1, a > 12 ? a : b));
    }
    return null;
  }

  // ------------------------------------------------------------ grid prep
  var HEADER_KEYS = ['Opportunity Number', 'Opportunity Name', 'Sales Stage', 'Opportunity Owner', 'Commit Category',
    'First Ship Date', 'Last Modified Date', 'Opportunity Record Type'];

  // 前 40 列中找最像表頭的一列（至少 2 個關鍵欄），去掉上面的標題 / 篩選說明。
  function locateHeader(grid) {
    var best = -1, bestN = 0;
    for (var i = 0; i < Math.min(grid.length, 40); i++) {
      var cells = (grid[i] || []).map(str), n = 0;
      HEADER_KEYS.forEach(function (k) { if (cells.indexOf(k) >= 0) n++; });
      if (n > bestN) { bestN = n; best = i; }
    }
    return bestN >= 2 && best > 0 ? grid.slice(best) : grid;
  }

  // Excel 日期序號（二進位 .xlsx）→ YYYY-MM-DD
  function serialToIso(n) {
    var d = new Date(Math.round((n - 25569) * 864e5));
    return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  }

  /* 整理表格：找表頭、轉字串、去空列，日期欄統一成 YYYY-MM-DD。
   * 日期欄整欄判斷格式：只要有一格首段 > 12 就整欄當 日/月/年，否則 月/日/年。 */
  function prepare(grid) {
    var rows = locateHeader(grid || []);
    if (!rows.length) return rows;
    var headers = rows[0].map(str);
    rows = [headers].concat(rows.slice(1).map(function (r) {
      return headers.map(function (h, ci) {
        var v = r ? r[ci] : '';
        if (v instanceof Date) return ymd(v);
        if (typeof v === 'number' && /date/i.test(h) && v > 20000 && v < 80000) return serialToIso(v);
        return str(v);
      });
    }).filter(function (r) { return r.some(function (c) { return c !== ''; }); }));
    headers.forEach(function (h, ci) {
      if (!/date/i.test(h)) return;
      var re = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/, dm = false, any = false;
      for (var i = 1; i < rows.length; i++) {
        var m = re.exec(rows[i][ci]);
        if (m) { any = true; if (+m[1] > 12) { dm = true; break; } }
      }
      if (!any) return;
      for (var j = 1; j < rows.length; j++) {
        var x = re.exec(rows[j][ci]);
        if (!x) continue;
        rows[j][ci] = dm ? x[3] + '-' + pad(+x[2]) + '-' + pad(+x[1]) : x[3] + '-' + pad(+x[1]) + '-' + pad(+x[2]);
      }
    });
    return rows;
  }

  function columnIndex(headers) {
    var lower = headers.map(function (h) { return h.toLowerCase(); });
    return function (names) {
      for (var i = 0; i < names.length; i++) {
        var k = lower.indexOf(names[i].toLowerCase());
        if (k >= 0) return k;
      }
      return -1;
    };
  }

  var COLS = {
    opp: ['Opportunity Number'], name: ['Opportunity Name'], owner: ['Opportunity Owner'],
    rectype: ['Opportunity Record Type'], stage: ['Sales Stage'], commit: ['Commit Category'],
    lastMod: ['Last Modified Date'], firstShip: ['First Ship Date'],
    amount: ['Schedule Amount (converted)'], notes: ['Forecast Notes'], fulfill: ['Fulfillment Type'],
    crsd: ['Customer Requested Ship Date'],
    oppId: ['Opportunity ID', 'Opportunity ID (18)', 'Opportunity: ID', 'Opportunity Id 18', 'Opp ID'],
    quarter: ['First Ship Fiscal Quarter New', 'First Ship Fiscal Quarter'],
    svc: ['Is Service Product ?', 'Is Service Product?', 'Is Service Product'],
    reseller: ['Reseller has ordered via Distribution']
  };
  function indexes(headers) {
    var find = columnIndex(headers), idx = {};
    Object.keys(COLS).forEach(function (k) { idx[k] = find(COLS[k]); });
    return idx;
  }
  // 18 位 / 15 位 Opportunity ID（006 開頭）
  function cleanId(v) { v = str(v); return /^006[A-Za-z0-9]{12}([A-Za-z0-9]{3})?$/.test(v) ? v : ''; }

  // ------------------------------------------------------------ check
  function check(rows, opts) {
    opts = Object.assign({}, DEFAULTS, opts || {});
    if (!rows.length) throw new Error('表格是空的');
    var idx = indexes(rows[0]);
    var has = function (k) { return idx[k] >= 0; };
    if (!has('opp') || !has('stage')) throw new Error('報表缺少 Opportunity Number 或 Sales Stage 欄，請確認是 Opportunity 報表');

    var skipped = [];
    if (!has('commit')) skipped.push('標準1（缺 Commit Category 欄）');
    if (!has('lastMod')) skipped.push('標準2（缺 Last Modified Date 欄）');
    if (!has('firstShip')) skipped.push('標準3、6（缺 First Ship Date 欄）');
    if (!has('amount') || !has('notes')) skipped.push('標準4（缺 Schedule Amount (converted) 或 Forecast Notes 欄）');
    if (!has('fulfill')) skipped.push('標準5（缺 Fulfillment Type 欄）');
    if (!has('firstShip') || !has('crsd')) skipped.push('標準7（缺 First Ship Date 或 Customer Requested Ship Date 欄）');
    var notes = [];
    if (!has('rectype')) notes.push('報表沒有 Opportunity Record Type 欄，所有記錄類型都會檢查。');
    if (!has('firstShip')) notes.push('報表沒有 First Ship Date 欄，不按發貨日篩選。');

    var today = todayOf(opts), cutoff = nextWednesday(today);
    var cutoff90 = addDays(cutoff, -opts.maxUnmodifiedDays);
    var cell = function (r, k) { return has(k) ? str(r[idx[k]]) : ''; };

    var agg = new Map(), checkedLines = 0;
    for (var i = 1; i < rows.length; i++) {
      var r = rows[i], opp = cell(r, 'opp'), stage = cell(r, 'stage');
      if (!opp) continue;
      if (has('rectype') && cell(r, 'rectype') !== opts.recordType) continue;
      if (CHECK_STAGES.indexOf(stage) < 0) continue;
      if (has('firstShip')) {
        var fsd = parseDate(cell(r, 'firstShip'));
        if (!fsd || fsd < opts.minFirstShip) continue;
      }
      checkedLines++;
      var info = agg.get(opp);
      if (!info) {
        info = { opp: opp, stage: stage, name: '', owner: '', commit: '', lastMod: '', firstShip: '', notes: '',
          fulfill: '', crsd: '', oppId: '', amount: 0, issues: [] };
        agg.set(opp, info);
      }
      // 每個欄位取該機會第一個非空值；金額全部加總
      ['name', 'owner', 'commit', 'lastMod', 'firstShip', 'notes', 'fulfill', 'crsd'].forEach(function (k) {
        if (!info[k]) info[k] = cell(r, k);
      });
      if (!info.oppId) info.oppId = cleanId(cell(r, 'oppId'));
      var a = has('amount') ? num(r[idx.amount]) : null;
      if (a != null) info.amount += a;
    }

    var stats = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 };
    var violations = [];
    var money = function (v) { return 'US$' + Math.round(v).toLocaleString('en-US'); };
    var label = function (v) { return v === '' ? '空白' : v; };
    agg.forEach(function (info) {
      var stage = info.stage, add = function (rule, text) { info.issues.push({ rule: rule, text: text }); };
      if (has('commit')) {
        var expect = STAGE_COMMIT[stage];
        if (info.commit !== expect) add(1, stage + ' 階段的 Commit 應為「' + label(expect) + '」，實際為「' + label(info.commit) + '」');
      }
      if (has('lastMod') && S2_STAGES.indexOf(stage) >= 0) {
        var lm = parseDate(info.lastMod);
        if (lm && lm >= opts.s2MinEdit && lm < cutoff90) add(2, '上次修改 ' + lm + '，距截止日 ' + cutoff + ' 已超過 ' + opts.maxUnmodifiedDays + ' 天');
      }
      var fs = has('firstShip') ? parseDate(info.firstShip) : null;
      if (fs && stage.indexOf('Closed') !== 0 && today > posDeadline(fs)) {
        add(3, '發貨日 ' + fs + '，POS 更新期限 ' + posDeadline(fs) + '（發貨週之後的週三）已過，階段仍是 ' + stage);
      }
      if (has('amount') && has('notes') && (stage === 'Validate' || stage === 'Secure') &&
          info.amount >= opts.amountThreshold && !info.notes) {
        add(4, '機會總金額 ' + money(info.amount) + ' ≥ 50k，階段 ' + stage + '，未填 Forecast Notes');
      }
      if (has('fulfill') && !info.fulfill) add(5, 'Fulfillment Type 空白');
      if (fs && stage === 'Closed - Won' && fs > cutoff) add(6, '發貨日 ' + fs + ' 在下週三（' + cutoff + '）之後，卻已是 Closed - Won');
      if (fs && has('crsd') && fs >= opts.s7MinFirstShip) {
        var cr = parseDate(info.crsd);
        if (!cr) add(7, '發貨日 ' + fs + ' 的 CRSD 空白（要填與發貨日同一財季的日期）');
        else if (fq(cr) !== fq(fs)) add(7, '發貨日 ' + fs + '（' + fq(fs) + '）與 CRSD ' + cr + '（' + fq(cr) + '）不在同一財季');
        else if (info.commit === 'Shipped/booked' && cr >= today) add(7, '已 Shipped/booked，但 CRSD ' + cr + ' 不是過去日期（要早於今天 ' + today + '）');
      }
      if (!info.issues.length) return;
      info.issues.forEach(function (x) { stats[x.rule]++; });
      violations.push({ opp: info.opp, oppId: info.oppId, name: info.name, owner: info.owner, stage: stage,
        amount: info.amount, firstShip: fs || '', issues: info.issues });
    });
    violations.sort(function (a, b) { return a.opp < b.opp ? -1 : a.opp > b.opp ? 1 : 0; });
    return { today: today, cutoff: cutoff, totalRows: rows.length - 1, checkedLines: checkedLines, checkedOpps: agg.size,
      stats: stats, violations: violations, skipped: skipped, notes: notes, hasOwner: has('owner') };
  }

  // ------------------------------------------------------------ pivot
  /* 行 = First Ship Fiscal Quarter New，列 = Sales Stage。
   * o.metric: 'amount' | 'rows'；o.exclude: 'lostother' | 'none'；o.owner；o.svc: '' | '0' | '1' */
  function pivot(rows, o) {
    o = Object.assign({ metric: 'amount', exclude: 'lostother', owner: '', svc: '' }, o || {});
    var idx = indexes(rows[0] || []);
    if (idx.quarter < 0 || idx.stage < 0) throw new Error('報表缺少 First Ship Fiscal Quarter 或 Sales Stage 欄');
    var stages = {}, quarters = {}, cells = {}, qTotal = {}, sTotal = {}, grand = 0;
    for (var i = 1; i < rows.length; i++) {
      var r = rows[i], q = str(r[idx.quarter]), s = str(r[idx.stage]);
      if (!q || !s) continue;
      if (o.exclude === 'lostother' && EXCLUDE_STAGES.indexOf(s) >= 0) continue;
      if (o.owner && (idx.owner < 0 || str(r[idx.owner]) !== o.owner)) continue;
      if (o.svc !== '' && (idx.svc < 0 ? '' : str(r[idx.svc])) !== o.svc) continue;
      var v = o.metric === 'amount' ? (num(r[idx.amount]) || 0) : 1;
      quarters[q] = 1; stages[s] = 1;
      var k = q + '\u0000' + s;
      cells[k] = (cells[k] || 0) + v;
      qTotal[q] = (qTotal[q] || 0) + v;
      sTotal[s] = (sTotal[s] || 0) + v;
      grand += v;
    }
    var stageList = STAGE_ORDER.filter(function (s) { return stages[s]; })
      .concat(Object.keys(stages).filter(function (s) { return STAGE_ORDER.indexOf(s) < 0; }).sort());
    var quarterList = Object.keys(quarters).sort(qSort);
    var hot = null, hotV = -Infinity;
    if (o.metric === 'amount') Object.keys(cells).forEach(function (k) { if (cells[k] > hotV) { hotV = cells[k]; hot = k; } });
    return {
      stageList: stageList, quarterList: quarterList, grandTotal: grand,
      cell: function (q, s) { return cells[q + '\u0000' + s] || 0; },
      isHot: function (q, s) { return hot === q + '\u0000' + s; },
      qTotal: function (q) { return qTotal[q] || 0; },
      sTotal: function (s) { return sTotal[s] || 0; }
    };
  }

  // ------------------------------------------------------------ Secure 未下單
  // Sales Stage = Secure 且 Reseller has ordered via Distribution = 0，按季度分組。
  function secureNotOrdered(rows, o) {
    o = o || {};
    var idx = indexes(rows[0] || []);
    if (idx.quarter < 0 || idx.stage < 0 || idx.reseller < 0) {
      throw new Error('報表缺少 Secure 未下單所需的欄（First Ship Fiscal Quarter / Sales Stage / Reseller has ordered via Distribution）');
    }
    var agg = new Map();
    for (var i = 1; i < rows.length; i++) {
      var r = rows[i], opp = idx.opp >= 0 ? str(r[idx.opp]) : '';
      if (!opp || str(r[idx.stage]) !== 'Secure' || str(r[idx.reseller]) !== '0') continue;
      var owner = idx.owner >= 0 ? str(r[idx.owner]) : '';
      if (o.owner && owner !== o.owner) continue;
      var x = agg.get(opp);
      if (!x) { x = { opp: opp, oppId: '', name: '', owner: '', quarter: '', amount: 0 }; agg.set(opp, x); }
      if (!x.name && idx.name >= 0) x.name = str(r[idx.name]);
      if (!x.owner) x.owner = owner;
      if (!x.quarter) x.quarter = str(r[idx.quarter]);
      if (!x.oppId && idx.oppId >= 0) x.oppId = cleanId(r[idx.oppId]);
      var a = idx.amount >= 0 ? num(r[idx.amount]) : null;
      if (a != null) x.amount += a;
    }
    return Array.from(agg.values()).sort(function (a, b) { return qSort(a.quarter, b.quarter) || (a.opp < b.opp ? -1 : 1); });
  }

  // 只保留檢查用得著的欄（存進瀏覽器時省空間）
  function slim(rows) {
    if (!rows.length) return rows;
    var want = {};
    Object.keys(COLS).forEach(function (k) { COLS[k].forEach(function (n) { want[n.toLowerCase()] = 1; }); });
    var keep = rows[0].map(function (h, i) { return want[h.toLowerCase()] ? i : -1; }).filter(function (i) { return i >= 0; });
    return rows.map(function (r) { return keep.map(function (i) { return r[i]; }); });
  }

  // 依出現次數（多到少）列出 Owner
  function owners(rows) {
    var idx = indexes(rows[0] || []), cnt = {};
    if (idx.owner < 0) return [];
    for (var i = 1; i < rows.length; i++) { var o = str(rows[i][idx.owner]); if (o) cnt[o] = (cnt[o] || 0) + 1; }
    return Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a] || (a < b ? -1 : 1); });
  }

  // ------------------------------------------------------------ SFDC links
  function b64(s) {
    if (typeof btoa === 'function') return btoa(unescape(encodeURIComponent(s)));
    return Buffer.from(s, 'utf8').toString('base64');
  }
  /* 有 Opportunity ID（006…）→ 直接開記錄頁 /lightning/r/Opportunity/{id}/view（官方 URL 格式）。
   * 只有 Opportunity Number → 開 Lightning 全域搜尋頁。搜尋頁用 /one/one.app# + Base64 JSON，
   * 是 Salesforce 內部格式，官方未公開支援，日後版本可能失效；介面同時把編號複製到剪貼簿作後備。 */
  function sfdcLink(opp, oppId, domain) {
    domain = String(domain || DEFAULTS.sfdcDomain).replace(/\/+$/, '');
    if (cleanId(oppId)) return { kind: 'record', url: domain + '/lightning/r/Opportunity/' + cleanId(oppId) + '/view' };
    var payload = {
      componentDef: 'forceSearch:searchPageDesktop',
      attributes: {
        term: opp,
        scopeMap: { type: 'TOP_RESULTS', namespace: '', label: 'Top Results', labelPlural: 'Top Results', resultsCmp: 'forceSearch:predictedResults' },
        context: { FILTERS: {}, searchSource: 'ASSISTANT_DIALOG', disableIntentQuery: false, disableSpellCorrection: false, debugInfo: {} },
        groupId: 'DEFAULT'
      },
      state: {}
    };
    return { kind: 'search', url: domain + '/one/one.app#' + b64(JSON.stringify(payload)) };
  }

  var api = {
    DEFAULTS: DEFAULTS, RULES: RULES, STAGE_COMMIT: STAGE_COMMIT,
    prepare: prepare, slim: slim, check: check, pivot: pivot, secureNotOrdered: secureNotOrdered, owners: owners,
    sfdcLink: sfdcLink, parseDate: parseDate, nextWednesday: nextWednesday, posDeadline: posDeadline, fq: fq
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PPLCheck = api;
})(this);
