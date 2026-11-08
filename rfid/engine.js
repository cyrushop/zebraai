/* Zone engine for a fixed RFID store install without a location engine.
 *
 * Input: raw reads {t, epc, ant, rssi} from FXR90 antenna ports, and POS sales {t, epc, ...}.
 * There is no X/Y. Each antenna belongs to one zone, so an item's location is the zone whose
 * antennas read it best. Hysteresis stops an item jumping zones on a single stray read.
 * Inner/outer antenna pairs at a doorway (portals) give a direction: stockroom -> floor, or
 * leaving through the entrance. Zone changes and portal crossings add up to the store's flow.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RFIDEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FLOOR_KINDS = new Set(['floor']);

  function createEngine(config, opts) {
    opts = opts || {};
    const P = config.params;
    const store = config.store;
    const zoneById = new Map(config.zones.map(z => [z.id, z]));
    const antById = new Map(config.antennas.map(a => [a.id, a]));
    const catalogue = opts.catalogue || [];
    const catBySku = new Map(catalogue.map(c => [c.sku, c]));
    const tagIndex = new Map((opts.tags || []).map(t => [t.epc, t]));
    const baselineUntil = opts.baselineUntil != null ? opts.baselineUntil : store.open;

    const S = {
      t: 0,
      win: null,
      bucket: new Map(),
      items: new Map(),
      movements: [],
      portalEvents: [],
      sales: [],
      frEntries: [],
      received: [],
      recent: [],
      readsTotal: 0,
      refReads: 0,
      unknownAntennaReads: 0,
      portalState: new Map(),
      ant: new Map(config.antennas.map(a => [a.id, { reads: 0, last: null, minutes: new Map() }]))
    };

    let feed = { reads: [], sales: [] };
    let ri = 0, si = 0;

    function load(data) {
      feed = { reads: data.reads || [], sales: data.sales || [] };
      ri = 0; si = 0;
      (data.tags || []).forEach(t => tagIndex.set(t.epc, t));
    }

    function getItem(epc, t) {
      let it = S.items.get(epc);
      if (!it) {
        const tag = tagIndex.get(epc) || {};
        it = {
          epc, sku: tag.sku || '?', size: tag.size || '?',
          zone: null, since: null, firstSeen: t, lastSeen: null, lastAnt: null,
          cand: null, candN: 0, candT: 0,
          sold: false, soldAt: null, left: false, leftAt: null,
          frEnter: null, received: false
        };
        S.items.set(epc, it);
      }
      return it;
    }

    function setZone(it, zone, t) {
      const from = it.zone;
      if (from === zone) return;
      if (from === null) {
        if (t >= baselineUntil && zoneById.get(zone) && zoneById.get(zone).kind === 'boh') {
          it.received = true;
          S.received.push({ t, epc: it.epc });
        }
      } else {
        S.movements.push({ t, epc: it.epc, from, to: zone });
      }
      it.zone = zone; it.since = t; it.cand = null; it.candN = 0;
      const zk = zoneById.get(zone) && zoneById.get(zone).kind;
      if (zk === 'fr' && from !== null) { it.frEnter = t; S.frEntries.push({ t, epc: it.epc }); }
    }

    function decide(it, scores, t) {
      let best = null, bestScore = -Infinity;
      for (const z in scores) if (scores[z].score > bestScore) { best = z; bestScore = scores[z].score; }
      if (best === null) return;
      if (it.left) {
        if (t <= it.leftAt + P.windowSec) return; // reads from just before the exit
        it.left = false; it.leftAt = null;
      }
      if (it.zone === null) { setZone(it, best, t); return; }
      if (best === it.zone) { it.cand = null; it.candN = 0; return; }
      const cur = scores[it.zone];
      const strong = cur ? (bestScore - cur.score >= P.marginDb) : (scores[best].peak >= P.strongDbm);
      if (strong) { setZone(it, best, t); return; }
      if (it.cand === best && t - it.candT <= P.windowSec * 3) it.candN++;
      else { it.cand = best; it.candN = 1; }
      it.candT = t;
      if (it.candN >= P.confirmWindows) setZone(it, best, t);
    }

    function flushWindow() {
      for (const [epc, reads] of S.bucket) {
        const it = S.items.get(epc);
        const scores = {};
        let last = 0;
        for (const r of reads) {
          const a = antById.get(r.ant);
          const z = scores[a.zone] || (scores[a.zone] = { peak: -999, n: 0, score: 0 });
          if (r.rssi > z.peak) z.peak = r.rssi;
          z.n++;
          if (r.t > last) last = r.t;
        }
        for (const z in scores) scores[z].score = scores[z].peak + 2 * Math.log2(scores[z].n);
        decide(it, scores, last);
      }
      S.bucket.clear();
    }

    function handlePortal(it, a, t) {
      const key = it.epc + '|' + a.portal;
      let st = S.portalState.get(key);
      if (!st) { st = { inner: -1e12, outer: -1e12, evt: -1e12 }; S.portalState.set(key, st); }
      const other = a.side === 'inner' ? 'outer' : 'inner';
      st[a.side] = t;
      if (t - st[other] <= P.portalPairSec && st[other] < t && t - st.evt > P.portalCooldownSec) {
        st.evt = t;
        const dir = other === 'inner' ? 'out' : 'in';
        const ev = { t, epc: it.epc, portal: a.portal, dir, sold: it.sold, unpaid: false };
        if (a.portal === 'entrance') {
          if (dir === 'out') {
            it.left = true; it.leftAt = t;
            ev.unpaid = !it.sold;
          } else {
            it.left = false; it.leftAt = null;
          }
        }
        S.portalEvents.push(ev);
      }
    }

    function ingestRead(r) {
      const a = antById.get(r.ant);
      S.readsTotal++;
      if (!a) { S.unknownAntennaReads++; return; }
      const st = S.ant.get(a.id);
      st.reads++; st.last = r.t;
      const m = Math.floor(r.t / 60);
      st.minutes.set(m, (st.minutes.get(m) || 0) + 1);
      if (P.refTagPrefix && r.epc.startsWith(P.refTagPrefix)) { S.refReads++; return; }
      const it = getItem(r.epc, r.t);
      it.lastSeen = r.t; it.lastAnt = a.id;
      S.recent.push(r);
      if (S.recent.length > 400) S.recent.splice(0, 100);
      const w = Math.floor(r.t / P.windowSec);
      if (S.win !== null && w > S.win) { flushWindow(); S.win = null; }
      if (a.portal) { if (r.rssi >= P.portalMinDbm) handlePortal(it, a, r.t); return; }
      S.win = w;
      let b = S.bucket.get(r.epc);
      if (!b) { b = []; S.bucket.set(r.epc, b); }
      b.push(r);
    }

    function ingestSale(s) {
      const it = getItem(s.epc, s.t);
      if (it.sku === '?' && s.sku) { it.sku = s.sku; it.size = s.size || it.size; }
      if (it.sold) return;
      it.sold = true; it.soldAt = s.t;
      S.sales.push(s);
    }

    function runTo(T) {
      if (T < S.t) throw new Error('runTo can only move forward; create a new engine to go back');
      for (;;) {
        const r = ri < feed.reads.length ? feed.reads[ri] : null;
        const s = si < feed.sales.length ? feed.sales[si] : null;
        const rt = r && r.t < T ? r.t : Infinity;
        const sT = s && s.t < T ? s.t : Infinity;
        if (rt === Infinity && sT === Infinity) break;
        if (rt <= sT) { ingestRead(r); ri++; } else { ingestSale(s); si++; }
      }
      if (S.win !== null && T >= (S.win + 1) * P.windowSec) { flushWindow(); S.win = null; }
      S.t = T;
      return api;
    }

    /* ---------- queries (state at S.t) ---------- */

    function zoneKind(z) { const zz = zoneById.get(z); return zz ? zz.kind : null; }
    function isMissing(it) { return it.lastSeen !== null && S.t - it.lastSeen > P.missingAfterSec; }
    function onHand(it) { return !it.sold && !it.left && it.zone !== null && !isMissing(it); }
    function bucketOf(it) {
      const k = zoneKind(it.zone);
      if (FLOOR_KINDS.has(k)) return 'floor';
      if (k === 'boh') return 'boh';
      if (k === 'fr') return 'fr';
      if (k === 'cash') return 'cash';
      return 'other';
    }
    function hoursOpen() { return Math.max(0.5, (Math.min(S.t, store.close) - store.open) / 3600); }

    function inventory() {
      const rows = new Map();
      const rowFor = (sku, size) => {
        const k = sku + '|' + size;
        let r = rows.get(k);
        if (!r) {
          const c = catBySku.get(sku) || {};
          r = {
            key: k, sku, size, name: c.name || 'Unknown tag', color: c.color || '', hex: c.hex || '#999999',
            cat: c.cat || 'Unknown', home: c.zone || null, face: c.face || 0, price: c.price || 0,
            floor: 0, boh: 0, fr: 0, cash: 0, other: 0, total: 0, missing: 0, sold: 0,
            byZone: {}, lastSeen: null, epcs: []
          };
          rows.set(k, r);
        }
        return r;
      };
      catalogue.forEach(c => c.sizes.forEach(sz => rowFor(c.sku, sz)));
      for (const it of S.items.values()) {
        const r = rowFor(it.sku, it.size);
        if (it.sold) { r.sold++; continue; }
        if (it.left) continue;
        if (isMissing(it)) { r.missing++; r.epcs.push(it); continue; }
        if (it.zone === null) continue;
        const b = bucketOf(it);
        r[b]++; r.total++;
        r.byZone[it.zone] = (r.byZone[it.zone] || 0) + 1;
        if (r.lastSeen === null || it.lastSeen > r.lastSeen) r.lastSeen = it.lastSeen;
        r.epcs.push(it);
      }
      return Array.from(rows.values());
    }

    function replenishment(inv) {
      inv = inv || inventory();
      const h = hoursOpen();
      const out = [];
      for (const r of inv) {
        if (!r.face) continue;
        const velocity = r.sold / h;
        const target = Math.max(r.face, Math.ceil(velocity * P.replenCycleHours));
        const need = target - r.floor;
        if (need <= 0 || r.boh <= 0) continue;
        out.push(Object.assign({}, r, { target, need, suggest: Math.min(need, r.boh), velocity }));
      }
      const empty = r => (r.floor === 0 ? 0 : 1);
      out.sort((a, b) => empty(a) - empty(b) || b.need - a.need || b.velocity - a.velocity);
      return out;
    }

    function zones() {
      const out = config.zones.map(z => ({
        id: z.id, name: z.name, kind: z.kind,
        antennas: config.antennas.filter(a => a.zone === z.id).map(a => a.id),
        onHand: 0, in: 0, out: 0, dwellSum: 0, dwellN: 0
      }));
      const byId = new Map(out.map(z => [z.id, z]));
      for (const it of S.items.values()) {
        if (!onHand(it)) continue;
        const z = byId.get(it.zone);
        if (z) z.onHand++;
      }
      for (const m of S.movements) {
        const f = byId.get(m.from), t = byId.get(m.to);
        if (f) f.out++;
        if (t) t.in++;
      }
      return out;
    }

    function hourIndex(t) { return Math.floor(t / 3600); }

    function flow() {
      const h0 = hourIndex(store.open), h1 = hourIndex(store.close - 1);
      const hourly = [];
      for (let h = h0; h <= h1; h++) hourly.push({ h, moves: 0, bohToFloor: 0, floorToBoh: 0, intoFR: 0, sold: 0, exits: 0, unpaid: 0 });
      const H = h => hourly[Math.min(hourly.length - 1, Math.max(0, h - h0))];
      const matrix = {};
      for (const m of S.movements) {
        (matrix[m.from] || (matrix[m.from] = {}))[m.to] = (matrix[m.from][m.to] || 0) + 1;
        H(hourIndex(m.t)).moves++;
      }
      const portals = {};
      config.portals.forEach(p => { portals[p.id] = { out: 0, in: 0 }; });
      for (const e of S.portalEvents) {
        const p = portals[e.portal] || (portals[e.portal] = { out: 0, in: 0 });
        p[e.dir]++;
        const row = H(hourIndex(e.t));
        if (e.portal === 'boh-door') { if (e.dir === 'out') row.bohToFloor++; else row.floorToBoh++; }
        if (e.portal === 'entrance' && e.dir === 'out') { row.exits++; if (e.unpaid) row.unpaid++; }
      }
      for (const f of S.frEntries) H(hourIndex(f.t)).intoFR++;
      for (const s of S.sales) H(hourIndex(s.t)).sold++;

      // Fitting rooms: items that went in, sessions (entries close in time), and how many sold afterwards.
      const frEpcs = new Map();
      for (const f of S.frEntries) if (!frEpcs.has(f.epc)) frEpcs.set(f.epc, f.t);
      let converted = 0;
      for (const [epc, t] of frEpcs) { const it = S.items.get(epc); if (it && it.sold && it.soldAt > t) converted++; }
      let sessions = 0, lastT = -Infinity;
      for (const f of S.frEntries) { if (f.t - lastT > P.frSessionGapSec) sessions++; lastT = f.t; }
      let leftNow = 0;
      for (const it of S.items.values()) if (onHand(it) && zoneKind(it.zone) === 'fr' && S.t - it.since > P.leftInFittingSec) leftNow++;

      const zoneEntries = {};
      for (const m of S.movements) zoneEntries[m.to] = (zoneEntries[m.to] || 0) + 1;

      return {
        hourly, matrix, portals, zoneEntries,
        totalMoves: S.movements.length,
        received: S.received.length,
        fr: { entries: S.frEntries.length, items: frEpcs.size, sessions, converted, conversion: frEpcs.size ? converted / frEpcs.size : 0, leftNow }
      };
    }

    function antennaStats() {
      return config.antennas.map(a => {
        const st = S.ant.get(a.id);
        const m = Math.floor(S.t / 60);
        let last5 = 0;
        for (let i = m - 5; i < m; i++) last5 += st.minutes.get(i) || 0;
        const openLong = S.t > store.open + P.antennaSilentSec && S.t < store.close;
        const silent = openLong && (st.last === null || S.t - st.last > P.antennaSilentSec);
        return { id: a.id, reads: st.reads, last: st.last, last5, status: silent ? 'silent' : (st.last === null ? 'idle' : 'ok') };
      });
    }

    function alerts(inv) {
      inv = inv || inventory();
      const out = [];
      // Unpaid exits: items crossing within 20 s of each other are one event.
      let group = null;
      const flush = () => {
        if (!group) return;
        const n = group.items.length;
        const value = group.items.reduce((a, it) => a + ((catBySku.get(it.sku) || {}).price || 0), 0);
        out.push({
          prio: 'P1', t: group.t, type: 'unpaid-exit', zone: 'entrance',
          title: n > 1 ? `${n} unpaid items left the store` : 'Unpaid item left the store',
          detail: group.items.map(it => `${(catBySku.get(it.sku) || {}).name || it.sku} ${it.size}`).join(', ') + (value ? ` · HK$ ${value.toLocaleString('en-HK')}` : '')
        });
        group = null;
      };
      for (const e of S.portalEvents) {
        if (!e.unpaid) continue;
        const it = S.items.get(e.epc);
        if (group && e.t - group.last > 20) flush();
        if (!group) group = { t: e.t, last: e.t, items: [] };
        group.items.push(it); group.last = e.t;
      }
      flush();
      for (const a of antennaStats()) {
        if (a.status !== 'silent') continue;
        const cfg = antById.get(a.id);
        out.push({ prio: 'P2', t: a.last || S.t, type: 'antenna-silent', zone: cfg.zone, title: `Antenna ${a.id} has no reads`, detail: `${cfg.reader} port ${cfg.port} · ${cfg.model} · ${zoneById.get(cfg.zone).name}` });
      }
      for (const r of inv) {
        if (r.face && r.floor === 0 && r.boh > 0) {
          out.push({ prio: 'P2', t: r.lastSeen || S.t, type: 'floor-empty', zone: r.home, title: `${r.name} ${r.color} ${r.size} not on the floor`, detail: `${r.boh} in stockroom · bring out ${Math.min(r.face, r.boh)}` });
        }
      }
      const left = [];
      const mis = new Map();
      for (const it of S.items.values()) {
        if (!onHand(it)) continue;
        const k = zoneKind(it.zone);
        if (k === 'fr' && S.t - it.since > P.leftInFittingSec) left.push(it);
        const c = catBySku.get(it.sku);
        if (c && k === 'floor' && it.zone !== c.zone && S.t - it.since > P.misplacedAfterSec) {
          const key = it.sku + '|' + it.zone;
          const g = mis.get(key) || { sku: it.sku, zone: it.zone, n: 0, t: it.since };
          g.n++; g.t = Math.min(g.t, it.since);
          mis.set(key, g);
        }
      }
      if (left.length) {
        out.push({ prio: 'P3', t: Math.min(...left.map(i => i.since)), type: 'left-fr', zone: 'fitting', title: `${left.length} item${left.length > 1 ? 's' : ''} left in the fitting rooms`, detail: `In there over ${Math.round(P.leftInFittingSec / 60)} min. Return to the floor.` });
      }
      for (const g of mis.values()) {
        const c = catBySku.get(g.sku);
        out.push({ prio: 'P3', t: g.t, type: 'misplaced', zone: g.zone, title: `${g.n} × ${c.name} in ${zoneById.get(g.zone).name}`, detail: `Belongs in ${zoneById.get(c.zone).name}` });
      }
      const rank = { P1: 0, P2: 1, P3: 2 };
      out.sort((a, b) => rank[a.prio] - rank[b.prio] || b.t - a.t);
      return out;
    }

    function kpis(inv) {
      inv = inv || inventory();
      let onHandN = 0, floor = 0, boh = 0, fr = 0, missing = 0, sizes = 0, sizesOnFloor = 0;
      for (const r of inv) {
        onHandN += r.total; floor += r.floor; boh += r.boh; fr += r.fr; missing += r.missing;
        if (r.face && r.total > 0) { sizes++; if (r.floor > 0) sizesOnFloor++; }
      }
      const salesValue = S.sales.reduce((a, s) => a + (s.price || 0), 0);
      return {
        onHand: onHandN, floor, boh, fr, missing,
        sizesOnFloor: sizes ? sizesOnFloor / sizes : 0,
        moves: S.movements.length,
        sold: S.sales.length, salesValue,
        received: S.received.length,
        readsTotal: S.readsTotal
      };
    }

    function itemsInZone(zoneId) {
      const out = [];
      for (const it of S.items.values()) if (onHand(it) && it.zone === zoneId) out.push(it);
      return out;
    }

    const api = {
      load, runTo, ingestRead, ingestSale,
      get t() { return S.t; },
      state: S,
      item: epc => S.items.get(epc),
      items: () => S.items.values(),
      inventory, replenishment, zones, flow, alerts, kpis, antennaStats, itemsInZone,
      isMissing, onHand
    };
    return api;
  }

  return { createEngine };
});
