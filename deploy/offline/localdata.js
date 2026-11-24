// Zebra Sales Hub — local-data mode (offline build only).
// On open, read the newest report of each kind from the ./data folder (a Google Drive synced copy) and
// feed each file to the Hub exactly as if it had been dragged in. Static HTML cannot list or read a folder
// on its own, so this needs the page served by the bundled local server (啟動.bat → serve.py), which also
// writes data/manifest.json. Over file:// it does nothing.
(function () {
  if (location.protocol === 'file:') return;   // a file:// page cannot fetch the folder; use 啟動.bat

  // filename → kind, first match wins (pipeline before DSR: an SFDC export can be named HKTW_…pipeline…)
  var KINDS = [
    { re: /POS-HKTW|POS[_-]?Report/i,          kind: 'pos',  frames: ['pos', 'pipeline'], label: 'POS' },
    { re: /pipeline-20\d{2}|SFDC.*pipeline/i,  kind: 'pipe', frames: ['pipeline', 'dsr'], label: 'SFDC pipeline' },
    { re: /_INV_|inventory/i,                   kind: 'inv',  frames: ['dsr'],             label: 'VAD 庫存' },
    { re: /_BACKLOG_|backlog/i,                 kind: 'bl',   frames: ['dsr'],             label: 'VST backlog' },
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
      if (+m[1] > now.getMonth() + 2) y--;
      return y + m[1] + m[2] + '000000';
    }
    return '';
  }
  function classify(name) { for (var i = 0; i < KINDS.length; i++) if (KINDS[i].re.test(name)) return KINDS[i]; return null; }

  var frameEl = {};
  function frame(k) {
    if (!(k in frameEl)) frameEl[k] = document.querySelector('iframe[src^="' + k + '.html"]');
    return frameEl[k];
  }
  // deliver when a frame is alive: flush the queue on its first message to us, and once more as a fallback
  var queue = {}, ready = {};   // queue[frameName] = [ {kind,name,lastModified,buf} … ]
  function flush(k) {
    var f = frame(k), q = queue[k];
    if (!f || !f.contentWindow || !q || !q.length) return;
    q.forEach(function (it) {
      try { f.contentWindow.postMessage({ hub: 'load', kind: it.kind, name: it.name, lastModified: it.lastModified, buf: it.buf.slice(0) }, '*'); } catch (e) {}
    });
    queue[k] = [];
  }
  window.addEventListener('message', function (e) {
    for (var k in frameEl) if (frameEl[k] && e.source === frameEl[k].contentWindow && !ready[k]) { ready[k] = 1; flush(k); }
  });

  function banner(text, cls) {
    var el = document.getElementById('localdata-bar');
    if (!el) {
      el = document.createElement('div'); el.id = 'localdata-bar';
      el.style.cssText = 'position:fixed;left:0;right:0;bottom:0;z-index:9999;font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;'
        + 'padding:7px 14px;background:#0b3d2e;color:#eafff5;box-shadow:0 -1px 6px rgba(0,0,0,.25);display:flex;gap:10px;align-items:center';
      var x = document.createElement('button'); x.textContent = '✕';
      x.style.cssText = 'margin-left:auto;background:none;border:0;color:inherit;cursor:pointer;font-size:14px';
      x.onclick = function () { el.style.display = 'none'; };
      var span = document.createElement('span'); span.id = 'localdata-msg';
      el.appendChild(span); el.appendChild(x); document.body.appendChild(el);
    }
    if (cls === 'warn') el.style.background = '#5a3d00';
    document.getElementById('localdata-msg').textContent = text;
    el.style.display = 'flex';
  }

  function run() {
    fetch('data/manifest.json', { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error('no manifest'); return r.json();
    }).then(function (mf) {
      var files = (mf && mf.files) || [];
      // newest file per kind
      var best = {};
      files.forEach(function (name) {
        var k = classify(name); if (!k) return;
        var cur = best[k.kind];
        if (!cur || (dataDate(name) || '') > (dataDate(cur.name) || '')) best[k.kind] = { name: name, spec: k };
      });
      var picked = Object.keys(best).map(function (kk) { return best[kk]; });
      if (!picked.length) { banner('本機模式：data 資料夾未有可識別的報表（POS / pipeline / DSR / VAD）。', 'warn'); return; }
      banner('本機模式：正在載入 ' + picked.map(function (p) { return p.name; }).join('、') + ' …');
      Promise.all(picked.map(function (p) {
        return fetch('data/' + encodeURIComponent(p.name), { cache: 'no-store' }).then(function (r) {
          if (!r.ok) throw new Error(p.name); return r.arrayBuffer();
        }).then(function (buf) {
          p.spec.frames.forEach(function (fn) { (queue[fn] = queue[fn] || []).push({ kind: p.spec.kind, name: p.name, lastModified: Date.now(), buf: buf }); });
        });
      })).then(function () {
        Object.keys(queue).forEach(function (k) { if (ready[k]) flush(k); });
        setTimeout(function () { Object.keys(queue).forEach(flush); }, 3500);   // fallback for frames that sent nothing yet
        banner('本機模式 · 已載入：' + picked.map(function (p) { return p.spec.label + ' ' + p.name; }).join('　|　') + '　（來自 data 資料夾）');
      }).catch(function (e) { banner('本機模式：讀取檔案失敗 — ' + (e && e.message || e), 'warn'); });
    }).catch(function () { /* no manifest: not in local-data mode, stay quiet */ });
  }

  if (document.readyState === 'complete') run();
  else window.addEventListener('load', run);
})();
