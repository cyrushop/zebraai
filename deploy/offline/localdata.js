// Zebra Sales Hub — local-data mode (offline build only).
// On open, read the newest report of each kind from the ./data folder (a Google Drive synced copy) and
// feed each file to the Hub exactly as if it had been dragged in. Static HTML cannot list or read a folder
// on its own, so this needs the page served by the bundled local server (啟動.bat → serve.py), which also
// writes data/manifest.json. Over file:// it does nothing.
(function () {
  if (location.protocol === 'file:') return;   // a file:// page cannot fetch the folder; use 啟動.bat
  var ORIGIN = location.origin;                // served by serve.py: talk to our own frames only (review H3)

  // filename → kind, first match wins (pipeline before DSR: an SFDC export can be named HKTW_…pipeline…)
  // perVad: one file per distributor (Chinetek and VSTECS inventory both load), keyed by the text before the marker
  var KINDS = [
    { re: /POS-HKTW|POS[_-]?Report/i,          kind: 'pos',  frames: ['pos', 'pipeline'], label: 'POS' },
    { re: /pipeline-20\d{2}|SFDC.*pipeline/i,  kind: 'pipe', frames: ['pipeline', 'dsr'], label: 'SFDC pipeline' },
    { re: /_INV_|inventory/i,                   kind: 'inv',  frames: ['dsr'],             label: 'VAD 庫存',    perVad: /_INV_|inventory/i },
    { re: /_BACKLOG_|backlog/i,                 kind: 'bl',   frames: ['dsr'],             label: 'VST backlog', perVad: /_BACKLOG_|backlog/i },
    { re: /HKTW[_-]\d|DSR/i,                     kind: 'dsr',  frames: ['dsr'],             label: 'DSR' },
    { re: /Account[_ ]?list|GC_Account/i,       kind: 'acct', frames: ['pipeline'],        label: '帳戶表' }
  ];

  // Data date in a file name as a sortable 'YYYYMMDDhhmmss' ('' if none) — same rule as the Hub.
  function dataDate(n) {
    n = String(n || '').replace(/\s*\([^)]*\)$/, '');
    var p2 = function (x) { return ('0' + (x || 0)).slice(-2); }, m;
    if ((m = n.match(/(20\d{2})[-.](\d{1,2})[-.](\d{1,2})(?:-(\d{2})-(\d{2})-(\d{2}))?/))) return m[1] + p2(m[2]) + p2(m[3]) + p2(m[4]) + p2(m[5]) + p2(m[6]);
    if ((m = n.match(/(20\d{2})(\d{2})(\d{2})(?!\d)/)) && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31) return m[1] + m[2] + m[3] + '000000';
    if ((m = n.match(/WK\s*(20\d{2})(\d{2})(?!\d)/i) || n.match(/(20\d{2})\s*WK\s*(\d{1,2})(?!\d)/i))) {
      var d = new Date(+m[1], 0, 1 + (+m[2] - 1) * 7);
      return d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '000000';
    }
    if ((m = n.replace(/\.[A-Za-z0-9]+$/, '').match(/(?:^|\D)(\d{2})(\d{2})$/)) && +m[1] >= 1 && +m[1] <= 12 && +m[2] >= 1 && +m[2] <= 31) {
      var now = new Date(), y = now.getFullYear();
      if (new Date(y, +m[1] - 1, +m[2]) > new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)) y--;   /* review M4: a month-day after today is last year's */
      return y + m[1] + m[2] + '000000';
    }
    return '';
  }
  function classify(name) { for (var i = 0; i < KINDS.length; i++) if (KINDS[i].re.test(name)) return KINDS[i]; return null; }
  // review M6: inventory / backlog are per distributor — group by the name before the marker
  function groupOf(name, k) {
    if (!k.perVad) return k.kind;
    var head = name.split(k.perVad)[0].replace(/[\s_\-]+$/, '').toLowerCase();
    return k.kind + '|' + head;
  }

  var frameEl = {};
  function frame(k) {
    if (!(k in frameEl)) frameEl[k] = document.querySelector('iframe[src^="' + k + '.html"]');
    return frameEl[k];
  }
  function frameName(w) { for (var k in frameEl) if (frameEl[k] && frameEl[k].contentWindow === w) return k; return null; }
  // deliver when a frame is alive: flush the queue on its first message to us, and once more as a fallback
  var queue = {}, ready = {};   // queue[frameName] = [ {kind,name,lastModified,buf} … ]
  function flush(k) {
    var f = frame(k), q = queue[k];
    if (!f || !f.contentWindow || !q || !q.length) return;
    q.forEach(function (it) {
      try { f.contentWindow.postMessage({ hub: 'load', kind: it.kind, name: it.name, lastModified: it.lastModified, buf: it.buf.slice(0) }, ORIGIN); } catch (e) {}
    });
    queue[k] = [];
  }

  // results: each page answers { hub:'loaded', name, ok, msg } once it has read a file (review M10)
  var expect = {}, results = {}, picked = [], doneTimer = null, allQueued = false;   // expect['frame|name'] = 1
  window.addEventListener('message', function (e) {
    if (e.origin !== ORIGIN) return;
    var k = frameName(e.source); if (!k) return;
    if (!ready[k]) { ready[k] = 1; flush(k); }
    var m = e.data || {};
    if (m.hub === 'loaded' && expect[k + '|' + m.name] && !results[k + '|' + m.name]) {
      results[k + '|' + m.name] = { ok: !!m.ok, msg: String(m.msg || '') };
      if (allQueued && Object.keys(results).length >= Object.keys(expect).length) finish();
    }
  });

  // ---- banner: one short line at the bottom; details on tap; folds itself away when all is well
  var bar, msgEl, detEl, foldTimer;
  function ensureBar() {
    if (bar) return;
    bar = document.createElement('div'); bar.id = 'localdata-bar'; bar.setAttribute('role', 'status');
    bar.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:9999;font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;'
      + 'padding:6px 12px calc(6px + env(safe-area-inset-bottom)) 12px;background:#0b3d2e;color:#eafff5;box-shadow:0 -1px 6px rgba(0,0,0,.25)';
    var row = document.createElement('div'); row.style.cssText = 'display:flex;gap:8px;align-items:center;min-height:32px';
    msgEl = document.createElement('button'); msgEl.type = 'button'; msgEl.setAttribute('aria-expanded', 'false');
    msgEl.style.cssText = 'flex:1;min-width:0;text-align:left;background:none;border:0;color:inherit;font:inherit;cursor:pointer;padding:4px 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    msgEl.onclick = function () { var open = detEl.hidden; detEl.hidden = !open; msgEl.setAttribute('aria-expanded', String(open)); clearTimeout(foldTimer); pad(); };
    var x = document.createElement('button'); x.type = 'button'; x.textContent = '✕'; x.setAttribute('aria-label', '關閉本機模式提示');
    x.style.cssText = 'background:none;border:0;color:inherit;cursor:pointer;font-size:16px;min-width:44px;min-height:44px;margin:-6px -8px -6px 0';
    x.onclick = function () { bar.style.display = 'none'; pad(); };
    detEl = document.createElement('div'); detEl.hidden = true;
    detEl.style.cssText = 'padding:4px 0 2px;max-height:40vh;overflow:auto;white-space:pre-line;font-size:12.5px;opacity:.92';
    row.appendChild(msgEl); row.appendChild(x); bar.appendChild(row); bar.appendChild(detEl); document.body.appendChild(bar);
  }
  // keep the page's last lines reachable above the bar
  function pad() { document.body.style.paddingBottom = bar && bar.style.display !== 'none' ? bar.offsetHeight + 'px' : ''; }
  function banner(text, details, warn) {
    ensureBar();
    bar.style.background = warn ? '#5a3d00' : '#0b3d2e';
    msgEl.textContent = text + (details ? ' ▾' : '');
    detEl.textContent = details || ''; detEl.hidden = true;   // one line until tapped, so it never covers the page
    msgEl.setAttribute('aria-expanded', String(!detEl.hidden));
    bar.style.display = 'block'; pad();
  }

  function finish() {
    if (doneTimer === 0) return; clearTimeout(doneTimer); doneTimer = 0;
    var bad = [], lines = [];
    picked.forEach(function (p) {
      var rs = p.spec.frames.map(function (fn) { return results[fn + '|' + p.name]; });
      var fail = rs.filter(function (r) { return r && !r.ok; })[0], none = rs.every(function (r) { return !r; });
      if (fail || none) bad.push(p);
      lines.push((fail ? '✗ ' : none ? '？ ' : '✓ ') + p.spec.label + '：' + p.name + (fail ? '\n    ' + fail.msg : none ? '\n    頁面未有回應（可能仍在讀取，或檔案太大）' : ''));
    });
    if (!bad.length) {
      banner('本機模式 · 已載入 ' + picked.length + ' 份報表（data 資料夾）', lines.join('\n'));
      clearTimeout(foldTimer); foldTimer = setTimeout(function () { if (detEl.hidden) { bar.style.display = 'none'; pad(); } }, 8000);
    } else {
      banner('本機模式 · ' + bad.length + ' 份報表載入唔到，撳睇詳情', lines.join('\n'), true);
    }
  }

  function run() {
    fetch('data/manifest.json', { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('no manifest'); return r.json();
    }).then(function (mf) {
      var files = (mf && mf.files) || [];
      // newest file per kind (per distributor for inventory / backlog)
      var best = {};
      files.forEach(function (name) {
        var k = classify(name); if (!k) return;
        var g = groupOf(name, k), cur = best[g];
        if (!cur || (dataDate(name) || '') > (dataDate(cur.name) || '')) best[g] = { name: name, spec: k };
      });
      picked = Object.keys(best).sort().map(function (g) { return best[g]; });
      if (!picked.length) { banner('本機模式：data 資料夾未有認得嘅報表', '支援：POS-HKTW-*.xlsx、pipeline-*.xls、HKTW_*.xlsx（DSR）、*_INV_*.xlsx、*_BACKLOG_*.xlsx、帳戶表', true); return; }
      banner('本機模式 · 正在載入 ' + picked.length + ' 份報表…', picked.map(function (p) { return p.spec.label + '：' + p.name; }).join('\n'));
      Promise.all(picked.map(function (p) {
        return fetch('data/' + encodeURIComponent(p.name), { cache: 'no-store' }).then(function (r) {
          if (!r.ok) throw new Error(p.name + '（HTTP ' + r.status + '）'); return r.arrayBuffer();
        }).then(function (buf) {
          p.spec.frames.forEach(function (fn) {
            expect[fn + '|' + p.name] = 1;
            (queue[fn] = queue[fn] || []).push({ kind: p.spec.kind, name: p.name, lastModified: Date.now(), buf: buf });
          });
        });
      })).then(function () {
        allQueued = true;
        if (Object.keys(results).length >= Object.keys(expect).length) return finish();
        Object.keys(queue).forEach(function (k) { if (ready[k]) flush(k); });
        setTimeout(function () { Object.keys(queue).forEach(flush); }, 3500);   // fallback for frames that sent nothing yet
        doneTimer = setTimeout(finish, 30000);   // pages that never answer are reported as such
      }).catch(function (e) { banner('本機模式 · 讀取 data 資料夾失敗', String(e && e.message || e), true); });
    }).catch(function () { /* no manifest: not in local-data mode, stay quiet */ });
  }

  if (document.readyState === 'complete') run();
  else window.addEventListener('load', run);
})();
