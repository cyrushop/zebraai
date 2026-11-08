/* Citygate RFID inventory web app (zone-based, FXR90 + AN520 / AN510 / AN670). */
(function () {
  'use strict';
  const C = window.RFIDConfig, E = window.RFIDEngine, Sim = window.RFIDSim;
  const CAT = C.CATALOGUE, MODELS = C.ANTENNA_MODELS;
  const LS_KEY = 'rfidInv.layout.v1';
  const SRC = {
    FXR90: 'https://docs.zebra.com/us/en/rfid/fxr90-rfid-reader/r-fxr90-technical-specifications.html',
    AN510: 'https://www.zebra.com/us/en/products/rfid/rfid-reader-antennas/an5x-an7x-series/an510.html',
    AN520: 'https://www.zebra.com/us/en/products/rfid/rfid-reader-antennas/an5x-an7x-series/an520.html',
    AN670: 'https://www.zebra.com/gb/en/products/rfid/rfid-reader-antennas/an6x-series/an670.html'
  };

  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const p2 = n => String(n).padStart(2, '0');
  const fmt = t => t == null ? '–' : p2(Math.floor(t / 3600) % 24) + ':' + p2(Math.floor(t / 60) % 60);
  const fmtS = t => t == null ? '–' : fmt(t) + ':' + p2(Math.floor(t) % 60);
  const hk = n => 'HK$ ' + Math.round(n).toLocaleString('en-HK');
  const pct = x => Math.round(x * 100) + '%';
  const nf = n => Number(n).toLocaleString('en-HK');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ago = t => {
    if (t == null) return 'never';
    const d = Math.max(0, T - t);
    if (d < 90) return Math.round(d) + ' s ago';
    if (d < 5400) return Math.round(d / 60) + ' min ago';
    return (d / 3600).toFixed(1) + ' h ago';
  };
  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* storage blocked */ } };

  /* ---------- config + data ---------- */
  function loadConfig() {
    const cfg = C.defaultConfig();
    const saved = lsGet(LS_KEY);
    if (saved) {
      try {
        const o = JSON.parse(saved);
        (o.antennas || []).forEach(s => {
          const a = cfg.antennas.find(x => x.id === s.id);
          if (!a) return;
          ['x', 'y', 'zone', 'model', 'reader', 'port', 'mount'].forEach(k => { if (s[k] != null) a[k] = s[k]; });
        });
      } catch (e) { /* ignore a broken saved layout */ }
    }
    return cfg;
  }
  function saveConfig() {
    lsSet(LS_KEY, JSON.stringify({ antennas: CFG.antennas.map(a => ({ id: a.id, x: a.x, y: a.y, zone: a.zone, model: a.model, reader: a.reader, port: a.port, mount: a.mount })) }));
  }

  let CFG = loadConfig();
  const zoneName = id => { const z = CFG.zones.find(z => z.id === id); return z ? z.name : (id || '–'); };
  const catBySku = new Map(CAT.map(c => [c.sku, c]));

  const sim = Sim.simulate(C.defaultConfig(), CAT, {});
  let DATA = { source: 'sim', reads: sim.reads, sales: sim.sales, tags: sim.tags, start: CFG.store.open - 600, end: CFG.store.close + 600 };
  let ENG = null;
  let T = 15 * 3600 + 42 * 60;
  let playing = true;
  let speed = 60;
  let snapCache = null;

  function rebuild() {
    ENG = E.createEngine(CFG, { catalogue: CAT, tags: DATA.tags, baselineUntil: DATA.source === 'sim' ? CFG.store.open : DATA.start + 600 });
    ENG.load(DATA);
    ENG.runTo(T);
    snapCache = null;
  }
  function setTime(t) {
    t = clamp(t, DATA.start, DATA.end);
    if (t < ENG.t) { T = t; rebuild(); } else { T = t; ENG.runTo(T); snapCache = null; }
  }
  function snap() {
    if (snapCache && snapCache.t === ENG.t) return snapCache;
    const inv = ENG.inventory();
    snapCache = {
      t: ENG.t, inv,
      kpis: ENG.kpis(inv), alerts: ENG.alerts(inv), flow: ENG.flow(), zones: ENG.zones(),
      ants: ENG.antennaStats(), repl: ENG.replenishment(inv)
    };
    return snapCache;
  }

  /* ---------- UI state ---------- */
  const UI = {
    view: 'dashboard', mapMode: 'stock', sel: null,
    inv: { q: '', cat: '', filter: '', open: new Set() },
    flowZone: 'fitting', replDone: new Set(), showDone: false, editAnt: false, importReader: 'FXR-A'
  };

  const VIEWS = [
    ['dashboard', 'Dashboard'], ['inventory', 'Inventory'], ['flow', 'Flow'],
    ['replenish', 'Replenishment'], ['antennas', 'Zones & antennas'], ['reads', 'Reads & import']
  ];

  /* ---------- map ---------- */
  const ROOMS = [0, 1, 2, 3, 4, 5].map(i => ({ x: 884, y: 62 + i * 54, w: 62, h: 48, i }));
  function antShape(model) {
    if (model === 'AN510') return '<polygon class="mk" points="0,-8 8,6 -8,6" style="fill:var(--ant-portal)"/>';
    if (model === 'AN670') return '<rect class="mk" x="-11" y="-4" width="22" height="8" rx="2" style="fill:var(--ant-point)"/>';
    return '<rect class="mk" x="-7" y="-7" width="14" height="14" rx="2" style="fill:var(--ant-area)"/>';
  }
  function antColor(model) { return model === 'AN510' ? 'var(--ant-portal)' : model === 'AN670' ? 'var(--ant-point)' : 'var(--ant-area)'; }
  function covered(zid) { return CFG.antennas.some(a => a.zone === zid); }

  function mapSVG(id, opts) {
    const st = CFG.store;
    const out = [];
    out.push(`<svg class="map" viewBox="${st.viewBox.join(' ')}" role="img" aria-label="Floor plan of ${esc(st.name)} with zones and antenna positions">`);
    out.push(`<defs><pattern id="hatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="7" height="7" style="fill:var(--surface)"/><line x1="0" y1="0" x2="0" y2="7" style="stroke:var(--ink-3);stroke-width:1.2;opacity:.45"/></pattern>`);
    out.push(`<clipPath id="clip-${id}"><polygon points="${st.outline}"/></clipPath></defs>`);
    out.push(`<polygon points="${st.outline}" style="fill:var(--surface)"/>`);
    out.push(`<g clip-path="url(#clip-${id})">`);
    for (const z of CFG.zones) {
      const cls = 'zr' + (covered(z.id) ? '' : ' nocover') + (UI.sel === z.id ? ' sel' : '');
      z.rects.forEach(r => out.push(`<rect class="${cls}" data-zone="${z.id}" x="${r[0]}" y="${r[1]}" width="${r[2]}" height="${r[3]}" rx="4"><title>${esc(z.name)}</title></rect>`));
    }
    ROOMS.forEach(r => out.push(`<rect class="room" x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="3"/>`));
    out.push('</g>');
    out.push(`<polygon class="wall" points="${st.outline}"/>`);
    const g = st.entranceGap; out.push(`<line class="gap" x1="${g[0]}" y1="${g[1]}" x2="${g[2]}" y2="${g[3]}"/>`);
    st.doors.forEach(d => out.push(`<line class="door" x1="${d.x1}" y1="${d.y1}" x2="${d.x2}" y2="${d.y2}"><title>${esc(d.label)}</title></line>`));
    if (opts.cables) {
      for (const a of CFG.antennas) {
        const r = CFG.readers.find(r => r.id === a.reader);
        if (r) out.push(`<path class="cable" d="M${r.x},${r.y} L${a.x},${a.y}"/>`);
      }
    }
    for (const z of CFG.zones) {
      const [lx, ly] = z.label;
      const small = z.rects[0][3] < 30;
      out.push(`<text class="zl${covered(z.id) ? '' : ' dim'}" x="${lx}" y="${ly}">${esc(z.name)}${covered(z.id) ? '' : ' · no antenna'}</text>`);
      if (covered(z.id) && !small) out.push(`<text class="zc num" id="zc-${id}-${z.id}" x="${lx}" y="${ly + 19}"></text>`);
    }
    ROOMS.forEach(r => out.push(`<text class="zl dim" x="${r.x + 6}" y="${r.y + 44}" style="font-size:9.5px">FR ${r.i + 1}</text>`));
    for (const r of CFG.readers) {
      out.push(`<g class="rdr" transform="translate(${r.x},${r.y})"><rect x="-21" y="-9" width="42" height="18" rx="3"/><text x="0" y="4" text-anchor="middle">${esc(r.id)}</text><title>${esc(r.model)} · ${esc(r.location)}</title></g>`);
    }
    for (const a of CFG.antennas) {
      const m = MODELS[a.model] || MODELS.AN520;
      out.push(`<g class="ant${opts.drag ? ' drag' : ''}" data-ant="${a.id}" transform="translate(${a.x},${a.y})">`);
      if (opts.coverage) out.push(`<circle class="cov" r="${m.coverR}" style="fill:${antColor(a.model)};stroke:${antColor(a.model)}"/>`);
      out.push(antShape(a.model));
      out.push(`<text x="10" y="-7">${esc(a.id)}</text>`);
      out.push(`<title>${esc(a.id)} · ${esc(a.model)} · ${esc(a.reader)} port ${a.port} · ${esc(zoneName(a.zone))}${a.portal ? ' · ' + a.side + ' side of ' + a.portal : ''}</title></g>`);
    }
    out.push(`<g id="pulse-${id}"></g>`);
    out.push('</svg>');
    return out.join('');
  }

  function updateMap(id, S, mode) {
    const host = document.getElementById('map-' + id);
    if (!host) return;
    const zstat = new Map(S.zones.map(z => [z.id, z]));
    const metric = z => mode === 'flow' ? (S.flow.zoneEntries[z] || 0) : (zstat.get(z) ? zstat.get(z).onHand : 0);
    let max = 1;
    CFG.zones.forEach(z => { if (covered(z.id) && (mode === 'flow' || z.kind !== 'boh')) max = Math.max(max, metric(z.id)); });
    host.querySelectorAll('.zr').forEach(r => {
      const z = r.dataset.zone;
      if (!covered(z)) return;
      const v = mode === 'coverage' ? 0 : metric(z);
      const a = mode === 'coverage' ? 0.04 : 0.03 + 0.22 * Math.min(1, v / max);
      r.style.fill = `rgba(var(--heat),${a.toFixed(3)})`;
      r.classList.toggle('sel', UI.sel === z);
    });
    CFG.zones.forEach(z => {
      const el = document.getElementById(`zc-${id}-${z.id}`);
      if (!el) return;
      if (mode === 'coverage') {
        el.innerHTML = '';
      } else if (z.kind === 'exit') {
        const p = S.flow.portals.entrance || { out: 0 };
        el.innerHTML = `${nf(p.out)}<tspan class="zc-sub" dx="5">left today</tspan>`;
      } else {
        const v = metric(z.id);
        el.innerHTML = `${nf(v)}<tspan class="zc-sub" dx="5">${mode === 'flow' ? 'in today' : 'items'}</tspan>`;
      }
    });
    const silent = new Set(S.ants.filter(a => a.status === 'silent').map(a => a.id));
    host.querySelectorAll('.ant').forEach(g => g.classList.toggle('silent', silent.has(g.dataset.ant)));
    const pg = document.getElementById('pulse-' + id);
    if (pg) {
      const pts = [];
      CFG.antennas.filter(a => silent.has(a.id)).forEach(a => pts.push([a.x, a.y]));
      const unpaid = S.alerts.filter(a => a.type === 'unpaid-exit' && T - a.t < 600);
      if (unpaid.length) pts.push([860, 460]);
      pg.innerHTML = pts.map(p => `<circle class="pulse" cx="${p[0]}" cy="${p[1]}" r="10"/>`).join('');
    }
  }

  function mapLegend(mode) {
    const sh = m => `<svg width="22" height="18" viewBox="-11 -9 22 18" aria-hidden="true">${antShape(m)}</svg>`;
    return `<span>${sh('AN520')}AN520 area</span><span>${sh('AN510')}AN510 doorway pair</span><span>${sh('AN670')}AN670 near field</span>` +
      `<span><svg width="44" height="16" aria-hidden="true"><rect x="1" y="1" width="42" height="14" rx="2" style="fill:var(--surface);stroke:var(--ink);stroke-width:1.5"/></svg>FXR90 reader</span>` +
      (mode === 'coverage' ? '<span>Dashed circle: rough read area</span>' : `<span><i class="heatbar"></i>${mode === 'flow' ? 'Items moved in today' : 'Items in zone'}</span>`) +
      '<span><svg width="18" height="14" aria-hidden="true"><rect width="18" height="14" fill="url(#hatch)" style="stroke:var(--zone-line)"/></svg>No antenna</span>';
  }

  function bindMapClicks(id) {
    const host = document.getElementById('map-' + id);
    host.addEventListener('click', e => {
      const r = e.target.closest('.zr');
      if (!r || !covered(r.dataset.zone)) return;
      UI.sel = UI.sel === r.dataset.zone ? null : r.dataset.zone;
      refresh(true);
    });
  }

  /* ---------- small components ---------- */
  function hourlyChart(rows, series, opts) {
    opts = opts || {};
    const W = 620, H = 230, L = 34, B = 26, TP = 10, Rr = 8;
    const shown = rows.filter(r => r.h * 3600 <= T);
    const n = rows.length;
    const stackMax = Math.max(1, ...shown.map(r => series.reduce((a, s) => a + r[s.key], 0)), ...(opts.line ? shown.map(r => r[opts.line.key]) : [0]));
    const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500][[1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500].findIndex(s => stackMax / s <= 5)] || 1000;
    const ymax = Math.ceil(stackMax / step) * step;
    const y = v => TP + (H - TP - B) * (1 - v / ymax);
    const bw = (W - L - Rr) / n;
    const parts = [`<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${esc(opts.label || 'Hourly flow')}" style="display:block">`];
    for (let v = 0; v <= ymax; v += step) {
      parts.push(`<line x1="${L}" x2="${W - Rr}" y1="${y(v)}" y2="${y(v)}" style="stroke:var(--line)"/>`);
      parts.push(`<text x="${L - 6}" y="${y(v) + 4}" text-anchor="end" style="fill:var(--ink-2);font-size:11px;font-family:var(--font-mono)">${v}</text>`);
    }
    rows.forEach((r, i) => {
      const x = L + i * bw;
      parts.push(`<text x="${x + bw / 2}" y="${H - 8}" text-anchor="middle" style="fill:var(--ink-2);font-size:11px;font-family:var(--font-mono)">${r.h}</text>`);
      if (r.h * 3600 > T) return;
      let acc = 0;
      series.forEach(s => {
        const v = r[s.key];
        if (!v) return;
        const y1 = y(acc + v), y0 = y(acc);
        parts.push(`<rect x="${(x + bw * 0.18).toFixed(1)}" width="${(bw * 0.64).toFixed(1)}" y="${y1.toFixed(1)}" height="${Math.max(0.5, y0 - y1).toFixed(1)}" style="fill:${s.color}"><title>${r.h}:00 · ${esc(s.label)}: ${v}</title></rect>`);
        acc += v;
      });
    });
    if (opts.line) {
      const pts = shown.map(r => [L + (rows.indexOf(r) + 0.5) * bw, y(r[opts.line.key])]);
      if (pts.length) {
        parts.push(`<polyline points="${pts.map(p => p.map(v => v.toFixed(1)).join(',')).join(' ')}" style="fill:none;stroke:var(--ink-2);stroke-width:1.5"/>`);
        pts.forEach((p, i) => parts.push(`<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="${i === pts.length - 1 ? 4 : 2.5}" style="fill:var(--ink-2)"><title>${shown[i].h}:00 · ${esc(opts.line.label)}: ${shown[i][opts.line.key]}</title></circle>`));
      }
    }
    parts.push('</svg>');
    return parts.join('');
  }
  function chartLegend(series, line) {
    return '<div class="legend" style="margin-top:0">' + series.map(s => `<span><svg width="10" height="10" aria-hidden="true"><rect width="10" height="10" rx="2" style="fill:${s.color}"/></svg>${esc(s.label)}</span>`).join('') +
      (line ? `<span><svg width="16" height="10" aria-hidden="true"><line x1="0" x2="16" y1="5" y2="5" style="stroke:var(--ink-2);stroke-width:1.5"/><circle cx="8" cy="5" r="2.5" style="fill:var(--ink-2)"/></svg>${esc(line.label)}</span>` : '') + '</div>';
  }
  function alertsHTML(list, limit) {
    if (!list.length) return '<div class="empty">No open alerts.</div>';
    return list.slice(0, limit || 50).map(a => `<div class="alert ${a.prio}"><span class="sv" aria-hidden="true"></span><div><b>${esc(a.title)}</b><span class="d">${esc(a.detail)}</span></div><span class="t">${a.prio} · ${fmt(a.t)}</span></div>`).join('');
  }
  function swatch(hex) { return `<span class="sw" style="background:${esc(hex)}"></span>`; }
  function statusPill(s) { return s === 'ok' ? '<span class="pill ok">Reading</span>' : s === 'silent' ? '<span class="pill bad">No reads</span>' : '<span class="pill idle">Waiting</span>'; }

  /* ---------- views ---------- */
  const views = {};

  views.dashboard = {
    shell() {
      return `<section class="kpis" id="kpis" aria-label="Key figures"></section>
      <div class="grid g-dash">
        <div class="card">
          <div class="card-h"><div><h2>Store map</h2><div class="small muted">Zones, and where each antenna is mounted. Select a zone for detail.</div></div>
          <div class="seg" id="mapMode" role="group" aria-label="Map shows">
            <button type="button" data-m="stock">Stock</button><button type="button" data-m="flow">Flow today</button><button type="button" data-m="coverage">Antennas</button></div></div>
          <div class="mapbox" id="map-dash"></div>
          <div class="legend" id="legend-dash"></div>
        </div>
        <div class="stack">
          <div class="card" id="zonePanel"></div>
          <div class="card"><div class="card-h"><h2>Alerts</h2><div class="chips" id="alertChips"></div></div><div class="alerts" id="alertList"></div></div>
        </div>
      </div>
      <div class="grid g-2" style="margin-top:14px">
        <div class="card"><div class="card-h"><h2>Flow by hour</h2><span class="small muted">Whole store, items</span></div><div id="hourly"></div><div id="hourlyLegend"></div></div>
        <div class="card"><div class="card-h"><h2>Zones today</h2><span class="small muted">Items moving in and out</span></div><div class="tbl-wrap" id="zoneTbl"></div></div>
      </div>
      <div class="card" style="margin-top:14px"><div class="card-h"><h2>Bring out next</h2><a class="small" href="#replenish">All replenishment</a></div><div class="tbl-wrap" id="replPrev"></div></div>`;
    },
    mount() {
      $('#map-dash').innerHTML = mapSVG('dash', { coverage: UI.mapMode === 'coverage', cables: UI.mapMode === 'coverage' });
      $('#legend-dash').innerHTML = mapLegend(UI.mapMode);
      bindMapClicks('dash');
      $('#mapMode').querySelectorAll('button').forEach(b => {
        b.setAttribute('aria-pressed', String(b.dataset.m === UI.mapMode));
        b.onclick = () => { UI.mapMode = b.dataset.m; render(); };
      });
      $('#zonePanel').addEventListener('click', e => { if (e.target.id === 'clearSel') { UI.sel = null; refresh(true); } });
      $('#zoneTbl').addEventListener('click', e => { const tr = e.target.closest('tr[data-zone]'); if (tr) { UI.sel = UI.sel === tr.dataset.zone ? null : tr.dataset.zone; refresh(true); } });
    },
    update(S) {
      const k = S.kpis, f = S.flow;
      const ac = { P1: 0, P2: 0, P3: 0 }; S.alerts.forEach(a => ac[a.prio]++);
      const total = Math.max(1, k.floor + k.boh + k.fr);
      $('#kpis').innerHTML = [
        `<div class="kpi"><span class="eyebrow">On hand</span><span class="v">${nf(k.onHand)}<small>items</small></span><div class="split" title="Floor ${k.floor} · Stockroom ${k.boh} · Fitting rooms ${k.fr}"><i style="width:${k.floor / total * 100}%;background:var(--s1)"></i><i style="width:${k.fr / total * 100}%;background:var(--s2)"></i><i style="width:${k.boh / total * 100}%;background:var(--s4)"></i></div><span class="s">Floor ${nf(k.floor)} · Stockroom ${nf(k.boh)}</span></div>`,
        `<div class="kpi"><span class="eyebrow">Sizes on floor</span><span class="v">${pct(k.sizesOnFloor)}</span><span class="s">of sizes with stock in store</span></div>`,
        `<div class="kpi"><span class="eyebrow">Sold today</span><span class="v">${nf(k.sold)}<small>items</small></span><span class="s">${hk(k.salesValue)}</span></div>`,
        `<div class="kpi"><span class="eyebrow">Store flow</span><span class="v">${nf(f.totalMoves)}<small>moves</small></span><span class="s">Zone-to-zone item moves today</span></div>`,
        `<div class="kpi"><span class="eyebrow">Stockroom → floor</span><span class="v">${nf((f.portals['boh-door'] || {}).out || 0)}</span><span class="s">Through the door · ${nf(f.received)} received</span></div>`,
        `<div class="kpi"><span class="eyebrow">Alerts</span><span class="v">${S.alerts.length}</span><span class="chips"><span class="chip P1">P1 ${ac.P1}</span><span class="chip P2">P2 ${ac.P2}</span><span class="chip P3">P3 ${ac.P3}</span></span></div>`
      ].join('');
      updateMap('dash', S, UI.mapMode);
      $('#zonePanel').innerHTML = zonePanel(S);
      $('#alertChips').innerHTML = `<span class="chip P1">${ac.P1}</span><span class="chip P2">${ac.P2}</span><span class="chip P3">${ac.P3}</span>`;
      $('#alertList').innerHTML = alertsHTML(S.alerts, 30);
      const series = [{ key: 'bohToFloor', label: 'Stockroom → floor', color: 'var(--s1)' }, { key: 'intoFR', label: 'Into fitting rooms', color: 'var(--s2)' }, { key: 'sold', label: 'Sold', color: 'var(--s3)' }];
      const line = { key: 'moves', label: 'All zone moves' };
      $('#hourly').innerHTML = hourlyChart(f.hourly, series, { line, label: 'Item flow by hour' });
      $('#hourlyLegend').innerHTML = chartLegend(series, line);
      const zs = S.zones.filter(z => covered(z.id) && z.kind !== 'exit');
      $('#zoneTbl').innerHTML = `<table><thead><tr><th>Zone</th><th>Antennas</th><th class="r">Items</th><th class="r">In</th><th class="r">Out</th></tr></thead><tbody>${zs.map(z =>
        `<tr class="click" data-zone="${z.id}"${UI.sel === z.id ? ' style="font-weight:600"' : ''}><td>${esc(z.name)}</td><td class="mono">${esc(z.antennas.join(' '))}</td><td class="r">${nf(z.onHand)}</td><td class="r">${nf(z.in)}</td><td class="r">${nf(z.out)}</td></tr>`).join('')}</tbody></table>`;
      $('#replPrev').innerHTML = replTable(S.repl.filter(r => !UI.replDone.has(r.key)).slice(0, 6));
    }
  };

  function zonePanel(S) {
    if (!UI.sel) {
      const k = S.kpis, f = S.flow;
      return `<div class="card-h"><div><span class="eyebrow">Whole store</span><h2>${esc(CFG.store.name)}</h2></div><span class="small muted">${CFG.antennas.length} antennas · ${CFG.readers.length} FXR90</span></div>
        <div class="bars">${[['Sales floor', k.floor], ['Stockroom', k.boh], ['Fitting rooms', k.fr]].map(([l, v]) => barRow(l, v, Math.max(k.floor, k.boh, 1))).join('')}</div>
        <p class="small muted" style="margin:10px 0 0">Fitting rooms today: ${nf(f.fr.items)} items, about ${nf(f.fr.sessions)} visits, ${pct(f.fr.conversion)} of those items sold. Select a zone on the map to see what is in it.</p>`;
    }
    const z = S.zones.find(z => z.id === UI.sel);
    const cfgZ = CFG.zones.find(x => x.id === UI.sel);
    const items = ENG.itemsInZone(UI.sel);
    const by = new Map();
    items.forEach(it => { const k = it.sku; by.set(k, (by.get(k) || 0) + 1); });
    const top = Array.from(by.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const ants = CFG.antennas.filter(a => a.zone === UI.sel);
    let extra = '';
    if (cfgZ.kind === 'fr') extra = `<p class="small" style="margin:8px 0 0"><b>${S.flow.fr.leftNow}</b> item(s) here over 15 min. ${nf(S.flow.fr.items)} items came in today.</p>`;
    if (cfgZ.kind === 'boh') extra = `<p class="small" style="margin:8px 0 0">Received today: <b>${nf(S.flow.received)}</b>. Door out / in: <b>${nf((S.flow.portals['boh-door'] || {}).out || 0)}</b> / <b>${nf((S.flow.portals['boh-door'] || {}).in || 0)}</b>.</p>`;
    return `<div class="card-h"><div><span class="eyebrow">Zone</span><h2>${esc(z.name)}</h2></div><button class="btn small" type="button" id="clearSel">Whole store</button></div>
      <div class="chips" style="margin-bottom:10px">${ants.map(a => `<span class="chip" title="${esc(a.mount)}">${esc(a.id)} · ${esc(a.model)} · ${esc(a.reader)}:${a.port}</span>`).join('')}</div>
      <div class="grid" style="grid-template-columns:repeat(3,1fr);gap:8px">
        <div><span class="eyebrow">Items</span><div class="kpi" style="padding:0"><span class="v">${nf(z.onHand)}</span></div></div>
        <div><span class="eyebrow">In today</span><div class="kpi" style="padding:0"><span class="v">${nf(z.in)}</span></div></div>
        <div><span class="eyebrow">Out today</span><div class="kpi" style="padding:0"><span class="v">${nf(z.out)}</span></div></div>
      </div>${extra}
      <div style="margin-top:10px">${top.length ? top.map(([sku, n]) => { const c = catBySku.get(sku) || { name: sku, hex: '#999', color: '' }; return `<div class="barrow" style="grid-template-columns:minmax(0,1fr) 40px"><span>${swatch(c.hex)}${esc(c.name)} <span class="muted">${esc(c.color)}</span></span><span class="r num" style="text-align:right">${n}</span></div>`; }).join('') : '<div class="empty">No items read here.</div>'}</div>`;
  }
  function barRow(label, v, max) {
    return `<div class="barrow"><span>${esc(label)}</span><span class="track"><i style="width:${(v / max * 100).toFixed(1)}%"></i></span><span class="num" style="text-align:right">${nf(v)}</span></div>`;
  }
  function replTable(rows) {
    if (!rows.length) return '<div class="empty">Every size on the floor is at its fixture level.</div>';
    return `<table><thead><tr><th>Item</th><th>Size</th><th>Zone</th><th class="r">Floor</th><th class="r">Target</th><th class="r">Stockroom</th><th class="r">Bring out</th></tr></thead><tbody>${rows.map(r =>
      `<tr><td>${swatch(r.hex)}${esc(r.name)} <span class="muted">${esc(r.color)}</span></td><td>${esc(r.size)}</td><td>${esc(zoneName(r.home))}</td><td class="r${r.floor === 0 ? ' zero' : ''}">${r.floor}</td><td class="r">${r.target}</td><td class="r">${r.boh}</td><td class="r"><b>${r.suggest}</b></td></tr>`).join('')}</tbody></table>`;
  }

  views.inventory = {
    shell() {
      const cats = Array.from(new Set(CAT.map(c => c.cat)));
      return `<div class="card">
        <div class="card-h"><div><h2>Inventory by size</h2><div class="small muted" id="invSum"></div></div>
          <div class="toolbar" style="margin:0"><button class="btn small" type="button" id="copyCsv">Copy CSV</button><button class="btn small" type="button" id="dlCsv">Download CSV</button></div></div>
        <div class="toolbar">
          <input type="search" id="invQ" placeholder="Search item, colour, SKU or EPC" value="${esc(UI.inv.q)}" aria-label="Search inventory">
          <select class="btn" id="invCat" aria-label="Category"><option value="">All categories</option>${cats.map(c => `<option${UI.inv.cat === c ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select>
          <select class="btn" id="invFilter" aria-label="Show">
            ${[['', 'All sizes'], ['empty', 'Not on the floor'], ['low', 'Below fixture level'], ['fr', 'In fitting rooms'], ['missing', 'Not seen for 4 h']].map(([v, l]) => `<option value="${v}"${UI.inv.filter === v ? ' selected' : ''}>${l}</option>`).join('')}
          </select>
        </div>
        <div class="tbl-wrap" id="invTbl"></div>
      </div>`;
    },
    mount() {
      $('#invQ').oninput = e => { UI.inv.q = e.target.value; refresh(true); };
      $('#invCat').onchange = e => { UI.inv.cat = e.target.value; refresh(true); };
      $('#invFilter').onchange = e => { UI.inv.filter = e.target.value; refresh(true); };
      $('#invTbl').addEventListener('click', e => {
        const tr = e.target.closest('tr[data-key]');
        if (!tr) return;
        const k = tr.dataset.key;
        if (UI.inv.open.has(k)) UI.inv.open.delete(k); else UI.inv.open.add(k);
        refresh(true);
      });
      $('#copyCsv').onclick = () => copyText(invCSV(), 'Inventory CSV copied');
      const dl = $('#dlCsv');
      if (dl) dl.onclick = () => download('inventory-' + fmt(T).replace(':', '') + '.csv', invCSV());
    },
    rows(S) {
      const q = UI.inv.q.trim().toLowerCase();
      return S.inv.filter(r => {
        if (UI.inv.cat && r.cat !== UI.inv.cat) return false;
        if (UI.inv.filter === 'empty' && !(r.floor === 0 && r.total > 0)) return false;
        if (UI.inv.filter === 'low' && !(r.face && r.floor < r.face)) return false;
        if (UI.inv.filter === 'fr' && !r.fr) return false;
        if (UI.inv.filter === 'missing' && !r.missing) return false;
        if (q && !(r.name + ' ' + r.color + ' ' + r.sku + ' ' + r.size).toLowerCase().includes(q) && !r.epcs.some(it => it.epc.toLowerCase().includes(q))) return false;
        return true;
      });
    },
    update(S) {
      const rows = this.rows(S);
      const tot = rows.reduce((a, r) => { a.floor += r.floor; a.boh += r.boh; a.fr += r.fr; a.cash += r.cash; a.total += r.total; a.sold += r.sold; return a; }, { floor: 0, boh: 0, fr: 0, cash: 0, total: 0, sold: 0 });
      $('#invSum').textContent = `${rows.length} sizes · ${nf(tot.total)} items on hand · as at ${fmt(T)}`;
      const body = rows.map(r => {
        const open = UI.inv.open.has(r.key);
        let html = `<tr class="click" data-key="${esc(r.key)}" aria-expanded="${open}"><td>${swatch(r.hex)}${esc(r.name)} <span class="muted">${esc(r.color)}</span></td><td class="mono">${esc(r.sku)}</td><td>${esc(r.size)}</td><td>${esc(zoneName(r.home))}</td>
          <td class="r${r.floor === 0 && r.total ? ' zero' : ''}">${r.floor}</td><td class="r">${r.face || '–'}</td><td class="r">${r.boh}</td><td class="r">${r.fr || '<span class="dim">0</span>'}</td><td class="r">${r.cash || '<span class="dim">0</span>'}</td><td class="r"><b>${r.total}</b></td><td class="r">${r.sold}</td><td class="r">${r.missing ? '<span class="zero">' + r.missing + '</span>' : '<span class="dim">0</span>'}</td><td class="mono">${fmt(r.lastSeen)}</td></tr>`;
        if (open) {
          const list = r.epcs.slice().sort((a, b) => (a.zone || '').localeCompare(b.zone || ''));
          html += `<tr class="sub"><td colspan="13"><div class="tbl-wrap"><table><thead><tr><th>EPC</th><th>Zone</th><th>In zone since</th><th>Last read</th><th>Antenna</th></tr></thead><tbody>${list.map(it =>
            `<tr><td class="mono">${esc(it.epc)}</td><td>${esc(zoneName(it.zone))}${ENG.isMissing(it) ? ' <span class="pill bad">Not seen</span>' : ''}</td><td class="mono">${fmt(it.since)}</td><td class="mono">${fmtS(it.lastSeen)} <span class="muted">${ago(it.lastSeen)}</span></td><td class="mono">${esc(it.lastAnt || '')}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No tags on hand.</td></tr>'}</tbody></table></div></td></tr>`;
        }
        return html;
      }).join('');
      $('#invTbl').innerHTML = `<table><thead><tr><th>Item</th><th>SKU</th><th>Size</th><th>Home zone</th><th class="r">Floor</th><th class="r">Fixture</th><th class="r">Stockroom</th><th class="r">Fitting</th><th class="r">Cash wrap</th><th class="r">On hand</th><th class="r">Sold</th><th class="r">Missing</th><th>Last read</th></tr></thead>
        <tbody>${body || '<tr><td colspan="13" class="muted">No sizes match.</td></tr>'}</tbody>
        <tfoot><tr><th colspan="4">Total</th><th class="r">${nf(tot.floor)}</th><th></th><th class="r">${nf(tot.boh)}</th><th class="r">${nf(tot.fr)}</th><th class="r">${nf(tot.cash)}</th><th class="r">${nf(tot.total)}</th><th class="r">${nf(tot.sold)}</th><th></th><th></th></tr></tfoot></table>`;
    }
  };
  function invCSV() {
    const S = snap();
    const head = ['sku', 'name', 'colour', 'size', 'category', 'home_zone', 'floor', 'fixture_qty', 'stockroom', 'fitting_rooms', 'cash_wrap', 'on_hand', 'sold_today', 'missing', 'last_read'];
    const q = v => /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v);
    const lines = [head.join(',')].concat(S.inv.map(r => [r.sku, r.name, r.color, r.size, r.cat, zoneName(r.home), r.floor, r.face, r.boh, r.fr, r.cash, r.total, r.sold, r.missing, fmtS(r.lastSeen)].map(q).join(',')));
    return lines.join('\n');
  }

  views.flow = {
    shell() {
      const zs = CFG.zones.filter(z => covered(z.id) && z.kind !== 'exit');
      return `<section class="kpis" id="flowKpis" aria-label="Flow figures"></section>
      <div class="grid g-2">
        <div class="card"><div class="card-h"><h2>Items moving into each zone</h2><span class="small muted">Today</span></div><div class="bars" id="entries"></div></div>
        <div class="card"><div class="card-h"><h2>From zone → to zone</h2><span class="small muted">Rows: where items came from</span></div><div class="tbl-wrap" id="matrix"></div></div>
      </div>
      <div class="grid g-2" style="margin-top:14px">
        <div class="card"><div class="card-h"><h2>Zone by hour</h2><select class="btn" id="flowZone" aria-label="Zone">${zs.map(z => `<option value="${z.id}"${UI.flowZone === z.id ? ' selected' : ''}>${esc(z.name)}</option>`).join('')}</select></div><div id="zoneHourly"></div><div id="zoneHourlyLegend"></div></div>
        <div class="card note"><h2 style="color:var(--ink);margin-bottom:8px">How flow is counted without a path</h2>
          <p>Each antenna belongs to one zone. A tag is in the zone whose antennas read it strongest. It moves only when the new zone wins two report windows in a row, or wins by 6 dB, so one stray read does not move it.</p>
          <p>Every zone change is one movement. Adding the movements across all zones gives the store's flow.</p>
          <p>The stockroom door and the entrance each have an inner and an outer AN510. The order the two antennas read a tag gives the direction: stockroom to floor, or out of the store. An exit with no POS sale is a P1 alert.</p>
          <p>Fitting room visits are estimated from tags arriving close together. There is no per-room or per-customer tracking in this version.</p>
        </div>
      </div>`;
    },
    mount() { $('#flowZone').onchange = e => { UI.flowZone = e.target.value; refresh(true); }; },
    update(S) {
      const f = S.flow, bd = f.portals['boh-door'] || { out: 0, in: 0 }, en = f.portals.entrance || { out: 0, in: 0 };
      const unpaid = f.hourly.reduce((a, h) => a + h.unpaid, 0);
      $('#flowKpis').innerHTML = [
        ['Store flow', nf(f.totalMoves), 'Zone-to-zone moves'],
        ['Stockroom → floor', nf(bd.out), `Floor → stockroom ${nf(bd.in)}`],
        ['Fitting rooms', nf(f.fr.items), `Items · about ${nf(f.fr.sessions)} visits`],
        ['Fitting room to sale', pct(f.fr.conversion), `${nf(f.fr.converted)} items sold after trying`],
        ['Left the store', nf(en.out), `Unpaid: ${unpaid}`],
        ['Received', nf(f.received), 'New tags in stockroom']
      ].map(([l, v, s]) => `<div class="kpi"><span class="eyebrow">${l}</span><span class="v">${v}</span><span class="s">${s}</span></div>`).join('');
      const zs = CFG.zones.filter(z => covered(z.id) && z.kind !== 'exit');
      const max = Math.max(1, ...zs.map(z => f.zoneEntries[z.id] || 0));
      $('#entries').innerHTML = zs.map(z => barRow(z.name, f.zoneEntries[z.id] || 0, max)).join('');
      let mmax = 1;
      zs.forEach(a => zs.forEach(b => { mmax = Math.max(mmax, ((f.matrix[a.id] || {})[b.id]) || 0); }));
      const short = n => n.replace('Fitting rooms', 'Fitting').replace('Top shelf overstock', 'Top shelf');
      $('#matrix').innerHTML = `<table class="matrix"><thead><tr><th class="rowh">From \\ To</th>${zs.map(z => `<th title="${esc(z.name)}">${esc(short(z.name))}</th>`).join('')}</tr></thead><tbody>${zs.map(a =>
        `<tr><th class="rowh">${esc(short(a.name))}</th>${zs.map(b => {
          const v = ((f.matrix[a.id] || {})[b.id]) || 0;
          if (a.id === b.id) return '<td class="dim">·</td>';
          return `<td class="num" style="background:rgba(var(--heat),${v ? (0.06 + 0.5 * v / mmax).toFixed(3) : 0})">${v || '<span class="dim">0</span>'}</td>`;
        }).join('')}</tr>`).join('')}</tbody></table>`;
      const zid = UI.flowZone;
      const h0 = Math.floor(CFG.store.open / 3600);
      const rows = f.hourly.map(r => ({ h: r.h, in: 0, out: 0 }));
      ENG.state.movements.forEach(m => {
        const i = clamp(Math.floor(m.t / 3600) - h0, 0, rows.length - 1);
        if (m.to === zid) rows[i].in++;
        if (m.from === zid) rows[i].out++;
      });
      const series = [{ key: 'in', label: 'Moved in', color: 'var(--s1)' }, { key: 'out', label: 'Moved out', color: 'var(--s2)' }];
      $('#zoneHourly').innerHTML = hourlyChart(rows, series, { label: zoneName(zid) + ' flow by hour' });
      $('#zoneHourlyLegend').innerHTML = chartLegend(series);
    }
  };

  views.replenish = {
    shell() {
      return `<div class="card-h"><div><h2>Replenishment</h2><div class="small muted">Floor count vs fixture level and today's sales rate. Stock comes from the stockroom count.</div></div>
        <label class="small"><input type="checkbox" id="showDone"${UI.showDone ? ' checked' : ''}> Show done</label></div>
        <div class="cards" id="replCards"></div>`;
    },
    mount() {
      $('#showDone').onchange = e => { UI.showDone = e.target.checked; refresh(true); };
      $('#replCards').addEventListener('click', e => {
        const b = e.target.closest('button[data-done]');
        if (!b) return;
        const k = b.dataset.done;
        if (UI.replDone.has(k)) UI.replDone.delete(k); else UI.replDone.add(k);
        refresh(true);
      });
    },
    update(S) {
      const list = S.repl.filter(r => UI.showDone || !UI.replDone.has(r.key));
      $('#replCards').innerHTML = list.length ? list.map(r => {
        const done = UI.replDone.has(r.key);
        return `<div class="rcard${r.floor === 0 ? ' empty-floor' : ''}"${done ? ' style="opacity:.55"' : ''}>
          <div class="top"><div>${swatch(r.hex)}<b>${esc(r.name)}</b><div class="small muted">${esc(r.color)} · size ${esc(r.size)} · ${esc(zoneName(r.home))}</div></div><div style="text-align:right"><div class="qty">${r.suggest}</div><div class="small muted">bring out</div></div></div>
          <div class="meta"><span>Floor<b class="${r.floor === 0 ? 'zero' : ''}">${r.floor}</b></span><span>Target<b>${r.target}</b></span><span>Stockroom<b>${r.boh}</b></span></div>
          <button class="btn small" type="button" data-done="${esc(r.key)}">${done ? 'Undo' : 'Mark done'}</button></div>`;
      }).join('') : '<div class="empty">Nothing to bring out right now.</div>';
    }
  };

  views.antennas = {
    shell() {
      return `<div id="cfgWarn"></div>
      <div class="grid g-2">
        <div class="card"><div class="card-h"><div><h2>Zones and antenna positions</h2><div class="small muted">Dotted lines run from each FXR90 to its antennas.</div></div>
          <button class="btn small" type="button" id="editAnt" aria-pressed="${UI.editAnt}">${UI.editAnt ? 'Done moving' : 'Move antennas'}</button></div>
          <div class="mapbox" id="map-cfg"></div><div class="legend" id="legend-cfg"></div></div>
        <div class="stack">
          <div class="card"><div class="card-h"><h2>Readers</h2><a class="small" href="${SRC.FXR90}" target="_blank" rel="noopener">FXR90 spec</a></div><div class="tbl-wrap" id="rdrTbl"></div></div>
          <div class="card"><h2 style="margin-bottom:8px">Coverage</h2><div id="coverage" class="small"></div></div>
        </div>
      </div>
      <div class="card" style="margin-top:14px"><div class="card-h"><h2>Antennas</h2><button class="btn small" type="button" id="resetLayout">Reset to default layout</button></div><div class="tbl-wrap" id="antTbl"></div></div>
      <div class="models" style="margin-top:14px">${['AN520', 'AN510', 'AN670'].map(m => {
        const M = MODELS[m];
        return `<div class="card model"><h3><svg width="22" height="18" viewBox="-11 -9 22 18" aria-hidden="true">${antShape(m)}</svg>${m}</h3><p class="small muted" style="margin:6px 0 0">${esc(M.use)}</p>
          <dl><dt>Polarisation</dt><dd>${esc(M.polarization)}</dd><dt>Gain</dt><dd>${esc(M.gain)}</dd><dt>Beam</dt><dd>${esc(M.beam)}</dd><dt>Used for</dt><dd>${CFG.antennas.filter(a => a.model === m).map(a => a.id).join(', ') || '–'}</dd></dl>
          <a class="small" href="${SRC[m]}" target="_blank" rel="noopener">Zebra product page</a></div>`;
      }).join('')}</div>`;
    },
    mount() {
      const draw = () => {
        $('#map-cfg').innerHTML = mapSVG('cfg', { coverage: true, cables: true, drag: UI.editAnt });
        $('#legend-cfg').innerHTML = mapLegend('coverage');
        bindDrag();
        updateMap('cfg', snap(), 'coverage');
      };
      draw();
      bindMapClicks('cfg');
      $('#editAnt').onclick = () => { UI.editAnt = !UI.editAnt; render(); };
      $('#resetLayout').onclick = () => { CFG = C.defaultConfig(); lsSet(LS_KEY, ''); rebuild(); toast('Layout reset'); render(); };
      $('#antTbl').addEventListener('change', e => {
        const s = e.target.closest('select[data-ant]');
        if (!s) return;
        const a = CFG.antennas.find(x => x.id === s.dataset.ant);
        const f = s.dataset.f;
        a[f] = f === 'port' ? +s.value : s.value;
        saveConfig(); rebuild(); render();
        toast(`${a.id} updated`);
      });
      function bindDrag() {
        if (!UI.editAnt) return;
        const svg = $('#map-cfg svg');
        let dragging = null;
        const pt = e => { const p = svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; return p.matrixTransform(svg.getScreenCTM().inverse()); };
        svg.addEventListener('pointerdown', e => {
          const g = e.target.closest('.ant');
          if (!g) return;
          dragging = { g, a: CFG.antennas.find(x => x.id === g.dataset.ant) };
          svg.setPointerCapture(e.pointerId);
          e.preventDefault();
        });
        svg.addEventListener('pointermove', e => {
          if (!dragging) return;
          const p = pt(e);
          dragging.a.x = Math.round(clamp(p.x, 10, 990)); dragging.a.y = Math.round(clamp(p.y, 10, 570));
          dragging.g.setAttribute('transform', `translate(${dragging.a.x},${dragging.a.y})`);
        });
        const end = () => { if (!dragging) return; dragging = null; saveConfig(); draw(); };
        svg.addEventListener('pointerup', end);
        svg.addEventListener('pointercancel', end);
      }
    },
    update(S) {
      // Validation: port clashes, ports beyond the reader, portal pairs.
      const warns = [];
      const seen = new Map();
      CFG.antennas.forEach(a => {
        const k = a.reader + ':' + a.port;
        if (seen.has(k)) warns.push(`${a.id} and ${seen.get(k)} are both on ${a.reader} port ${a.port}.`);
        seen.set(k, a.id);
        const r = CFG.readers.find(r => r.id === a.reader);
        const ports = r ? C.READER_MODELS[r.model].ports : 0;
        if (a.port > ports) warns.push(`${a.id} uses port ${a.port}, but ${a.reader} has ${ports} ports.`);
      });
      CFG.portals.forEach(p => {
        const ps = CFG.antennas.filter(a => a.portal === p.id);
        if (!ps.some(a => a.side === 'inner') || !ps.some(a => a.side === 'outer')) warns.push(`${p.name} needs an inner and an outer antenna to count direction.`);
      });
      $('#cfgWarn').innerHTML = warns.map(w => `<div class="warn">${esc(w)}</div>`).join('');
      $('#rdrTbl').innerHTML = `<table><thead><tr><th>Reader</th><th>Model</th><th class="r">Ports used</th><th>Location</th></tr></thead><tbody>${CFG.readers.map(r =>
        `<tr><td class="mono">${esc(r.id)}</td><td>${esc(r.model)}</td><td class="r">${CFG.antennas.filter(a => a.reader === r.id).length} / ${C.READER_MODELS[r.model].ports}</td><td>${esc(r.location)}</td></tr>`).join('')}</tbody></table>`;
      const unc = CFG.zones.filter(z => !covered(z.id));
      $('#coverage').innerHTML = `<p style="margin:0 0 6px">${CFG.zones.length - unc.length} of ${CFG.zones.length} zones have an antenna.</p>
        <p class="muted" style="margin:0 0 6px">No antenna: ${unc.map(z => esc(z.name)).join(', ') || 'none'}. Items there are not counted until they move into a covered zone.</p>
        <p class="muted" style="margin:0">Location is by zone only. Antennas sit below the false ceiling, where the site test read far better than above it.</p>`;
      const stat = new Map(S.ants.map(a => [a.id, a]));
      const zoneOpts = sel => CFG.zones.map(z => `<option value="${z.id}"${z.id === sel ? ' selected' : ''}>${esc(z.name)}</option>`).join('');
      const modelOpts = sel => Object.keys(MODELS).map(m => `<option${m === sel ? ' selected' : ''}>${m}</option>`).join('');
      const portOpts = (a) => { const r = CFG.readers.find(r => r.id === a.reader); const n = r ? C.READER_MODELS[r.model].ports : 8; let o = ''; for (let i = 1; i <= n; i++) o += `<option${i === a.port ? ' selected' : ''}>${i}</option>`; return o; };
      $('#antTbl').innerHTML = `<table><thead><tr><th>Antenna</th><th>Reader</th><th>Port</th><th>Model</th><th>Zone</th><th>Role</th><th>Mount</th><th class="r">Reads, 5 min</th><th>Last read</th><th>Status</th></tr></thead><tbody>${CFG.antennas.map(a => {
        const s = stat.get(a.id) || {};
        const role = a.portal ? `${a.side === 'inner' ? 'Inner' : 'Outer'} · ${CFG.portals.find(p => p.id === a.portal).name}` : (a.model === 'AN670' ? 'Near-field point' : 'Area');
        return `<tr><td class="mono"><b>${esc(a.id)}</b></td>
          <td><select class="btn small" data-ant="${a.id}" data-f="reader" aria-label="${a.id} reader">${CFG.readers.map(r => `<option${r.id === a.reader ? ' selected' : ''}>${r.id}</option>`).join('')}</select></td>
          <td><select class="btn small" data-ant="${a.id}" data-f="port" aria-label="${a.id} port">${portOpts(a)}</select></td>
          <td><select class="btn small" data-ant="${a.id}" data-f="model" aria-label="${a.id} model">${modelOpts(a.model)}</select></td>
          <td><select class="btn small" data-ant="${a.id}" data-f="zone" aria-label="${a.id} zone">${zoneOpts(a.zone)}</select></td>
          <td>${esc(role)}</td><td class="small">${esc(a.mount)}</td><td class="r">${nf(s.last5 || 0)}</td><td class="mono">${fmtS(s.last)}</td><td>${statusPill(s.status)}</td></tr>`;
      }).join('')}</tbody></table>`;
      updateMap('cfg', S, 'coverage');
    }
  };

  views.reads = {
    shell() {
      return `<div class="grid g-2">
        <div class="card"><div class="card-h"><h2>Load reads from the readers</h2><span class="small muted" id="srcInfo"></span></div>
          <div class="note"><p>CSV with columns <span class="mono">timestamp, epc, antenna, rssi</span>. Instead of <span class="mono">antenna</span> you can give <span class="mono">reader, port</span>. Optional <span class="mono">sku, size</span> name the product.</p>
          <p>JSON from the FXR90 IoT Connector also works: tag events with <span class="mono">data.idHex</span>, <span class="mono">data.antenna</span> (port) and <span class="mono">data.peakRssi</span>. Pick the reader the file came from.</p></div>
          <div class="toolbar" style="margin-top:10px">
            <select class="btn" id="impReader" aria-label="Reader for port numbers">${CFG.readers.map(r => `<option${r.id === UI.importReader ? ' selected' : ''}>${r.id}</option>`).join('')}</select>
            <label class="btn" for="impReads">Choose reads file</label><input type="file" id="impReads" accept=".csv,.json,.txt,.ndjson" hidden>
            <label class="btn" for="impSales">POS sales CSV (optional)</label><input type="file" id="impSales" accept=".csv" hidden>
            <button class="btn" type="button" id="backSim">Back to simulated day</button>
          </div>
          <div id="impMsg" class="small"></div>
        </div>
        <div class="card"><div class="card-h"><h2>Doorway crossings</h2><span class="small muted">Latest first</span></div><div class="tbl-wrap" id="portalTbl" style="max-height:260px;overflow:auto"></div></div>
      </div>
      <div class="grid g-2e" style="margin-top:14px">
        <div class="card"><div class="card-h"><h2>Latest reads</h2><span class="small muted" id="readCount"></span></div><div class="tbl-wrap" id="readTbl" style="max-height:440px;overflow:auto"></div></div>
        <div class="card"><div class="card-h"><h2>Zone moves</h2><span class="small muted">Latest first</span></div><div class="tbl-wrap" id="moveTbl" style="max-height:440px;overflow:auto"></div></div>
      </div>`;
    },
    mount() {
      $('#impReader').onchange = e => { UI.importReader = e.target.value; };
      $('#impReads').onchange = e => readFile(e.target.files[0], txt => importReads(txt, e.target.files[0].name));
      $('#impSales').onchange = e => readFile(e.target.files[0], txt => importSales(txt));
      $('#backSim').onclick = () => {
        DATA = { source: 'sim', reads: sim.reads, sales: sim.sales, tags: sim.tags, start: CFG.store.open - 600, end: CFG.store.close + 600 };
        T = 15 * 3600 + 42 * 60; playing = true; rebuild(); syncBar(); render(); toast('Simulated day loaded');
      };
    },
    update(S) {
      $('#srcInfo').textContent = DATA.source === 'sim' ? 'Showing the simulated day' : `Showing ${DATA.name}`;
      const antZone = id => { const a = CFG.antennas.find(a => a.id === id); return a ? zoneName(a.zone) : 'unknown antenna'; };
      const rec = ENG.state.recent.slice(-80).reverse();
      $('#readCount').textContent = `${nf(S.kpis.readsTotal)} reads so far`;
      $('#readTbl').innerHTML = `<table><thead><tr><th>Time</th><th>EPC</th><th>Antenna</th><th>Zone</th><th class="r">RSSI</th></tr></thead><tbody>${rec.map(r =>
        `<tr><td class="mono">${fmtS(r.t)}</td><td class="mono">${esc(r.epc)}</td><td class="mono">${esc(r.ant)}</td><td>${esc(antZone(r.ant))}</td><td class="r mono">${r.rssi} <span class="rssi"><i style="width:${clamp((r.rssi + 80) / 45, 0.05, 1) * 100}%"></i></span></td></tr>`).join('')}</tbody></table>`;
      const mv = ENG.state.movements.slice(-80).reverse();
      $('#moveTbl').innerHTML = mv.length ? `<table><thead><tr><th>Time</th><th>Item</th><th>From</th><th>To</th></tr></thead><tbody>${mv.map(m => {
        const it = ENG.item(m.epc); const c = catBySku.get(it.sku) || { name: it.sku };
        return `<tr><td class="mono">${fmtS(m.t)}</td><td>${esc(c.name)} ${esc(it.size)}</td><td>${esc(zoneName(m.from))}</td><td>${esc(zoneName(m.to))}</td></tr>`;
      }).join('')}</tbody></table>` : '<div class="empty">No moves yet.</div>';
      const pe = ENG.state.portalEvents.slice(-60).reverse();
      $('#portalTbl').innerHTML = pe.length ? `<table><thead><tr><th>Time</th><th>Door</th><th>Direction</th><th>Item</th><th></th></tr></thead><tbody>${pe.map(e => {
        const p = CFG.portals.find(p => p.id === e.portal); const it = ENG.item(e.epc); const c = catBySku.get(it.sku) || { name: it.sku };
        return `<tr><td class="mono">${fmtS(e.t)}</td><td>${esc(p ? p.name : e.portal)}</td><td>${esc(p ? (e.dir === 'out' ? p.outLabel : p.inLabel) : e.dir)}</td><td>${esc(c.name)} ${esc(it.size)}</td><td>${e.unpaid ? '<span class="pill bad">Unpaid</span>' : (e.portal === 'entrance' && e.dir === 'out' ? '<span class="pill ok">Paid</span>' : '')}</td></tr>`;
      }).join('')}</tbody></table>` : '<div class="empty">No crossings yet.</div>';
    }
  };

  /* ---------- import ---------- */
  function readFile(file, cb) {
    if (!file) return;
    const fr = new FileReader();
    fr.onload = () => cb(String(fr.result));
    fr.onerror = () => msg('The file could not be read. Try saving it again as CSV (UTF-8).', true);
    fr.readAsText(file);
  }
  function msg(text, bad) { const m = $('#impMsg'); if (m) { m.innerHTML = `<p style="margin:8px 0 0;color:${bad ? 'var(--p1)' : 'var(--ok)'}">${esc(text)}</p>`; } }
  function parseCSV(txt) {
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < txt.length; i++) {
      const ch = txt[i];
      if (q) { if (ch === '"') { if (txt[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; continue; }
      if (ch === '"') q = true;
      else if (ch === ',' || ch === '\t' || ch === ';') { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && txt[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += ch;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows.filter(r => r.some(c => c.trim() !== ''));
  }
  function toSec(v) {
    if (v == null || v === '') return NaN;
    const s = String(v).trim();
    if (/^\d+(\.\d+)?$/.test(s)) {
      const n = parseFloat(s);
      if (n > 1e11) return secOfDay(new Date(n));
      if (n > 1e8) return secOfDay(new Date(n * 1000));
      return n;
    }
    const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?$/);
    if (m) return +m[1] * 3600 + +m[2] * 60 + (m[3] ? parseFloat(m[3]) : 0);
    const d = new Date(s);
    return isNaN(d) ? NaN : secOfDay(d);
  }
  function secOfDay(d) { return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds() + d.getMilliseconds() / 1000; }
  function antennaFor(ant, reader, port) {
    if (ant && CFG.antennas.some(a => a.id === ant)) return ant;
    const p = parseInt(port != null && port !== '' ? port : ant, 10);
    const r = reader && CFG.readers.some(x => x.id === reader) ? reader : UI.importReader;
    const a = CFG.antennas.find(a => a.reader === r && a.port === p);
    return a ? a.id : null;
  }
  function importReads(txt, name) {
    const reads = [], tags = new Map();
    let skipped = 0;
    const t = txt.trim();
    if (t[0] === '[' || t[0] === '{') {
      let evs = [];
      try { evs = t[0] === '[' ? JSON.parse(t) : t.split(/\r?\n/).filter(Boolean).map(l => JSON.parse(l)); }
      catch (e) { msg('The JSON could not be parsed. Use one tag event per line, or one JSON array.', true); return; }
      evs.forEach(ev => {
        const d = ev.data || ev;
        const ant = antennaFor(null, ev.hostName, d.antenna);
        const sec = toSec(ev.timestamp || d.timestamp);
        const epc = d.idHex || d.epc;
        const rssi = d.peakRssi != null ? +d.peakRssi : +d.rssi;
        if (!ant || !epc || isNaN(sec) || isNaN(rssi)) { skipped++; return; }
        reads.push({ t: sec, epc: String(epc).toUpperCase(), ant, rssi });
      });
    } else {
      const rows = parseCSV(txt);
      if (rows.length < 2) { msg('The file has no data rows.', true); return; }
      const head = rows[0].map(h => h.trim().toLowerCase().replace(/[^a-z]/g, ''));
      const col = names => head.findIndex(h => names.includes(h));
      const ci = { t: col(['timestamp', 'time', 't', 'datetime', 'readtime']), epc: col(['epc', 'idhex', 'tag', 'tagid']), ant: col(['antenna', 'ant', 'antennaid']), reader: col(['reader', 'hostname', 'readerid']), port: col(['port', 'antennaport']), rssi: col(['rssi', 'peakrssi']), sku: col(['sku', 'style']), size: col(['size']) };
      if (ci.t < 0 || ci.epc < 0 || ci.rssi < 0 || (ci.ant < 0 && ci.port < 0)) { msg('Missing columns. The file needs timestamp, epc, rssi and antenna (or reader and port).', true); return; }
      rows.slice(1).forEach(r => {
        const ant = antennaFor(ci.ant >= 0 ? r[ci.ant].trim() : null, ci.reader >= 0 ? r[ci.reader].trim() : null, ci.port >= 0 ? r[ci.port].trim() : null);
        const sec = toSec(r[ci.t]);
        const epc = (r[ci.epc] || '').trim().toUpperCase();
        const rssi = parseFloat(r[ci.rssi]);
        if (!ant || !epc || isNaN(sec) || isNaN(rssi)) { skipped++; return; }
        reads.push({ t: sec, epc, ant, rssi });
        if (ci.sku >= 0 && r[ci.sku]) tags.set(epc, { epc, sku: r[ci.sku].trim(), size: ci.size >= 0 ? (r[ci.size] || '').trim() : '?' });
      });
    }
    if (!reads.length) { msg(`No usable reads. ${skipped} rows skipped: check the antenna IDs or reader/port match the Zones & antennas page.`, true); return; }
    reads.sort((a, b) => a.t - b.t);
    DATA = { source: 'import', name, reads, sales: [], tags: Array.from(tags.values()), start: Math.floor(reads[0].t) - 60, end: Math.ceil(reads[reads.length - 1].t) + 60 };
    T = DATA.end; playing = false; rebuild(); syncBar(); render();
    msg(`Loaded ${nf(reads.length)} reads from ${name}${skipped ? `, skipped ${skipped}` : ''}. ${nf(new Set(reads.map(r => r.epc)).size)} tags.`);
  }
  function importSales(txt) {
    const rows = parseCSV(txt);
    if (rows.length < 2) { msg('The sales file has no data rows.', true); return; }
    const head = rows[0].map(h => h.trim().toLowerCase().replace(/[^a-z]/g, ''));
    const col = names => head.findIndex(h => names.includes(h));
    const ci = { t: col(['timestamp', 'time', 't', 'datetime']), epc: col(['epc', 'idhex', 'tag']), sku: col(['sku', 'style']), size: col(['size']), price: col(['price', 'amount']) };
    if (ci.t < 0 || ci.epc < 0) { msg('The sales file needs timestamp and epc columns.', true); return; }
    const sales = rows.slice(1).map(r => ({ t: toSec(r[ci.t]), epc: (r[ci.epc] || '').trim().toUpperCase(), sku: ci.sku >= 0 ? r[ci.sku].trim() : undefined, size: ci.size >= 0 ? r[ci.size].trim() : undefined, price: ci.price >= 0 ? parseFloat(r[ci.price]) || 0 : 0 })).filter(s => !isNaN(s.t) && s.epc);
    sales.sort((a, b) => a.t - b.t);
    DATA = Object.assign({}, DATA, { sales });
    rebuild(); render();
    msg(`Loaded ${nf(sales.length)} sales.`);
  }

  /* ---------- helpers ---------- */
  let toastTimer = null;
  function toast(text) {
    let el = document.querySelector('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = text;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), 2200);
  }
  function copyText(text, done) {
    const fallback = () => {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast(done); } catch (e) { toast('Copy is blocked here. Use Download CSV.'); }
      ta.remove();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(() => toast(done), fallback);
    else fallback();
  }
  function download(name, text) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  /* ---------- shell, routing, clock ---------- */
  function renderTabs() {
    const S = snap();
    const p1 = S.alerts.filter(a => a.prio === 'P1').length;
    $('#tabs').innerHTML = VIEWS.map(([id, label]) => `<a href="#${id}"${UI.view === id ? ' aria-current="page"' : ''}>${label}${id === 'dashboard' && p1 ? `<span class="count" title="P1 alerts">${p1}</span>` : ''}</a>`).join('');
  }
  function render() {
    renderTabs();
    $('#main').innerHTML = views[UI.view].shell();
    views[UI.view].mount();
    views[UI.view].update(snap());
    lastUpdate = Date.now();
  }
  let lastUpdate = 0;
  function refresh(force) {
    if (!force && Date.now() - lastUpdate < (UI.view === 'dashboard' || UI.view === 'reads' ? 1000 : 4000)) return;
    lastUpdate = Date.now();
    const zp = document.activeElement;
    views[UI.view].update(snap());
    renderTabs();
    if (zp && zp.id && document.getElementById(zp.id) && document.activeElement !== document.getElementById(zp.id)) document.getElementById(zp.id).focus();
  }
  function syncBar() {
    $('#clock').textContent = fmt(T);
    const sl = $('#slider');
    sl.min = DATA.start; sl.max = DATA.end;
    if (document.activeElement !== sl) sl.value = T;
    $('#play').textContent = playing ? 'Pause' : (T >= DATA.end ? 'Restart' : 'Play');
    $('#srcBadge').textContent = DATA.source === 'sim' ? 'Simulated day' : 'Imported reads';
  }
  function route() {
    const h = (location.hash || '').slice(1);
    UI.view = views[h] ? h : 'dashboard';
    render();
    window.scrollTo(0, 0);
  }

  $('#play').onclick = () => {
    if (!playing && T >= DATA.end) { setTime(DATA.start); }
    playing = !playing; syncBar();
  };
  $('#speed').onchange = e => { speed = +e.target.value; };
  $('#slider').oninput = e => { setTime(+e.target.value); syncBar(); refresh(true); };
  window.addEventListener('hashchange', route);

  let lastTick = performance.now();
  setInterval(() => {
    const now = performance.now();
    const dt = (now - lastTick) / 1000; lastTick = now;
    if (playing) {
      const nt = Math.min(DATA.end, T + dt * speed);
      setTime(nt);
      if (T >= DATA.end) playing = false;
      syncBar();
      refresh(false);
    }
  }, 250);

  $('#storeName').textContent = CFG.store.name;
  $('#foot').innerHTML = 'Location is by zone, from the antenna that reads each tag best. There is no X/Y path. The simulated day uses illustrative products and figures.';
  rebuild();
  syncBar();
  route();
})();
