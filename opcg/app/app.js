/* OPCG collection app (UI). Logic lives in engine.js. */
(function () {
  'use strict';
  const E = window.OPCGEngine;
  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ------------------------------------------------------------ data
  const CARDS = (window.OPCG_CARDS && window.OPCG_CARDS.cards) || [];
  const META = (window.OPCG_DECKS && window.OPCG_DECKS.decks) || [];
  const PRICES = window.OPCG_PRICES || { prices: {} };
  const DEFAULT_RATE = 0.049; // JPY -> HKD (mid-Aug 2026); the price bot refreshes it
  const byId = {};
  for (const c of CARDS) byId[c.id] = c;
  const variantsOf = {};
  for (const c of CARDS) (variantsOf[E.baseId(c.id)] = variantsOf[E.baseId(c.id)] || []).push(c.id);

  const SETS = Array.from(new Set(CARDS.map(c => c.set || E.setOf(c.id)).filter(Boolean))).sort(setSort);
  function setSort(a, b) {
    const rank = s => ({ OP: 0, EB: 1, PRB: 2, ST: 3, P: 4 }[s.replace(/\d+/g, '')] ?? 5);
    return rank(a) - rank(b) || b.localeCompare(a, 'en', { numeric: true });
  }

  const COLOR_HEX = { '紅': 'red', '红': 'red', Red: 'red', '綠': 'green', '绿': 'green', Green: 'green', '藍': 'blue', '蓝': 'blue', Blue: 'blue',
    '紫': 'purple', Purple: 'purple', '黑': 'black', Black: 'black', '黃': 'yellow', '黄': 'yellow', Yellow: 'yellow' };
  const COLORS = Array.from(new Set(CARDS.flatMap(c => E.cardColors(c)))).filter(Boolean);
  const CATS = { LEADER: '領航', CHARACTER: '角色', EVENT: '事件', STAGE: '場地' };
  const RARITIES = Array.from(new Set(CARDS.map(c => c.rarity).filter(Boolean)));

  // ----------------------------------------------------------- state
  const LS_KEY = 'opcg-state-v1';
  const serverMode = location.protocol.startsWith('http');
  let state = blankState();
  let saveTimer = null;

  function blankState() {
    return { version: 1, owned: {}, decks: [], manualPrices: {}, openLog: [],
      settings: { includeParallels: false, quickSet: '', rate: '', factor: 1, valuableMin: 50 } };
  }
  function normalise(s) {
    const b = blankState();
    s = s && typeof s === 'object' ? s : {};
    return {
      version: 1,
      owned: s.owned && typeof s.owned === 'object' ? s.owned : {},
      decks: Array.isArray(s.decks) ? s.decks : [],
      manualPrices: s.manualPrices && typeof s.manualPrices === 'object' ? s.manualPrices : {},
      settings: Object.assign(b.settings, s.settings || {}),
      openLog: Array.isArray(s.openLog) ? s.openLog.slice(0, 200) : [],
      savedAt: s.savedAt,
      rev: s.rev,
    };
  }
  function readLocal() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch (e) { return null; }
  }
  async function fetchServerState() {
    const r = await fetch('/api/state', { cache: 'no-store' });
    if (r.status === 401) { location.reload(); throw new Error('login'); }
    const j = await r.json();
    if (!j.ok) throw new Error('server');
    return j.state;
  }
  async function load() {
    const local = readLocal();
    if (serverMode) {
      try {
        const srv = await fetchServerState();
        // The file on the computer is the master copy; the browser copy is only used if the file is empty.
        state = normalise(srv || local);
        if (!srv) state.rev = 0;
        setSaveLabel('已連接本機伺服器 · 資料存喺 opcg/data/collection.json');
        return;
      } catch (e) { /* not running serve.py: fall back to the browser */ }
    }
    serverOk = false;
    state = normalise(local);
    setSaveLabel('資料存喺瀏覽器 (記得喺設定匯出備份)');
  }
  let saving = false, dirty = false, serverOk = serverMode;
  function save() {
    state.savedAt = new Date().toISOString();
    try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { /* storage full or blocked */ }
    if (!serverOk) return;
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 400);
  }
  // One request at a time, so each save carries the revision the server last gave us.
  async function flush() {
    if (saving || !dirty) return;
    saving = true; dirty = false;
    try {
      const r = await fetch('/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) });
      const j = await r.json().catch(() => ({}));
      if (r.status === 409 && j.state) {
        state = normalise(j.state);
        try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
        dirty = false;
        toast('另一部機啱啱改咗資料，已載入最新版本，請再做一次最後嗰個改動');
        render();
      } else if (r.ok && j.ok) {
        state.rev = j.rev;
        try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
        setSaveLabel('已儲存 ' + new Date().toLocaleTimeString());
      } else {
        setSaveLabel('儲存失敗 (伺服器)');
        dirty = true;
      }
    } catch (e) {
      setSaveLabel('儲存失敗：伺服器未開？資料仍喺瀏覽器');
      dirty = true;
    } finally {
      saving = false;
      if (dirty) saveTimer = setTimeout(flush, 1500);
    }
  }
  // Coming back to the tab (e.g. on the phone): pick up changes made on the other device.
  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState !== 'visible' || !serverOk || dirty || saving) return;
    try {
      const srv = await fetchServerState();
      if (srv && (srv.rev || 0) > (state.rev || 0)) { state = normalise(srv); render(); toast('已同步最新資料'); }
    } catch (e) { /* offline */ }
  });
  function setSaveLabel(t) { $('#save-state').textContent = t; }

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('on');
    clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 2200);
  }

  // ------------------------------------------------------- helpers
  const settings = () => state.settings;
  const available = excludeId => E.availableTotals(state, excludeId);
  const ownedOf = id => state.owned[id] || 0;
  function setOwned(id, n) {
    n = Math.max(0, n | 0);
    if (n) state.owned[id] = n; else delete state.owned[id];
    save();
  }
  function rate() { return Number(settings().rate) || PRICES.jpyToHkd || DEFAULT_RATE; }
  function pricer() {
    return E.makePricer({ manual: state.manualPrices, bot: PRICES.prices, rate: rate(), factor: Number(settings().factor) || 1 });
  }
  function hk(n) {
    if (n == null || n === '' || isNaN(n)) return '—';
    const v = Math.round(Number(n) * 10) / 10;
    return (v < 0 ? '−' : '') + 'HK$' + Math.abs(v).toLocaleString();
  }
  function changeHtml(ch) {
    if (!ch || !ch.from) return '';
    const pct = (ch.to - ch.from) / ch.from * 100;
    if (Math.abs(pct) < 0.5) return '<span class="muted">±0%</span>';
    return `<span class="${pct > 0 ? 'ok' : 'bad'}" title="由 ${esc(ch.since)} ${hk(ch.from)}">${pct > 0 ? '▲' : '▼'}${Math.abs(pct).toFixed(0)}%</span>`;
  }
  function setManualPrice(id, value) {
    const today = new Date().toISOString().slice(0, 10);
    if (value === '' || value == null || isNaN(Number(value))) { delete state.manualPrices[id]; save(); return; }
    const m = state.manualPrices[id] || { history: [] };
    m.hkd = Number(value); m.at = today;
    m.history = (m.history || []).filter(h => h[0] !== today).concat([[today, m.hkd]]).slice(-180);
    state.manualPrices[id] = m;
    save();
  }
  function shopUrl(id) {
    const p = PRICES.prices[id];
    return (p && p.url) || 'https://yuyu-tei.jp/sell/opc/s/search?search_word=' + encodeURIComponent(E.baseId(id));
  }
  function cardName(id) { const c = byId[id] || byId[E.baseId(id)]; return c ? c.name : ''; }
  function imgSrc(id) {
    const c = byId[id] || byId[E.baseId(id)];
    if (!c) return '';
    return c.localImage || c.image || '';
  }
  function imgTag(id, cls) {
    const c = byId[id] || byId[E.baseId(id)];
    const src = imgSrc(id);
    const remote = c && c.localImage && c.image ? c.image : '';
    const ph = `<span class="ph">${esc(id)}</span>`;
    if (!src) return ph;
    return `${ph}<img loading="lazy" alt="${esc(id + ' ' + (c ? c.name : ''))}" src="${esc(src)}"${remote ? ` data-remote="${esc(remote)}"` : ''} class="${cls || ''}">`;
  }
  // Fall back to the official image when a local copy is missing; hide broken images.
  document.addEventListener('error', ev => {
    const img = ev.target;
    if (!(img instanceof HTMLImageElement)) return;
    if (img.dataset.remote && img.src !== img.dataset.remote) { img.src = img.dataset.remote; return; }
    img.style.display = 'none';
  }, true);

  function dots(card) {
    return `<span class="dots">${E.cardColors(card || {}).map(c => `<i class="dot" title="${esc(c)}" style="background:var(--${COLOR_HEX[c] || 'muted'})"></i>`).join('')}</span>`;
  }
  function barClass(p) { return p >= 0.999 ? '' : p >= 0.8 ? 'mid' : 'low'; }
  function uid() { return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function noDataNotice(what) {
    return `<div class="notice"><b>未有${what}資料。</b> 喺電腦行 BOT：
      <pre>python3 opcg/bot/scrape_cards.py --images\npython3 opcg/bot/scrape_decks.py</pre>
      或者行 <code>python3 opcg/serve.py</code>，打開 http://localhost:8765，喺「設定」撳「更新」。</div>`;
  }

  // ------------------------------------------------------------- tabs
  let current = 'collection';
  function showTab(name) {
    current = name;
    $$('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === name));
    $$('.tab').forEach(s => s.classList.toggle('on', s.id === 'tab-' + name));
    render();
    try { localStorage.setItem('opcg-tab', name); } catch (e) { /* ignore */ }
  }
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) showTab(b.dataset.tab); });
  function render() {
    ({ collection: renderCollection, open: renderOpen, meta: renderMeta, mine: renderMine, value: renderValue, settings: renderSettings })[current]();
  }

  // ======================================================== COLLECTION
  const cf = { q: '', set: '', color: '', cat: '', rarity: '', owned: '', sort: 'id', limit: 120 };
  function collectionItems() {
    const ids = new Set(CARDS.map(c => c.id));
    for (const id of Object.keys(state.owned)) ids.add(id);
    const q = cf.q.trim().toLowerCase();
    const reserved = E.reservedTotals(state.decks);
    let list = Array.from(ids).map(id => byId[id] || { id, name: '', set: E.setOf(id), colors: [], unknown: true });
    list = list.filter(c => {
      if (cf.set && (c.set || E.setOf(c.id)) !== cf.set && !(c.series || []).some(s => s.code === cf.set)) return false;
      if (cf.color && !E.cardColors(c).includes(cf.color)) return false;
      if (cf.cat && c.category !== cf.cat) return false;
      if (cf.rarity && c.rarity !== cf.rarity) return false;
      if (cf.owned === 'have' && !ownedOf(c.id)) return false;
      if (cf.owned === 'none' && ownedOf(c.id)) return false;
      if (cf.owned === 'spare' && !(ownedOf(c.id) > 4)) return false;
      if (cf.owned === 'reserved' && !reserved[E.baseId(c.id)]) return false;
      if (q && !(c.id.toLowerCase().includes(q) || (c.name || '').toLowerCase().includes(q) ||
        (c.feature || '').toLowerCase().includes(q) || (c.text || '').toLowerCase().includes(q))) return false;
      return true;
    });
    const cmpId = (a, b) => a.id.localeCompare(b.id, 'en', { numeric: true });
    if (cf.sort === 'owned') list.sort((a, b) => ownedOf(b.id) - ownedOf(a.id) || cmpId(a, b));
    else if (cf.sort === 'cost') list.sort((a, b) => (a.cost ?? -1) - (b.cost ?? -1) || cmpId(a, b));
    else if (cf.sort === 'price') { const pr = pricer(); const v = c => (pr(c.id) || { hkd: -1 }).hkd; list.sort((a, b) => v(b) - v(a) || cmpId(a, b)); }
    else list.sort(cmpId);
    return list;
  }
  function renderCollection() {
    const el = $('#tab-collection');
    if (!el.dataset.ready) {
      const opt = (v, l) => `<option value="${esc(v)}">${esc(l)}</option>`;
      el.innerHTML = `
        ${CARDS.length ? '' : noDataNotice('咭表')}
        <div class="toolbar">
          <input type="search" id="cf-q" placeholder="搜尋 編號 / 名 / 特徵 / 效果">
          <button class="filter-toggle" id="cf-ft">篩選</button>
          <div class="filters">
          <select id="cf-set"><option value="">全部系列</option>${SETS.map(s => opt(s, s)).join('')}</select>
          <select id="cf-color"><option value="">全部顏色</option>${COLORS.map(c => opt(c, c)).join('')}</select>
          <select id="cf-cat"><option value="">全部類別</option>${Object.entries(CATS).map(([k, v]) => opt(k, v)).join('')}</select>
          <select id="cf-rarity"><option value="">全部稀有度</option>${RARITIES.map(r => opt(r, r)).join('')}</select>
          <select id="cf-owned"><option value="">全部</option><option value="have">我有嘅</option><option value="none">未有</option><option value="spare">多過 4 張</option><option value="reserved">已預留畀 Deck</option></select>
          <select id="cf-sort"><option value="id">按編號</option><option value="owned">按數量</option><option value="cost">按費用</option><option value="price">按價錢</option></select>
          </div>
        </div>
        <div class="stats" id="cf-stats"></div>
        <div class="grid" id="cf-grid"></div>
        <button class="more" id="cf-more">顯示更多</button>`;
      el.dataset.ready = '1';
      if (!cf.set && SETS.includes(settings().quickSet)) cf.set = settings().quickSet;
      for (const k of ['q', 'set', 'color', 'cat', 'rarity', 'owned', 'sort']) {
        const input = $('#cf-' + k);
        input.value = cf[k];
        input.addEventListener(k === 'q' ? 'input' : 'change', () => { cf[k] = input.value; cf.limit = 120; drawGrid(); });
      }
      $('#cf-more').addEventListener('click', () => { cf.limit += 240; drawGrid(); });
      $('#cf-ft').addEventListener('click', () => el.querySelector('.toolbar').classList.toggle('show-filters'));
      $('#cf-grid').addEventListener('click', onGridClick);
    }
    drawGrid();
  }
  function drawGrid() {
    const list = collectionItems();
    const reserved = E.reservedTotals(state.decks);
    const totalCopies = Object.values(state.owned).reduce((s, n) => s + n, 0);
    const distinct = Object.keys(state.owned).length;
    $('#cf-stats').innerHTML = `<span>總共 <b>${totalCopies}</b> 張 · <b>${distinct}</b> 款</span>
      <span>符合篩選 <b>${list.length}</b> 款</span>
      <span>預留畀已砌 Deck <b>${Object.values(reserved).reduce((s, n) => s + n, 0)}</b> 張</span>`;
    const price = pricer();
    $('#cf-grid').innerHTML = list.slice(0, cf.limit).map(c => tileHtml(c, reserved, price)).join('');
    $('#cf-more').style.display = list.length > cf.limit ? '' : 'none';
  }
  function tileHtml(c, reserved, price) {
    const n = ownedOf(c.id);
    const p = (price || pricer())(c.id);
    const r = c.id === E.baseId(c.id) ? reserved[c.id] || 0 : 0;
    return `<div class="tile${n ? ' has' : ''}" data-id="${esc(c.id)}">
      <div class="img" data-act="detail">${imgTag(c.id)}</div>
      <div class="meta">${esc(c.id)} <span class="muted">${esc(c.rarity || '')}</span> ${dots(c)}</div>
      <div class="meta name" title="${esc(c.name)}">${esc(c.name || (c.unknown ? '(咭表冇資料)' : ''))}</div>
      <div class="sub">${p ? `<b class="price">${hk(p.hkd)}</b> ${changeHtml(p.change)} ` : ''}${r ? `預留 ${r} · 可用 ${Math.max(0, n - r)}` : ''}</div>
      <div class="qty"><button data-act="dec" aria-label="減一">−</button><span class="n${n ? '' : ' zero'}">${n}</span><button data-act="inc" aria-label="加一">+</button></div>
    </div>`;
  }
  function onGridClick(e) {
    const btn = e.target.closest('[data-act]');
    const tile = e.target.closest('.tile');
    if (!btn || !tile) return;
    const id = tile.dataset.id;
    if (btn.dataset.act === 'detail') return showDetail(id);
    setOwned(id, ownedOf(id) + (btn.dataset.act === 'inc' ? 1 : -1));
    tile.outerHTML = tileHtml(byId[id] || { id, unknown: true }, E.reservedTotals(state.decks));
    const totalCopies = Object.values(state.owned).reduce((s, n) => s + n, 0);
    const b = $('#cf-stats b'); if (b) b.textContent = totalCopies;
  }

  function showDetail(id) {
    const c = byId[id] || { id };
    const base = E.baseId(id);
    const usedIn = state.decks.filter(d => d.status !== 'sold' && d.entries.some(e => e.id === base));
    const vars = Array.from(new Set((variantsOf[base] || [id]).concat(Object.keys(state.owned).filter(k => E.baseId(k) === base))));
    const price = pricer();
    const field = (k, v) => v || v === 0 ? `<dt>${k}</dt><dd>${esc(v)}</dd>` : '';
    $('#modal-body').innerHTML = `<div class="detail">
      <div>${imgSrc(id) ? `<img src="${esc(imgSrc(id))}" alt="${esc(c.name || id)}">` : ''}</div>
      <div>
        <h2 style="margin-top:0">${esc(c.name || id)}</h2>
        <dl>
          ${field('編號', id)}${field('稀有度', c.rarity)}${field('類別', CATS[c.category] || c.categoryRaw || c.category)}
          ${field('生命', c.life)}${field('費用', c.cost)}${field('力量', c.power)}${field('反擊', c.counter)}
          ${field('顏色', c.color)}${field('屬性', c.attribute)}${field('特徵', c.feature)}
          ${field('效果', c.text)}${field('觸發', c.trigger)}${field('收錄', c.getInfo)}
        </dl>
        <h3>我有</h3>
        <table class="list"><tr><th>版本</th><th>數量</th><th>價錢</th></tr>${vars.map(v => { const p = price(v); return `<tr><td>${esc(v)}${v === base ? '' : ' <span class="muted">(平行/異圖)</span>'}</td>
          <td style="white-space:nowrap"><button class="small" data-d="${esc(v)}" data-n="-1">−</button> <b>${ownedOf(v)}</b> <button class="small" data-d="${esc(v)}" data-n="1">+</button></td>
          <td>${p ? `${hk(p.hkd)} ${changeHtml(p.change)}<br><span class="muted">${p.source === 'manual' ? '手動' : '悠々亭 ¥' + Number(p.jpy).toLocaleString()}</span>` : '<span class="muted">未有</span>'}
            <br><input class="mp" data-mp="${esc(v)}" type="number" min="0" step="1" placeholder="手動價 HK$" value="${esc((state.manualPrices[v] || {}).hkd ?? '')}" style="width:110px">
            <a href="${esc(shopUrl(v))}" target="_blank" rel="noopener">悠々亭</a></td></tr>`; }).join('')}</table>
        ${usedIn.length ? `<h3>用喺</h3><ul>${usedIn.map(d => `<li>${esc(d.name)} (${d.entries.find(e => e.id === base).count} 張, ${statusLabel(d.status)})</li>`).join('')}</ul>` : ''}
      </div></div>`;
    $('#modal-body').onchange = e => {
      const m = e.target.closest('[data-mp]');
      if (!m) return;
      setManualPrice(m.dataset.mp, m.value);
      showDetail(id);
      render();
    };
    $('#modal-body').onclick = e => {
      const b = e.target.closest('[data-d]');
      if (!b) return;
      setOwned(b.dataset.d, ownedOf(b.dataset.d) + Number(b.dataset.n));
      showDetail(id);
      if (current === 'collection') drawGrid();
    };
    const dlg = $('#modal');
    if (!dlg.open) dlg.showModal();
  }

  // ============================================================== OPEN
  function renderOpen() {
    const el = $('#tab-open');
    const set = settings().quickSet || SETS.find(s => /^OP/.test(s)) || '';
    el.innerHTML = `
      <div class="cols">
        <div class="panel quick">
          <h2>開箱快速輸入</h2>
          <div class="toolbar">
            <label>預設系列 <select id="q-set"><option value="">(冇)</option>${SETS.map(s => `<option${s === set ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
            <span class="muted">輸入咭號後撳 Enter：<code>OP08-001</code>、<code>08-001</code>、或者只打 <code>1</code> / <code>001p1</code>（用預設系列）</span>
          </div>
          <input id="q-input" autocomplete="off" inputmode="text" placeholder="例如 045 或 OP09-118">
          <div id="q-preview" class="muted" style="min-height:22px;margin-top:6px"></div>
          <ul class="log" id="q-log"></ul>
        </div>
        <div class="panel">
          <h2>一次過加入</h2>
          <p class="muted">每行一款：<code>OP08-001 x2</code>、<code>3 OP09-045</code>、<code>OP08-118_p1</code>。平行/異圖會分開記。</p>
          <textarea id="bulk" placeholder="OP08-001 x2&#10;OP08-045 x3"></textarea>
          <div class="actions" style="margin-top:8px"><button class="primary" id="bulk-add">加入咭庫</button><button id="bulk-sub">從咭庫減去</button></div>
        </div>
      </div>`;
    const input = $('#q-input');
    const setSel = $('#q-set');
    setSel.addEventListener('change', () => { settings().quickSet = setSel.value; save(); });
    const preview = () => {
      const id = E.quickId(input.value, setSel.value);
      $('#q-preview').innerHTML = id ? `${esc(id)} ${esc(cardName(id))} <span class="${byId[id] ? 'ok' : 'warn'}">${byId[id] ? '' : (CARDS.length ? '(咭表搵唔到，照樣可以加)' : '')}</span> · 而家有 ${ownedOf(id)} 張` : '';
    };
    input.addEventListener('input', preview);
    input.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      const id = E.quickId(input.value, setSel.value);
      if (!id) { toast('睇唔明呢個咭號'); return; }
      setOwned(id, ownedOf(id) + 1);
      state.openLog.unshift({ id, at: Date.now() });
      state.openLog = state.openLog.slice(0, 200);
      save();
      input.value = ''; preview(); drawLog();
    });
    $('#q-log').addEventListener('click', e => {
      const b = e.target.closest('[data-undo]');
      if (!b) return;
      const i = Number(b.dataset.undo);
      const item = state.openLog[i];
      if (!item) return;
      setOwned(item.id, ownedOf(item.id) - 1);
      state.openLog.splice(i, 1); save(); drawLog();
    });
    const bulk = sign => {
      const { entries, unknown } = E.parseDeckText($('#bulk').value, { keepVariants: true });
      for (const e of entries) setOwned(e.id, ownedOf(e.id) + sign * e.count);
      toast(`${sign > 0 ? '加入' : '減去'} ${entries.reduce((s, e) => s + e.count, 0)} 張` + (unknown.length ? `，${unknown.length} 行睇唔明` : ''));
      if (!unknown.length) $('#bulk').value = ''; else $('#bulk').value = unknown.join('\n');
    };
    $('#bulk-add').addEventListener('click', () => bulk(1));
    $('#bulk-sub').addEventListener('click', () => bulk(-1));
    drawLog();
    setTimeout(() => input.focus(), 0);
  }
  function drawLog() {
    const today = new Date().toDateString();
    const todayCount = state.openLog.filter(x => new Date(x.at).toDateString() === today).length;
    $('#q-log').innerHTML = `<li class="muted">今日入咗 ${todayCount} 張</li>` + state.openLog.slice(0, 60).map((x, i) =>
      `<li><div class="thumb">${imgTag(x.id)}</div><div class="grow"><b>${esc(x.id)}</b> ${esc(cardName(x.id))}<br><span class="muted">而家 ${ownedOf(x.id)} 張 · ${new Date(x.at).toLocaleTimeString()}</span></div><button class="small" data-undo="${i}">撤銷</button></li>`).join('');
  }

  // ============================================================== META
  const mf = { q: '', color: '', sort: 'pct', limit: 60, open: {} };
  function renderMeta() {
    const el = $('#tab-meta');
    if (!META.length) {
      el.innerHTML = noDataNotice('Deck list') + importPanelHtml();
      bindImport();
      return;
    }
    const src = window.OPCG_DECKS;
    el.innerHTML = `
      <div class="toolbar">
        <input type="search" id="mf-q" placeholder="搜尋 Deck / 領航 / 作者 / 比賽">
        <select id="mf-color"><option value="">全部顏色</option>${COLORS.map(c => `<option>${esc(c)}</option>`).join('')}</select>
        <select id="mf-sort"><option value="pct">我最夠咭先</option><option value="missing">差最少張先</option><option value="fill">補咭最平先</option><option value="value">市值最高先</option><option value="date">最新先</option></select>
      </div>
      <div class="stats"><span>${META.length} 副 Deck · 來源 <a href="${esc(src.source)}" target="_blank" rel="noopener">${esc(src.source)}</a> · 更新 ${esc((src.scrapedAt || '').slice(0, 10))}</span></div>
      <div class="decks" id="mf-list"></div>
      <button class="more" id="mf-more">顯示更多</button>
      ${importPanelHtml()}`;
    for (const k of ['q', 'color', 'sort']) {
      const input = $('#mf-' + k);
      input.value = mf[k];
      input.addEventListener(k === 'q' ? 'input' : 'change', () => { mf[k] = input.value; mf.limit = 60; drawMeta(); });
    }
    $('#mf-more').addEventListener('click', () => { mf.limit += 60; drawMeta(); });
    $('#mf-list').addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const d = META.find(x => x.id === b.dataset.id);
      if (b.dataset.act === 'toggle') { mf.open[d.id] = !mf.open[d.id]; drawMeta(); }
      if (b.dataset.act === 'copy') addMyDeck(d.name || 'Meta deck', d.entries, { from: d.url, meta: d.id });
      if (b.dataset.act === 'text') copyText(E.deckToText(d.entries, byId));
    });
    bindImport();
    drawMeta();
  }
  function drawMeta() {
    const avail = available();
    const price = pricer();
    const q = mf.q.trim().toLowerCase();
    let list = META.map(d => {
      const lead = d.leader || E.leaderOf(d.entries, byId);
      const main = d.entries.filter(e => e.id !== lead);
      const st = E.deckStatus(d.entries, avail);
      return Object.assign({}, d, { lead, st, mainCount: main.reduce((s, e) => s + e.count, 0),
        cost: E.deckCost(d.entries, price), fill: E.missingCost(st.rows, price) });
    }).filter(d => {
      if (mf.color && !E.cardColors(byId[d.lead] || {}).includes(mf.color)) return false;
      if (!q) return true;
      return [d.name, d.author, d.event, d.context, d.page, d.lead, cardName(d.lead)].some(x => String(x || '').toLowerCase().includes(q));
    });
    if (mf.sort === 'pct') list.sort((a, b) => b.st.pct - a.st.pct || a.st.missing - b.st.missing);
    if (mf.sort === 'missing') list.sort((a, b) => a.st.missing - b.st.missing);
    if (mf.sort === 'date') list.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    if (mf.sort === 'fill') list.sort((a, b) => a.fill.cost - b.fill.cost || a.st.missing - b.st.missing);
    if (mf.sort === 'value') list.sort((a, b) => b.cost.cost - a.cost.cost);
    $('#mf-list').innerHTML = list.slice(0, mf.limit).map(d => metaDeckHtml(d)).join('') || '<p class="muted">冇符合嘅 Deck</p>';
    $('#mf-more').style.display = list.length > mf.limit ? '' : 'none';
  }
  function metaDeckHtml(d) {
    const leadCard = byId[d.lead];
    const info = [d.placement, d.event, d.country, d.author && 'by ' + d.author, d.date].filter(Boolean).join(' · ');
    return `<div class="deck${mf.open[d.id] ? ' wide' : ''}">
      <div class="head"><div class="thumb">${imgTag(d.lead)}</div>
        <div class="grow"><div class="title">${esc(d.name || cardName(d.lead) || d.lead)}</div>
          <div class="muted">${esc(d.lead)} ${esc(leadCard ? leadCard.name : '')} ${dots(leadCard)}</div>
          <div class="muted" style="font-size:12px">${esc(info || d.context || d.page)}</div></div></div>
      <div class="bar ${barClass(d.st.pct)}"><i style="width:${(d.st.pct * 100).toFixed(0)}%"></i></div>
      <div>${d.st.have}/${d.st.need} 張 · ${d.st.missing ? `<span class="bad">差 ${d.st.missing} 張</span>` : '<span class="ok">夠晒咭，可以砌！</span>'}</div>
      ${costLine(d.cost, d.st.missing ? d.fill : null)}
      ${mf.open[d.id] ? rowsHtml(d.st.rows) : ''}
      <div class="actions"><button class="small" data-act="toggle" data-id="${esc(d.id)}">${mf.open[d.id] ? '收埋' : '睇咭表'}</button>
        <button class="small primary" data-act="copy" data-id="${esc(d.id)}">加入我的 Deck</button>
        <button class="small" data-act="text" data-id="${esc(d.id)}">複製文字</button>
        <a class="small muted" href="${esc(d.url)}" target="_blank" rel="noopener">來源</a></div>
    </div>`;
  }
  function costLine(cost, fill) {
    const unk = cost.unknown.length ? ` <span class="muted">(${cost.unknown.length} 款未有價)</span>` : '';
    return `<div class="muted" style="font-size:13px">市值 <b class="price">${hk(cost.cost)}</b>${unk}${fill ? ` · 補齊要 <b class="price">${hk(fill.cost)}</b>${fill.unknown ? ` +${fill.unknown} 張未有價` : ''}` : ''}</div>`;
  }
  function rowsHtml(rows, editable) {
    const price = pricer();
    const sorted = rows.slice().sort((a, b) => {
      const ca = byId[a.id] || {}, cb = byId[b.id] || {};
      const la = ca.category === 'LEADER' ? 0 : 1, lb = cb.category === 'LEADER' ? 0 : 1;
      return la - lb || (ca.cost ?? 99) - (cb.cost ?? 99) || a.id.localeCompare(b.id);
    });
    return `<div class="rows">${sorted.map(r => `<div class="row${r.missing ? ' miss' : ''}">
      <div class="thumb" data-detail="${esc(r.id)}">${imgTag(r.id)}</div>
      <div class="grow"><b>${esc(r.id)}</b> ${esc(cardName(r.id))}</div>
      <span class="muted rowprice">${(p => p ? hk(p.hkd) : '')(price(r.id))}</span>
      <span class="muted" title="可用 (扣除其他已砌 Deck)">有 ${r.free}</span>
      ${editable ? `<span class="cnt"><button class="small" data-e="${esc(r.id)}" data-n="-1">−</button><b class="need">${r.need}</b><button class="small" data-e="${esc(r.id)}" data-n="1">+</button></span>`
        : `<b class="need">×${r.need}</b>`}
    </div>`).join('')}</div>`;
  }
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-detail]');
    if (t) showDetail(t.dataset.detail);
  });
  function importPanelHtml() {
    return `<div class="panel" style="margin-top:16px"><h3>貼上 Deck list 匯入</h3>
      <p class="muted">支援 <code>4xOP08-002</code>、<code>4 OP08-002</code>、OPTCGSim 格式，或者 onepiecetopdecks 嘅 deckgen 連結 (dg=...)。</p>
      <input id="imp-name" placeholder="Deck 名" style="width:100%;margin-bottom:6px">
      <textarea id="imp-text" placeholder="1xOP08-001&#10;4xOP08-002&#10;..."></textarea>
      <div class="actions" style="margin-top:8px"><button class="primary" id="imp-go">匯入做我的 Deck</button></div></div>`;
  }
  function bindImport() {
    const go = $('#imp-go');
    if (!go) return;
    go.addEventListener('click', () => {
      const { entries, unknown } = E.parseDeckText($('#imp-text').value);
      if (!entries.length) { toast('搵唔到咭號'); return; }
      addMyDeck($('#imp-name').value || cardName(E.leaderOf(entries, byId)) || '新 Deck', entries, {});
      if (unknown.length) toast(`${unknown.length} 行睇唔明，已略過`);
    });
  }

  // ================================================================ MINE
  const STATUS = { plan: '計劃中', built: '已砌好 (預留咭)', sold: '已賣出' };
  const statusLabel = s => STATUS[s] || s;
  const mineOpen = {};
  let mineFilter = 'active';
  function addMyDeck(name, entries, extra) {
    const d = Object.assign({ id: uid(), name, entries: entries.map(e => ({ id: e.id, count: e.count })), status: 'plan', price: '', createdAt: new Date().toISOString() }, extra);
    state.decks.unshift(d);
    mineOpen[d.id] = true;
    save();
    toast('已加入「我的 Decks」');
    if (current !== 'mine') showTab('mine'); else render();
  }
  function renderMine() {
    const el = $('#tab-mine');
    const sold = state.decks.filter(d => d.status === 'sold');
    const income = sold.reduce((s, d) => s + (Number(d.soldPrice) || 0), 0);
    const profit = sold.reduce((s, d) => s + (d.soldPrice !== '' && d.costAtSale != null ? Number(d.soldPrice) - d.costAtSale : 0), 0);
    const plan = state.decks.filter(d => d.status === 'plan');
    const shop = E.shoppingList(plan, available());
    el.innerHTML = `
      <div class="toolbar">
        <button class="primary" id="new-deck">＋ 新 Deck</button>
        <select id="mine-filter"><option value="active">計劃中 + 已砌好</option><option value="plan">計劃中</option><option value="built">已砌好</option><option value="sold">已賣出</option><option value="all">全部</option></select>
      </div>
      <div class="stats"><span>計劃中 <b>${plan.length}</b></span><span>已砌好 <b>${state.decks.filter(d => d.status === 'built').length}</b></span>
        <span>已賣出 <b>${sold.length}</b> 副 · 收入 <b>${hk(income)}</b> · 對比市值 <b class="${profit >= 0 ? 'ok' : 'bad'}">${profit >= 0 ? '+' : ''}${hk(profit)}</b></span></div>
      <div class="decks" id="mine-list"></div>
      ${plan.length ? `<div class="panel" style="margin-top:16px"><h3>補咭清單 (全部「計劃中」Deck 一齊計)</h3>
        ${shop.length ? `<table class="list"><tr><th>咭</th><th>需要</th><th>可用</th><th>仲差</th></tr>${shop.map(r => `<tr><td><b>${esc(r.id)}</b> ${esc(cardName(r.id))}</td><td>${r.need}</td><td>${r.free}</td><td class="bad">${r.missing}</td></tr>`).join('')}</table>
        <div class="actions" style="margin-top:8px"><button class="small" id="copy-shop">複製清單</button></div>` : '<p class="ok">全部計劃中 Deck 都夠咭！</p>'}</div>` : ''}
      ${importPanelHtml()}`;
    $('#mine-filter').value = mineFilter;
    $('#mine-filter').addEventListener('change', e => { mineFilter = e.target.value; drawMine(); });
    $('#new-deck').addEventListener('click', () => addMyDeck('新 Deck', [], {}));
    const cs = $('#copy-shop');
    if (cs) cs.addEventListener('click', () => copyText(shop.map(r => `${r.missing}x${r.id} ${cardName(r.id)}`).join('\n')));
    $('#mine-list').addEventListener('click', onMineClick);
    $('#mine-list').addEventListener('change', onMineChange);
    $('#mine-list').addEventListener('input', onMineInput);
    bindImport();
    drawMine();
  }
  function drawMine() {
    const list = state.decks.filter(d => mineFilter === 'all' || d.status === mineFilter || (mineFilter === 'active' && d.status !== 'sold'));
    $('#mine-list').innerHTML = list.map(myDeckHtml).join('') || '<p class="muted">未有 Deck。去「Meta Decks」揀一副，或者撳「新 Deck」。</p>';
  }
  function myDeckHtml(d) {
    const avail = available(d.id);
    const st = E.deckStatus(d.entries, avail);
    const price = pricer();
    const cost = E.deckCost(d.entries, price);
    const ask = d.status === 'sold' ? d.soldPrice : d.price;
    const base = d.status === 'sold' && d.costAtSale != null ? d.costAtSale : cost.cost;
    const profit = ask === '' || ask == null ? null : Number(ask) - base;
    const lead = E.leaderOf(d.entries, byId);
    const issues = E.validateDeck(d.entries, byId);
    const open = !!mineOpen[d.id];
    const sold = d.status === 'sold';
    return `<div class="deck${open ? ' wide' : ''}" data-id="${esc(d.id)}">
      <div class="head"><div class="thumb">${imgTag(lead || 'LEADER')}</div>
        <div class="grow">
          <div class="title">${open && !sold ? `<input data-f="name" value="${esc(d.name)}">` : esc(d.name)}</div>
          <div class="muted">${esc(lead)} ${esc(cardName(lead))} ${dots(byId[lead])}</div>
          <span class="badge ${d.status}">${statusLabel(d.status)}</span>
          ${sold ? `<span class="muted"> ${esc((d.soldAt || '').slice(0, 10))} · 賣 ${hk(d.soldPrice)}</span>` : ''}
        </div></div>
      <div class="money">
        <span>市值${sold ? ' (賣出時)' : ''} <b class="price">${hk(base)}</b>${!sold && cost.unknown.length ? ` <span class="muted">(${cost.unknown.length} 款未有價)</span>` : ''}</span>
        ${!sold && st.missing ? `<span>補齊要 <b class="price">${hk(E.missingCost(st.rows, price).cost)}</b></span>` : ''}
        ${profit != null ? `<span>${sold ? '賺蝕' : '預計賺蝕'} <b class="${profit >= 0 ? 'ok' : 'bad'}">${profit >= 0 ? '+' : ''}${hk(profit)}</b></span>` : ''}
      </div>
      ${sold ? '' : `<div class="bar ${barClass(st.pct)}"><i style="width:${(st.pct * 100).toFixed(0)}%"></i></div>
      <div>${st.have}/${st.need} 張 · ${st.missing ? `<span class="bad">差 ${st.missing} 張</span>` : '<span class="ok">夠晒咭</span>'}</div>`}
      ${issues.length && !sold ? `<ul class="issues">${issues.map(i => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
      ${open ? `
        ${!sold ? `<label>售價 HK$ <input data-f="price" type="number" min="0" step="1" value="${esc(d.price)}" style="width:110px"></label>
          <button class="small" data-act="askmarket">用市值做售價</button>` : ''}
        ${rowsHtml(st.rows, !sold)}
        ${!sold ? `<div class="picker"><input data-f="search" placeholder="加咭：打編號或名" style="width:100%"><div class="results"></div></div>` : ''}
        <textarea data-f="notes" placeholder="備註 (買家、交收…)" style="min-height:50px">${esc(d.notes || '')}</textarea>` : ''}
      <div class="actions">
        <button class="small" data-act="toggle">${open ? '收埋' : '打開 / 編輯'}</button>
        ${d.status === 'plan' ? '<button class="small primary" data-act="build">砌好 (預留咭)</button>' : ''}
        ${d.status === 'built' ? '<button class="small" data-act="unbuild">拆返</button>' : ''}
        ${!sold ? '<button class="small primary" data-act="sell">賣出</button>' : '<button class="small" data-act="unsell">撤銷賣出</button>'}
        <button class="small" data-act="text">複製文字</button>
        <button class="small" data-act="dup">複製一副</button>
        <button class="small" data-act="del">刪除</button>
      </div></div>`;
  }
  function deckOf(el) { const box = el.closest('.deck'); return box && state.decks.find(d => d.id === box.dataset.id); }
  function redrawDeck(d) {
    const box = $(`.deck[data-id="${CSS.escape(d.id)}"]`, $('#mine-list'));
    if (box) box.outerHTML = myDeckHtml(d);
  }
  function onMineClick(e) {
    const d = deckOf(e.target);
    if (!d) return;
    const edit = e.target.closest('[data-e]');
    if (edit) {
      const id = edit.dataset.e;
      const entry = d.entries.find(x => x.id === id);
      const n = (entry ? entry.count : 0) + Number(edit.dataset.n);
      if (entry && n <= 0) d.entries = d.entries.filter(x => x.id !== id);
      else if (entry) entry.count = n;
      else if (n > 0) d.entries.push({ id, count: n });
      const search = edit.closest('.picker') && edit.closest('.picker').querySelector('input');
      const q = search ? search.value : '';
      save(); redrawDeck(d);
      if (q) { // keep the search results open while adding several cards
        const box = $(`.deck[data-id="${CSS.escape(d.id)}"] .picker input`, $('#mine-list'));
        if (box) { box.value = q; box.dispatchEvent(new Event('input', { bubbles: true })); }
      }
      return;
    }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'toggle') { mineOpen[d.id] = !mineOpen[d.id]; redrawDeck(d); }
    if (act === 'build') {
      const st = E.deckStatus(d.entries, available(d.id));
      if (st.missing && !confirm(`仲差 ${st.missing} 張，照樣標記做「已砌好」？`)) return;
      d.status = 'built'; d.builtAt = new Date().toISOString(); save(); renderMine();
    }
    if (act === 'unbuild') { d.status = 'plan'; save(); renderMine(); }
    if (act === 'askmarket') { d.price = Math.ceil(E.deckCost(d.entries, pricer()).cost); save(); redrawDeck(d); }
    if (act === 'sell') {
      const price = prompt('賣咗幾錢 (HK$)？(可留空)', d.price || '');
      if (price === null) return;
      const before = Object.assign({}, state.owned);
      const res = E.sellDeck(state.owned, d.entries, settings().includeParallels);
      if (res.shortfall.length && !confirm('咭庫唔夠呢啲咭：\n' + res.shortfall.map(s => `${s.id} 差 ${s.count}`).join('\n') + '\n照樣賣出？(有幾多扣幾多)')) return;
      state.owned = res.owned;
      d.removed = {};
      for (const id of Object.keys(before)) { const diff = before[id] - (res.owned[id] || 0); if (diff) d.removed[id] = diff; }
      d.costAtSale = E.deckCost(d.entries, pricer()).cost;
      d.status = 'sold'; d.soldAt = new Date().toISOString(); d.soldPrice = price === '' ? '' : Number(price);
      save(); renderMine(); toast('已從咭庫扣除');
    }
    if (act === 'unsell') {
      if (!confirm('撤銷賣出：將賣出時扣除嘅咭加返入咭庫？')) return;
      for (const [id, n] of Object.entries(d.removed || {})) state.owned[id] = (state.owned[id] || 0) + n;
      d.status = 'plan'; delete d.removed; delete d.soldAt; delete d.costAtSale; save(); renderMine();
    }
    if (act === 'text') copyText(E.deckToText(d.entries, byId));
    if (act === 'dup') addMyDeck(d.name + ' (2)', d.entries, { notes: '' });
    if (act === 'del') {
      if (!confirm(`刪除「${d.name}」？(唔會改動咭庫數量)`)) return;
      state.decks = state.decks.filter(x => x !== d); save(); renderMine();
    }
  }
  function onMineChange(e) {
    const d = deckOf(e.target); const f = e.target.dataset.f;
    if (!d || !f || f === 'search') return;
    d[f] = f === 'price' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value;
    save();
    if (f === 'price' || f === 'name') redrawDeck(d);
  }
  function onMineInput(e) {
    if (e.target.dataset.f !== 'search') return;
    const d = deckOf(e.target);
    const q = e.target.value.trim().toLowerCase();
    const box = e.target.parentElement.querySelector('.results');
    if (q.length < 2) { box.innerHTML = ''; return; }
    const lead = E.leaderOf(d.entries, byId);
    const lc = lead && byId[lead] ? E.cardColors(byId[lead]) : [];
    const avail = available(d.id);
    const hits = CARDS.filter(c => c.id === E.baseId(c.id) && (c.id.toLowerCase().includes(q) || (c.name || '').toLowerCase().includes(q)))
      .sort((a, b) => {
        const fit = c => (!lc.length || E.cardColors(c).some(x => lc.includes(x))) ? 0 : 1;
        return fit(a) - fit(b) || a.id.localeCompare(b.id);
      }).slice(0, 12);
    const direct = E.normId(q);
    if (!hits.length && direct) hits.push({ id: E.baseId(direct), name: '' });
    box.innerHTML = hits.map(c => `<div class="row"><div class="thumb">${imgTag(c.id)}</div><div class="grow"><b>${esc(c.id)}</b> ${esc(c.name)} ${dots(c)}</div>
      <span class="muted">有 ${Math.max(0, avail[c.id] || 0)}</span><button class="small" data-e="${esc(c.id)}" data-n="1">+1</button><button class="small" data-e="${esc(c.id)}" data-n="4">+4</button></div>`).join('');
  }

  // ============================================================== VALUE
  const vf = { q: '', scope: 'mine', sort: 'total', limit: 150 };
  function valueRows() {
    const price = pricer();
    const min = Number(settings().valuableMin) || 0;
    const reserved = E.reservedTotals(state.decks);
    const ids = new Set(Object.keys(state.owned));
    if (vf.scope === 'all') { for (const id of Object.keys(PRICES.prices)) ids.add(id); for (const id of Object.keys(state.manualPrices)) ids.add(id); }
    const q = vf.q.trim().toLowerCase();
    let rows = [];
    for (const id of ids) {
      const p = price(id);
      const n = ownedOf(id);
      if (!p || p.hkd < min) continue;
      if (vf.scope === 'mine' && !n) continue;
      const c = byId[id] || {};
      if (q && !(id.toLowerCase().includes(q) || (c.name || '').toLowerCase().includes(q))) continue;
      const pct = p.change && p.change.from ? (p.change.to - p.change.from) / p.change.from : 0;
      rows.push({ id, c, n, p, total: p.hkd * n, pct, reserved: id === E.baseId(id) ? reserved[id] || 0 : 0 });
    }
    const by = { total: (a, b) => b.total - a.total, unit: (a, b) => b.p.hkd - a.p.hkd, up: (a, b) => b.pct - a.pct, down: (a, b) => a.pct - b.pct, id: (a, b) => a.id.localeCompare(b.id) }[vf.sort];
    rows.sort((a, b) => by(a, b) || a.id.localeCompare(b.id));
    return rows;
  }
  function renderValue() {
    const el = $('#tab-value');
    const price = pricer();
    const v = E.collectionValue(state.owned, price);
    const hasBot = Object.keys(PRICES.prices || {}).length > 0;
    el.innerHTML = `
      ${hasBot ? '' : `<div class="notice"><b>未有自動價錢。</b> 行價錢 BOT（悠々亭日版售價 × 匯率）：<pre>python3 opcg/bot/scrape_prices.py</pre>或者喺「設定」撳「更新價錢」。冇 BOT 都可以喺下面或者咭嘅詳情入面自己輸入價錢。</div>`}
      <div class="stats">
        <span>咭庫總值 <b class="price">${hk(v.total)}</b></span>
        <span>有價 <b>${v.priced}</b> 張 · 未有價 <b>${v.unpriced}</b> 張</span>
        <span id="vf-sum"></span>
        <span>價錢 ${PRICES.fetchedAt ? '更新 ' + esc(PRICES.fetchedAt.slice(0, 10)) : '未更新'} · 1 JPY = ${rate()} HKD${Number(settings().factor) !== 1 ? ' · 係數 ×' + esc(settings().factor) : ''}</span>
      </div>
      <div class="toolbar">
        <input type="search" id="vf-q" placeholder="搜尋 編號 / 名">
        <label>HK$ <input id="vf-min" type="number" min="0" step="10" style="width:90px"> 或以上</label>
        <select id="vf-scope"><option value="mine">我有嘅</option><option value="all">全部有價嘅咭</option></select>
        <select id="vf-sort"><option value="total">總值高先</option><option value="unit">單價高先</option><option value="up">升得多先</option><option value="down">跌得多先</option><option value="id">按編號</option></select>
        <button id="vf-csv" class="small">匯出 CSV</button>
      </div>
      <div class="vlist" id="vf-list"></div>
      <button class="more" id="vf-more">顯示更多</button>`;
    $('#vf-min').value = settings().valuableMin;
    $('#vf-min').addEventListener('change', e => { settings().valuableMin = Number(e.target.value) || 0; save(); drawValue(); });
    for (const k of ['q', 'scope', 'sort']) {
      const input = $('#vf-' + k);
      input.value = vf[k];
      input.addEventListener(k === 'q' ? 'input' : 'change', () => { vf[k] = input.value; vf.limit = 150; drawValue(); });
    }
    $('#vf-more').addEventListener('click', () => { vf.limit += 150; drawValue(); });
    $('#vf-csv').addEventListener('click', () => {
      const rows = [['id', 'name', 'rarity', 'count', 'unit_hkd', 'total_hkd', 'source', 'jpy', 'price_date']].concat(valueRows().map(r =>
        [r.id, r.c.name || '', r.c.rarity || '', r.n, r.p.hkd, Math.round(r.total * 10) / 10, r.p.source, r.p.jpy ?? '', r.p.at || '']));
      download('opcg-valuable.csv', '﻿' + rows.map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv');
    });
    const list = $('#vf-list');
    list.addEventListener('change', e => {
      const m = e.target.closest('[data-mp]');
      if (!m) return;
      setManualPrice(m.dataset.mp, m.value);
      drawValue();
    });
    list.addEventListener('click', e => {
      const b = e.target.closest('[data-clear]');
      if (b) { setManualPrice(b.dataset.clear, ''); drawValue(); }
    });
    drawValue();
  }
  function drawValue() {
    const rows = valueRows();
    const sum = rows.reduce((s, r) => s + r.total, 0);
    $('#vf-sum').innerHTML = `呢度 <b>${rows.length}</b> 款 · 總值 <b class="price">${hk(sum)}</b>`;
    $('#vf-list').innerHTML = rows.slice(0, vf.limit).map(r => `<div class="vrow">
      <div class="thumb" data-detail="${esc(r.id)}">${imgTag(r.id)}</div>
      <div class="grow">
        <div><b>${esc(r.id)}</b> <span class="muted">${esc(r.c.rarity || '')}</span> ${esc(r.c.name || '')}${r.id !== E.baseId(r.id) ? ' <span class="badge">平行</span>' : ''}</div>
        <div class="muted" style="font-size:12px">${r.p.source === 'manual' ? `手動 (${esc(r.p.at || '')}) <button class="small" data-clear="${esc(r.id)}">用返自動價</button>` : `悠々亭 ¥${Number(r.p.jpy).toLocaleString()}${r.p.stock === 0 ? ' · 缺貨' : ''} · ${esc(r.p.at || '')}`}
          · <a href="${esc(shopUrl(r.id))}" target="_blank" rel="noopener">悠々亭</a>${r.reserved ? ` · 預留 ${r.reserved}` : ''}</div>
      </div>
      <div class="vnum"><div class="muted">單價</div><b class="price">${hk(r.p.hkd)}</b> ${changeHtml(r.p.change)}</div>
      <div class="vnum"><div class="muted">× ${r.n}</div><b class="price">${hk(r.total)}</b></div>
      <div class="vnum"><input data-mp="${esc(r.id)}" type="number" min="0" step="1" placeholder="改價" aria-label="手動價 HK$" style="width:84px"></div>
    </div>`).join('') || '<p class="muted">冇符合嘅咭。試吓降低價錢門檻，或者揀「全部有價嘅咭」。</p>';
    $('#vf-more').style.display = rows.length > vf.limit ? '' : 'none';
  }

  // ============================================================ SETTINGS
  function renderSettings() {
    const el = $('#tab-settings');
    const cs = window.OPCG_CARDS, ds = window.OPCG_DECKS;
    el.innerHTML = `
      <div class="cols">
        <div class="panel"><h2>資料</h2>
          <p>咭表：${cs ? `<b>${CARDS.length}</b> 張 · ${esc((cs.series || []).length)} 個系列 · 更新 ${esc((cs.scrapedAt || '').slice(0, 16).replace('T', ' '))}` : '<span class="warn">未有</span>'}</p>
          <p>Meta Decks：${ds ? `<b>${META.length}</b> 副 · 更新 ${esc((ds.scrapedAt || '').slice(0, 16).replace('T', ' '))}` : '<span class="warn">未有</span>'}</p>
          <p>價錢：${PRICES.fetchedAt ? `<b>${Object.keys(PRICES.prices).length}</b> 款 · 更新 ${esc(PRICES.fetchedAt.slice(0, 16).replace('T', ' '))}` : '<span class="warn">未有</span>'} · 手動價 <b>${Object.keys(state.manualPrices).length}</b> 款</p>
          <div id="bot-box">${serverMode ? `
            <div class="actions"><button data-bot="cards">更新咭表</button><button data-bot="cards-images">更新咭表 + 下載圖片</button><button data-bot="decks">更新 Deck list</button><button data-bot="prices">更新價錢</button></div>
            <pre id="bot-log" class="muted" style="max-height:260px;overflow:auto"></pre>` : noDataNotice('伺服器').replace('未有伺服器資料。', 'BOT 要喺電腦行。')}</div>
        </div>
        <div class="panel"><h2>設定</h2>
          <label><input type="checkbox" id="set-par"${settings().includeParallels ? ' checked' : ''}> 計 Deck 時連平行/異圖一齊計 (賣 Deck 時會先用普通版)</label>
          <h3 style="margin-top:16px">價錢</h3>
          <p class="muted" style="margin:0 0 6px">自動價 = 悠々亭日版售價 (JPY) × 匯率 × 係數。港版/亞洲中文版通常同日版行情唔同，可以用係數調整 (例如 0.8)。手動價永遠優先。</p>
          <div class="toolbar">
            <label>1 JPY = <input id="set-rate" type="number" step="0.0001" min="0" style="width:100px" placeholder="${esc(PRICES.jpyToHkd || DEFAULT_RATE)}"> HKD</label>
            <label>係數 × <input id="set-factor" type="number" step="0.05" min="0" style="width:80px"></label>
          </div>
          <p class="muted" style="margin:0">匯率留空 = 用 BOT 最近攞到嘅匯率 (${esc(PRICES.jpyToHkd || DEFAULT_RATE + '，預設值')})。</p>
          <h3 style="margin-top:16px">備份</h3>
          <div class="actions"><button id="exp">匯出備份 (JSON)</button><label class="small"><input type="file" id="imp" accept=".json,application/json" hidden><span class="small" style="border:1px solid var(--line);border-radius:8px;padding:6px 12px;cursor:pointer">匯入備份</span></label>
            <button id="exp-csv">匯出咭庫 CSV</button></div>
          <h3 style="margin-top:16px">外觀</h3>
          <select id="theme"><option value="">跟系統</option><option value="light">淺色</option><option value="dark">深色</option></select>
          <h3 style="margin-top:16px">清除</h3>
          <button id="wipe" class="small">清除所有咭庫同 Deck 資料</button>
        </div>
      </div>`;
    $('#set-par').addEventListener('change', e => { settings().includeParallels = e.target.checked; save(); });
    $('#set-rate').value = settings().rate || '';
    $('#set-rate').addEventListener('change', e => { settings().rate = e.target.value === '' ? '' : Number(e.target.value); save(); toast('已更新匯率'); });
    $('#set-factor').value = settings().factor ?? 1;
    $('#set-factor').addEventListener('change', e => { settings().factor = e.target.value === '' ? 1 : Number(e.target.value); save(); toast('已更新係數'); });
    $('#exp').addEventListener('click', () => download('opcg-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(state, null, 1), 'application/json'));
    $('#exp-csv').addEventListener('click', () => {
      const price = pricer();
      const rows = [['id', 'name', 'rarity', 'set', 'count', 'unit_hkd']].concat(Object.keys(state.owned).sort().map(id => {
        const c = byId[id] || {}; const p = price(id);
        return [id, c.name || '', c.rarity || '', c.set || E.setOf(id), state.owned[id], p ? p.hkd : ''];
      }));
      download('opcg-collection.csv', '﻿' + rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n'), 'text/csv');
    });
    $('#imp').addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      try {
        const s = JSON.parse(await f.text());
        if (!s || typeof s.owned !== 'object') throw new Error('not a backup');
        if (!confirm('用呢個備份取代而家嘅資料？')) return;
        state = normalise(s); save(); toast('已匯入備份'); renderSettings();
      } catch (err) { toast('唔係有效嘅備份檔'); }
    });
    const theme = $('#theme');
    theme.value = document.documentElement.dataset.theme || '';
    theme.addEventListener('change', () => {
      if (theme.value) document.documentElement.dataset.theme = theme.value; else delete document.documentElement.dataset.theme;
      try { localStorage.setItem('opcg-theme', theme.value); } catch (e) { /* ignore */ }
    });
    $('#wipe').addEventListener('click', () => {
      if (!confirm('真係要清除所有咭庫同 Deck？(建議先匯出備份)')) return;
      state = blankState(); save(); toast('已清除'); renderSettings();
    });
    if (serverMode) {
      $$('[data-bot]').forEach(b => b.addEventListener('click', async () => {
        await fetch('/api/bot/' + b.dataset.bot, { method: 'POST' });
        pollBot(b.dataset.bot);
      }));
      pollBot();
    }
  }
  async function pollBot(name) {
    clearTimeout(pollBot.t);
    let j;
    try { j = await (await fetch('/api/bot', { cache: 'no-store' })).json(); } catch (e) { return; }
    const jobs = j.jobs || {};
    const key = name || Object.keys(jobs).sort((a, b) => (jobs[b].started || 0) - (jobs[a].started || 0))[0];
    const job = key && jobs[key];
    const log = $('#bot-log');
    if (!log || !job) return;
    log.textContent = job.log || '…';
    log.scrollTop = log.scrollHeight;
    $$('[data-bot]').forEach(b => { b.disabled = Object.values(jobs).some(x => x.running); });
    if (job.running) pollBot.t = setTimeout(() => pollBot(key), 1500);
    else if (name && job.code === 0) { toast('完成，重新載入…'); setTimeout(() => location.reload(), 1200); }
    else if (name && job.code) toast('BOT 失敗，睇記錄');
  }

  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  function copyText(text) {
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
      .then(() => toast('已複製'))
      .catch(() => { $('#modal-body').innerHTML = `<h3>複製呢段文字</h3><textarea style="min-height:300px">${esc(text)}</textarea>`; $('#modal').showModal(); });
  }

  // ---------------------------------------------------------------- boot
  try { const t = localStorage.getItem('opcg-theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) { /* ignore */ }
  load().then(() => {
    let tab = 'collection';
    try { tab = localStorage.getItem('opcg-tab') || tab; } catch (e) { /* ignore */ }
    showTab(['collection', 'open', 'meta', 'mine', 'value', 'settings'].includes(tab) ? tab : 'collection');
  });
})();
