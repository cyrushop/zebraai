/* PPL 合規檢查介面。需要先載入 ppl-check.js（window.PPLCheck）；讀二進位 .xlsx 需要 SheetJS（window.XLSX）。
 *
 *   var w = PPLWidget.mount(document.getElementById('ppl'), { storageKey: 'pos.ppl' });
 *   w.load(grid, fileName);   // 宿主 App 已讀好的表格，可直接交給檢查器
 */
(function (root) {
  'use strict';
  var P = root.PPLCheck;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function usd(v) { return 'US$' + Math.round(v || 0).toLocaleString('en-US'); }
  function ls(key) {
    return {
      get: function (d) { try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
      set: function (v) { try { localStorage.setItem(key, JSON.stringify(v)); return true; } catch (e) { return false; } }
    };
  }

  // SFDC「Export Details」的 .xls 其實是 HTML 表格；真正的 .xls / .xlsx 交給 SheetJS。
  function readFile(file) {
    return file.arrayBuffer().then(function (buf) {
      var b = new Uint8Array(buf.slice(0, 4));
      if ((b[0] === 0x50 && b[1] === 0x4B) || (b[0] === 0xD0 && b[1] === 0xCF)) {
        if (!root.XLSX) throw new Error('Excel 解析庫未載入，請連網後重新整理，或改用 SFDC 匯出的 .xls（HTML 格式）');
        var wb = root.XLSX.read(buf, { type: 'array' });
        return root.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: '' });
      }
      var text = new TextDecoder('utf-8').decode(buf);
      if (/^\s*</.test(text)) {
        var t = new DOMParser().parseFromString(text, 'text/html').querySelector('table');
        if (!t) throw new Error('檔案裡找不到表格');
        return Array.prototype.map.call(t.rows, function (tr) {
          return Array.prototype.map.call(tr.cells, function (c) { return (c.textContent || '').trim(); });
        });
      }
      // CSV
      return text.replace(/^﻿/, '').split(/\r?\n/).map(function (line) {
        var out = [], cur = '', q = false;
        for (var i = 0; i < line.length; i++) {
          var ch = line[i];
          if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
          else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
        }
        out.push(cur);
        return out;
      });
    });
  }

  function copyText(text) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      ta.remove();
      return ok ? Promise.resolve() : Promise.reject(new Error('blocked'));
    }
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text).catch(fallback);
    return fallback();
  }

  var RULE_TONES = ['', 'r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'];

  function mount(el, opts) {
    opts = opts || {};
    var store = ls((opts.storageKey || 'ppl') + '.data'), prefs = ls((opts.storageKey || 'ppl') + '.prefs');
    var S = {
      rows: null, file: '', loadedAt: '', res: null, err: '',
      tab: 'check',
      f: Object.assign({ rules: [], owner: '', q: '', pOwner: '', svc: '', metric: 'amount', exclude: 'lostother', sOwner: '',
        domain: P.DEFAULTS.sfdcDomain }, prefs.get({}))
    };
    function savePrefs() { prefs.set(S.f); }

    el.classList.add('ppl');
    el.setAttribute('lang', 'zh-Hant-HK');
    el.innerHTML =
      '<div class="ppl-head"><div><div class="ppl-eyebrow">SFDC Pipeline · 合規</div><h2>PPL 合規檢查</h2>' +
      '<p class="ppl-sub">' + esc(opts.sub || '上載最新的 SFDC Pipeline 報表（.xls / .xlsx / .csv），自動找出不符合 7 條標準的機會。') + '點機會編號會開 SFDC 並複製編號。</p></div>' +
      '<div class="ppl-actions"><input type="file" accept=".xls,.xlsx,.csv,.htm,.html" hidden><button type="button" class="ppl-btn ppl-primary" data-act="pick">上載 Pipeline 報表</button></div></div>' +
      '<div class="ppl-drop" hidden>把 Pipeline 報表放這裡</div>' +
      '<div class="ppl-meta"></div><div class="ppl-notes"></div>' +
      '<div class="ppl-tabs" role="tablist"></div><div class="ppl-filters"></div><div class="ppl-view"></div>' +
      '<textarea class="ppl-copybox" readonly hidden></textarea>' +
      '<div class="ppl-toast" hidden></div>';
    var $ = function (s) { return el.querySelector(s); };
    var input = $('input[type=file]');

    var toastT;
    function toast(msg, ms) {
      var t = $('.ppl-toast'); t.textContent = msg; t.hidden = false;
      clearTimeout(toastT); toastT = setTimeout(function () { t.hidden = true; }, ms || 3500);
    }

    function load(grid, fileName, silent) {
      try {
        var rows = P.slim(P.prepare(grid));
        P.check(rows);   // 先試一次，缺必要欄就報錯
        S.rows = rows; S.file = fileName || ''; S.loadedAt = new Date().toISOString(); S.err = '';
        if (!store.set({ rows: rows, file: S.file, loadedAt: S.loadedAt }) && !silent) toast('已載入；瀏覽器空間不足，下次開啟要重新上載。');
      } catch (e) {
        S.err = (fileName ? fileName + '：' : '') + e.message;
      }
      render();
      return !S.err;
    }
    function handleFile(file) {
      toast('正在讀取 ' + file.name + '…');
      readFile(file).then(function (grid) { if (load(grid, file.name)) toast('已檢查 ' + file.name); },
        function (e) { S.err = file.name + '：' + e.message; render(); });
    }

    // ---------------------------------------------------------- render
    function render() {
      var r = null;
      if (S.rows) {
        try { r = P.check(S.rows); } catch (e) { S.err = e.message; }
      }
      S.res = r;
      renderMeta(); renderTabs(); renderFilters(); renderView();
    }
    function renderMeta() {
      var m = $('.ppl-meta'), n = $('.ppl-notes');
      if (!S.res) {
        m.innerHTML = '<span class="ppl-faint">' + (S.err ? '' : '未載入報表。') + '</span>';
        n.innerHTML = S.err ? '<div class="ppl-note ppl-bad">讀取失敗：' + esc(S.err) + '</div>' : '';
        return;
      }
      var r = S.res;
      m.innerHTML = '<span><b>' + esc(S.file || '報表') + '</b></span>' +
        '<span>今天 ' + r.today + ' · 截止日（下週三）<b>' + r.cutoff + '</b></span>' +
        '<span>報表 ' + r.totalRows.toLocaleString() + ' 行 · 參與檢查 ' + r.checkedOpps.toLocaleString() + ' 個機會</span>' +
        '<span class="ppl-flag">⚠ 有問題 ' + r.violations.length + ' 個</span>';
      var notes = r.skipped.map(function (s) { return '<div class="ppl-note">已略過 ' + esc(s) + '</div>'; })
        .concat(r.notes.map(function (s) { return '<div class="ppl-note ppl-info">' + esc(s) + '</div>'; }));
      if (S.err) notes.unshift('<div class="ppl-note ppl-bad">' + esc(S.err) + '</div>');
      n.innerHTML = notes.join('');
    }
    var TABS = [['check', '合規檢查'], ['pivot', '透視分析'], ['secure', 'Secure 未下單'], ['help', '規則說明']];
    function secureList() {
      if (!S.rows) return { list: [], err: '' };
      try { return { list: P.secureNotOrdered(S.rows, { owner: S.f.sOwner }), err: '' }; } catch (e) { return { list: [], err: e.message }; }
    }
    function renderTabs() {
      var counts = { check: S.res ? filtered().length : null, secure: S.rows ? secureList().list.length : null };
      $('.ppl-tabs').innerHTML = TABS.map(function (t) {
        return '<button type="button" role="tab" data-tab="' + t[0] + '" aria-selected="' + (S.tab === t[0]) + '">' + t[1] +
          (counts[t[0]] != null ? '<span class="ppl-count">' + counts[t[0]] + '</span>' : '') + '</button>';
      }).join('');
    }
    function sel(key, options, val) {
      return '<select data-f="' + key + '">' + options.map(function (o) {
        return '<option value="' + esc(o[0]) + '"' + (o[0] === val ? ' selected' : '') + '>' + esc(o[1]) + '</option>';
      }).join('') + '</select>';
    }
    function ownerOpts(list, allLabel) { return [['', allLabel || '全部 Owner']].concat(list.map(function (o) { return [o, o]; })); }

    function filtered() {
      if (!S.res) return [];
      var q = S.f.q.trim().toLowerCase(), rules = S.f.rules;
      return S.res.violations.filter(function (v) {
        if (S.f.owner && v.owner !== S.f.owner) return false;
        if (rules.length && !v.issues.some(function (i) { return rules.indexOf(i.rule) >= 0; })) return false;
        if (q && (v.opp + ' ' + v.name + ' ' + v.owner).toLowerCase().indexOf(q) < 0) return false;
        return true;
      });
    }
    function renderFilters() {
      var h = '', f = S.f;
      if (!S.rows || S.tab === 'help') { $('.ppl-filters').innerHTML = S.tab === 'help' ? sfdcSetting() : ''; return; }
      if (S.tab === 'check') {
        var r = S.res, own = {};
        r.violations.forEach(function (v) { if (v.owner) own[v.owner] = (own[v.owner] || 0) + 1; });
        var ownList = Object.keys(own).sort(function (a, b) { return own[b] - own[a] || (a < b ? -1 : 1); });
        h += '<div class="ppl-chips">' + P.RULES.map(function (x) {
          return '<button type="button" class="ppl-chip ' + RULE_TONES[x.id] + '" data-rule="' + x.id + '" aria-pressed="' + (f.rules.indexOf(x.id) >= 0) +
            '" title="' + esc(x.desc) + '"><b>標準' + x.id + '</b> ' + esc(x.short) + ' <span class="ppl-n">' + r.stats[x.id] + '</span></button>';
        }).join('') + '</div>';
        h += '<div class="ppl-row"><input type="search" data-f="q" placeholder="搜尋機會編號、名稱、Owner…" value="' + esc(f.q) + '">' +
          (r.hasOwner ? sel('owner', ownerOpts(ownList), f.owner) : '<span class="ppl-faint">報表沒有 Owner 欄</span>') +
          '<span class="ppl-spacer"></span><button type="button" class="ppl-btn" data-act="copy">複製表格</button>' +
          (root.self === root.top ? '<button type="button" class="ppl-btn" data-act="csv">匯出 CSV</button>' : '') + '</div>';
      } else if (S.tab === 'pivot') {
        var owners = P.owners(S.rows);
        h += '<div class="ppl-row">' + (owners.length ? sel('pOwner', ownerOpts(owners), f.pOwner) : '') +
          sel('svc', [['', 'Service Product：全部'], ['0', 'Service Product：否 (0)'], ['1', 'Service Product：是 (1)']], f.svc) +
          sel('metric', [['amount', '指標：金額（Schedule Amount）'], ['rows', '指標：行數（產品線）']], f.metric) +
          sel('exclude', [['lostother', '排除 Closed - Lost / Other'], ['none', '不排除（全部記錄）']], f.exclude) +
          '<span class="ppl-spacer"></span><button type="button" class="ppl-btn" data-act="copy">複製表格</button>' +
          (root.self === root.top ? '<button type="button" class="ppl-btn" data-act="csv">匯出 CSV</button>' : '') + '</div>';
      } else if (S.tab === 'secure') {
        var so = P.owners(S.rows);
        h += '<div class="ppl-row">' + (so.length ? sel('sOwner', ownerOpts(so), f.sOwner) : '') +
          '<span class="ppl-spacer"></span><button type="button" class="ppl-btn" data-act="copy">複製表格</button>' +
          (root.self === root.top ? '<button type="button" class="ppl-btn" data-act="csv">匯出 CSV</button>' : '') + '</div>';
      }
      $('.ppl-filters').innerHTML = h;
    }
    function sfdcSetting() {
      return '<div class="ppl-row"><label class="ppl-lbl">SFDC 網址 <input type="url" data-f="domain" value="' + esc(S.f.domain) + '" spellcheck="false"></label>' +
        '<span class="ppl-faint">預設 https://zebra.lightning.force.com，即你平時開 SFDC 的網址開頭。</span></div>';
    }

    function oppCell(opp, oppId) {
      var link = P.sfdcLink(opp, oppId, S.f.domain);
      return '<a class="ppl-sf" href="' + esc(link.url) + '" target="_blank" rel="noopener" data-opp="' + esc(opp) + '" data-kind="' + link.kind +
        '" title="' + (link.kind === 'record' ? '直接開 SFDC 機會頁' : '在 SFDC 搜尋這個編號；同時已複製編號，搜尋欄沒自動填就按 ⌘V / Ctrl+V') + '">' +
        esc(opp) + ' <span aria-hidden="true">↗</span></a>' +
        '<button type="button" class="ppl-mini" data-pplcopy="' + esc(opp) + '" title="只複製編號">複製</button>';
    }

    function renderView() {
      var v = $('.ppl-view');
      if (S.tab === 'help') { v.innerHTML = helpHtml(); return; }
      if (!S.rows) { v.innerHTML = '<div class="ppl-empty">上載 SFDC Pipeline 報表後，這裡會列出有問題的機會。</div>'; return; }
      if (S.tab === 'check') v.innerHTML = checkHtml();
      else if (S.tab === 'pivot') v.innerHTML = pivotHtml();
      else v.innerHTML = secureHtml();
    }
    function checkHtml() {
      var list = filtered();
      if (!S.res.violations.length) return '<div class="ppl-empty ppl-good">全部機會都符合 7 條標準。</div>';
      if (!list.length) return '<div class="ppl-empty">沒有符合篩選條件的機會。</div>';
      return '<div class="ppl-table"><table><thead><tr><th>機會編號（點擊開 SFDC）</th><th>機會名稱</th><th>Owner</th><th>階段</th><th class="ppl-r">金額</th><th>問題</th></tr></thead><tbody>' +
        list.map(function (x) {
          return '<tr><td class="ppl-nowrap">' + oppCell(x.opp, x.oppId) + '</td><td>' + esc(x.name) + '</td><td>' + esc(x.owner) + '</td><td class="ppl-nowrap">' + esc(x.stage) +
            '</td><td class="ppl-r">' + usd(x.amount) + '</td><td><ul class="ppl-issues">' + x.issues.map(function (i) {
              return '<li><span class="ppl-tag ' + RULE_TONES[i.rule] + '">標準' + i.rule + '</span>' + esc(i.text) + '</li>';
            }).join('') + '</ul></td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    function pivotData() { return P.pivot(S.rows, { metric: S.f.metric, exclude: S.f.exclude, owner: S.f.pOwner, svc: S.f.svc }); }
    function pfmt(v) { return S.f.metric === 'amount' ? Math.round(v).toLocaleString('en-US') : String(Math.round(v)); }
    function pivotHtml() {
      var p;
      try { p = pivotData(); } catch (e) { return '<div class="ppl-empty">' + esc(e.message) + '</div>'; }
      if (!p.quarterList.length) return '<div class="ppl-empty">沒有符合篩選條件的記錄。</div>';
      return '<div class="ppl-table"><table><thead><tr><th>季度 \\ 階段</th>' + p.stageList.map(function (s) { return '<th class="ppl-r">' + esc(s) + '</th>'; }).join('') +
        '<th class="ppl-r">合計</th></tr></thead><tbody>' + p.quarterList.map(function (q) {
          return '<tr><td class="ppl-nowrap"><b>' + esc(q) + '</b></td>' + p.stageList.map(function (s) {
            return '<td class="ppl-r' + (p.isHot(q, s) ? ' ppl-hot' : '') + '">' + pfmt(p.cell(q, s)) + '</td>';
          }).join('') + '<td class="ppl-r"><b>' + pfmt(p.qTotal(q)) + '</b></td></tr>';
        }).join('') + '<tr class="ppl-tot"><td>合計</td>' + p.stageList.map(function (s) { return '<td class="ppl-r">' + pfmt(p.sTotal(s)) + '</td>'; }).join('') +
        '<td class="ppl-r">' + pfmt(p.grandTotal) + '</td></tr></tbody></table></div>' +
        '<p class="ppl-faint">行 = First Ship Fiscal Quarter New，列 = Sales Stage，金額單位 USD。' +
        (S.f.metric === 'amount' ? '紅底 = 金額最大的格子。' : '') + '</p>';
    }
    function secureHtml() {
      var s = secureList();
      if (s.err) return '<div class="ppl-empty">' + esc(s.err) + '<br>要用這頁，請在 SFDC 報表加入「Reseller has ordered via Distribution」欄。</div>';
      if (!s.list.length) return '<div class="ppl-empty ppl-good">沒有 Secure 而經銷商未下單的機會。</div>';
      var h = '<div class="ppl-table"><table><thead><tr><th>機會編號（點擊開 SFDC）</th><th>機會名稱</th><th>Owner</th><th class="ppl-r">金額</th></tr></thead><tbody>', cur = null;
      s.list.forEach(function (x) {
        if (x.quarter !== cur) {
          cur = x.quarter;
          var qs = s.list.filter(function (y) { return y.quarter === cur; });
          h += '<tr class="ppl-grp"><td colspan="3">' + esc(cur || '（無季度）') + ' · ' + qs.length + ' 個</td><td class="ppl-r">' +
            usd(qs.reduce(function (t, y) { return t + y.amount; }, 0)) + '</td></tr>';
        }
        h += '<tr><td class="ppl-nowrap">' + oppCell(x.opp, x.oppId) + '</td><td>' + esc(x.name) + '</td><td>' + esc(x.owner) + '</td><td class="ppl-r">' + usd(x.amount) + '</td></tr>';
      });
      return h + '</tbody></table></div><p class="ppl-faint">Sales Stage = Secure 但 Reseller has ordered via Distribution = 0：已確定、經銷商未下單，要跟進下單風險。</p>';
    }
    function helpHtml() {
      var d = P.DEFAULTS;
      return '<div class="ppl-help"><h3>檢查範圍</h3><p>Opportunity Record Type = ' + esc(d.recordType) + '（報表沒有這欄就全部檢查）；階段為 Identify、Qualify、Validate、Secure、Closed - Won；First Ship Date ≥ ' +
        d.minFirstShip + '。同一個機會的多行產品線合併計算：金額加總，其他欄取第一個非空值。截止日 = 下週三（今天是週三就是今天）。</p>' +
        '<h3>7 條標準</h3><ol>' + P.RULES.map(function (x) { return '<li><b>標準' + x.id + ' · ' + esc(x.short) + '</b>：' + esc(x.desc) + '</li>'; }).join('') + '</ol>' +
        '<h3>透視分析</h3><p>行 = First Ship Fiscal Quarter New（發貨財季），列 = Sales Stage。可按 Owner、Is Service Product 篩選，指標可選金額或行數，預設排除 Closed - Lost / Closed - Other。</p>' +
        '<h3>Secure 未下單</h3><p>Sales Stage = Secure 且 Reseller has ordered via Distribution = 0，按季度分組。</p>' +
        '<h3>開 SFDC</h3><p>點機會編號：<b>①</b> 把編號複製到剪貼簿；<b>②</b> 新分頁開 SFDC。報表有 <i>Opportunity ID</i> 欄（006 開頭的 15 / 18 位 ID）時直接開機會頁；只有 Opportunity Number 時開 SFDC 全域搜尋頁並帶入編號。' +
        '如果搜尋頁沒有自動帶入，點 SFDC 上方搜尋欄按 ⌘V（Windows 按 Ctrl+V）再按 Enter。想一按直達，在 SFDC 報表加「Opportunity ID」欄再匯出。</p></div>';
    }

    function currentTable() {
      var t = el.querySelector('.ppl-view table');
      if (!t) return [];
      return Array.prototype.map.call(t.rows, function (tr) {
        return Array.prototype.map.call(tr.cells, function (c) {
          var copy = c.cloneNode(true);
          copy.querySelectorAll('.ppl-mini, [aria-hidden]').forEach(function (n) { n.remove(); });
          copy.querySelectorAll('li').forEach(function (n) { n.append('; '); });
          return copy.textContent.replace(/\s+/g, ' ').replace(/;\s*$/, '').trim();
        });
      });
    }
    function copyTable() {
      var tsv = currentTable().map(function (r) { return r.join('\t'); }).join('\n');
      if (!tsv) return;
      copyText(tsv).then(function () { toast('已複製表格，可直接貼到 Excel。'); }, function () {
        var box = $('.ppl-copybox'); box.hidden = false; box.value = tsv; box.focus(); box.select();
        toast('瀏覽器不允許自動複製：表格已選取在下方，按 ⌘C / Ctrl+C。', 6000);
      });
    }
    function exportCsv() {
      var csv = currentTable().map(function (r) { return r.map(function (c) { return '"' + c.replace(/"/g, '""') + '"'; }).join(','); }).join('\r\n');
      var a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
      var name = { check: 'PPL問題清單', pivot: 'PPL透視', secure: 'Secure未下單' }[S.tab] || 'PPL';
      a.download = name + '_' + new Date().toISOString().slice(0, 10) + '.csv';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    }

    // ---------------------------------------------------------- events
    el.addEventListener('click', function (e) {
      var sf = e.target.closest('a.ppl-sf');
      if (sf) {
        var opp = sf.dataset.opp, kind = sf.dataset.kind;
        copyText(opp).then(function () {
          toast(kind === 'record' ? '已開 SFDC 機會頁（編號 ' + opp + ' 已複製）' : '已複製 ' + opp + '。SFDC 搜尋欄沒自動填就按 ⌘V / Ctrl+V', 5000);
        }, function () { toast('已開 SFDC；瀏覽器不允許自動複製，請手動輸入 ' + opp, 5000); });
        return;   // 讓連結照常在新分頁開
      }
      var b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.pplcopy) { copyText(b.dataset.pplcopy).then(function () { toast('已複製 ' + b.dataset.pplcopy); }, function () { toast('瀏覽器不允許自動複製'); }); return; }
      if (b.dataset.act === 'pick') return input.click();
      if (b.dataset.act === 'copy') return copyTable();
      if (b.dataset.act === 'csv') return exportCsv();
      if (b.dataset.tab) { S.tab = b.dataset.tab; renderTabs(); renderFilters(); renderView(); return; }
      if (b.dataset.rule) {
        var id = +b.dataset.rule, i = S.f.rules.indexOf(id);
        if (i >= 0) S.f.rules.splice(i, 1); else S.f.rules.push(id);
        savePrefs(); renderTabs(); renderFilters(); renderView();
      }
    });
    el.addEventListener('change', function (e) {
      if (e.target === input) { if (input.files[0]) handleFile(input.files[0]); input.value = ''; return; }
      var k = e.target.dataset.f;
      if (!k || k === 'q') return;
      S.f[k] = k === 'domain' ? (e.target.value.trim().replace(/\/+$/, '') || P.DEFAULTS.sfdcDomain) : e.target.value;
      savePrefs(); renderTabs(); renderFilters(); renderView();
    });
    var qT;
    el.addEventListener('input', function (e) {
      if (e.target.dataset.f !== 'q') return;
      clearTimeout(qT);
      qT = setTimeout(function () { S.f.q = e.target.value; savePrefs(); renderTabs(); renderView(); }, 200);
    });
    var drop = $('.ppl-drop');
    el.addEventListener('dragover', function (e) { e.preventDefault(); e.stopPropagation(); drop.hidden = false; });
    // 拖放不往上傳，免得宿主 App 把 Pipeline 當成自己的檔案
    el.addEventListener('dragenter', function (e) { e.stopPropagation(); });
    el.addEventListener('dragleave', function (e) { e.stopPropagation(); if (!el.contains(e.relatedTarget)) drop.hidden = true; });
    el.addEventListener('drop', function (e) {
      e.preventDefault(); e.stopPropagation(); drop.hidden = true;
      if (e.dataTransfer && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });

    // ---------------------------------------------------------- boot
    var saved = store.get(null);
    if (saved && saved.rows) { S.rows = saved.rows; S.file = saved.file; S.loadedAt = saved.loadedAt; }
    render();
    return {
      load: function (grid, name) { return load(grid, name, true); },
      // 宿主讀到多個工作表時，用第一個有 Opportunity Number + Sales Stage 的
      loadAny: function (grids, name) {
        for (var i = 0; i < grids.length; i++) {
          try { var rows = P.prepare(grids[i]); P.check(rows); return load(grids[i], name, true); } catch (e) { /* try next sheet */ }
        }
        return false;
      }
    };
  }

  root.PPLWidget = { mount: mount, readFile: readFile };
})(this);
