/* Simulated store day for the zone engine: one FXR90 read stream plus POS sales.
 *
 * The simulator keeps the true zone of every tagged item (on the shelf, carried, in a
 * fitting room, at the counter, gone) and turns it into the raw reads the antennas would
 * report: strong reads from the item's own zone, weaker bleed reads from nearby antennas,
 * the odd stray read, and inner/outer read pairs when an item crosses a doorway.
 * The engine only sees the reads, so it has to work out zones and flow from them.
 * All products and figures are illustrative.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RFIDSim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  // Minimal binary heap ordered by t.
  function Heap() { this.a = []; }
  Heap.prototype.push = function (e) {
    const a = this.a; a.push(e); let i = a.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (a[p].t <= a[i].t) break; [a[p], a[i]] = [a[i], a[p]]; i = p; }
  };
  Heap.prototype.pop = function () {
    const a = this.a; const top = a[0]; const last = a.pop();
    if (a.length) {
      a[0] = last; let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < a.length && a[l].t < a[m].t) m = l;
        if (r < a.length && a[r].t < a[m].t) m = r;
        if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m;
      }
    }
    return top;
  };
  Heap.prototype.size = function () { return this.a.length; };

  const HOUR_WEIGHT = { 10: 0.5, 11: 0.7, 12: 1.2, 13: 1.4, 14: 1.0, 15: 0.9, 16: 1.0, 17: 1.1, 18: 1.3, 19: 1.5, 20: 1.2, 21: 0.6 };
  const PICK_ZONES = [['polo', 3], ['mens', 3], ['womens', 3], ['children', 1.5], ['clearance', 2], ['accessories', 1.5]];
  const HB = 900; // seconds between reports for a tag that sits still

  function simulate(config, catalogue, opts) {
    opts = opts || {};
    const R = mulberry32(opts.seed || 20261108);
    const store = config.store;
    const t0 = opts.start != null ? opts.start : store.open - 600;
    const endT = opts.until != null ? opts.until : store.close + 600;
    const outage = opts.outage === undefined ? { ant: 'A6', from: 15 * 3600 + 20 * 60, to: 15 * 3600 + 50 * 60 } : opts.outage;
    const shopperBase = opts.shopperBase || 30;

    const rnd = (a, b) => a + R() * (b - a);
    const pick = arr => arr[Math.floor(R() * arr.length)];
    const wpick = list => { let tot = 0; list.forEach(x => tot += x[1]); let k = R() * tot; for (const [v, w] of list) { k -= w; if (k <= 0) return v; } return list[0][0]; };

    const zoneById = new Map(config.zones.map(z => [z.id, z]));
    const catBySku = new Map(catalogue.map(c => [c.sku, c]));
    const areaAnts = {};
    const portalAnts = {};
    for (const a of config.antennas) {
      if (a.portal) { (portalAnts[a.portal] || (portalAnts[a.portal] = {}))[a.side] = a; continue; }
      (areaAnts[a.zone] || (areaAnts[a.zone] = [])).push(a);
    }
    const allArea = config.antennas.filter(a => !a.portal);
    const neighbours = {};
    for (const z of config.zones) {
      const own = areaAnts[z.id] || [];
      const pts = own.length ? own : [{ x: z.rects[0][0] + z.rects[0][2] / 2, y: z.rects[0][1] + z.rects[0][3] / 2 }];
      neighbours[z.id] = allArea.filter(a => a.zone !== z.id).map(a => {
        const d = Math.min(...pts.map(p => Math.hypot(p.x - a.x, p.y - a.y)));
        return { ant: a, d, p: 0.35 * Math.max(0, 1 - d / 240), rssi: -60 - d / 14 };
      }).filter(n => n.p > 0.02);
    }

    const reads = [], sales = [], tags = [];
    function emit(t, epc, ant, rssi) {
      if (t < t0 || t >= endT) return;
      if (outage && ant === outage.ant && t >= outage.from && t < outage.to) return;
      reads.push({ t: Math.round(t * 100) / 100, epc, ant, rssi: Math.round(rssi) });
    }
    function mainRssi(a) { return a.model === 'AN670' ? -38 - R() * 8 : -47 - R() * 10; }
    function readAt(epc, zone, t) {
      for (const a of areaAnts[zone] || []) if (R() < 0.92) emit(t + R() * 0.6, epc, a.id, mainRssi(a));
      for (const n of neighbours[zone] || []) if (R() < n.p) emit(t + R() * 0.6, epc, n.ant.id, n.rssi + (R() - 0.5) * 6);
    }
    function stray(epc, zone, t) {
      const ns = neighbours[zone] || [];
      if (ns.length) emit(t, epc, pick(ns).ant.id, -62 - R() * 6);
    }
    function crossPortal(epc, portal, dir, t) {
      const pa = portalAnts[portal];
      if (!pa) return;
      const seq = dir === 'out' ? [pa.inner, pa.outer] : [pa.outer, pa.inner];
      for (let i = 0; i < 3; i++) emit(t + i * 0.4, epc, seq[0].id, -44 - R() * 10);
      for (let i = 0; i < 3; i++) emit(t + 2 + i * 0.4, epc, seq[1].id, -44 - R() * 10);
    }

    /* ---------- items and their true zones ---------- */
    const items = [];
    const resting = new Map(config.zones.map(z => [z.id, new Set()]));
    let serial = 0;
    function newItem(sku, size, zone, t) {
      const c = catBySku.get(sku);
      const sizeIdx = c.sizes.indexOf(size);
      serial++;
      const epc = ('3034F2A1' + sku.padStart(4, '0') + String(sizeIdx + 1).padStart(2, '0') + serial.toString(16).toUpperCase().padStart(10, '0')).slice(0, 24);
      const it = { epc, sku, size, home: c.zone, zone: null, rest: false, seg: [] };
      items.push(it);
      tags.push({ epc, sku, size });
      moveTo(it, zone, t, false, true);
      return it;
    }
    function moveTo(it, zone, t, active, burst) {
      if (it.rest && it.zone && resting.has(it.zone)) resting.get(it.zone).delete(it);
      if (burst && it.zone && zone && it.zone !== zone && R() < 0.25) stray(it.epc, it.zone, t - 2);
      it.zone = zone; it.rest = !active;
      it.seg.push({ zone, t, active, burst: burst !== false });
      if (it.rest && zone && resting.has(zone)) resting.get(zone).add(it);
    }
    function settle(it, t) { if (!it.rest) moveTo(it, it.zone, t, false, false); }

    const q = new Heap();
    const at = (t, fn) => { if (t < endT) q.push({ t, fn }); };

    // Opening stock, counted as the readers start up before opening.
    for (const c of catalogue) {
      for (const sz of c.sizes) {
        let fl = c.face + (R() < 0.5 ? 1 : 0);
        if (R() < 0.15) fl = Math.max(0, c.face - 2);
        if (R() < 0.04) fl = 0;
        const bq = R() < 0.1 ? 0 : 2 + Math.floor(R() * 7);
        for (let i = 0; i < fl; i++) newItem(c.sku, sz, c.zone, t0 + R() * 480);
        for (let i = 0; i < bq; i++) newItem(c.sku, sz, 'boh', t0 + R() * 480);
      }
    }
    // Opening stock may be created out of time order; segments are sorted per item later.

    // Delivery through the service door (not instrumented): new tags appear in the stockroom.
    at(10 * 3600 + 40 * 60, t => {
      for (let i = 0; i < 70; i++) {
        const c = pick(catalogue);
        newItem(c.sku, pick(c.sizes), 'boh', t + i * 4);
      }
    });

    const meta = { shoppers: 0, buyers: 0, frVisits: 0, unpaid: 0, outage };
    let txn = 1000;

    function takeFrom(zone) {
      const set = resting.get(zone);
      if (!set || !set.size) return null;
      const arr = Array.from(set);
      return pick(arr);
    }
    function otherFloorZone(not) {
      const zs = PICK_ZONES.map(p => p[0]).filter(z => z !== not);
      return pick(zs);
    }

    function shopper(tStart, unpaid) {
      meta.shoppers++;
      const k = wpick([[1, 0.4], [2, 0.3], [3, 0.2], [4, 0.1]]);
      const carried = [];
      let picks = 0;
      const step = t => {
        if (picks >= k) { decide(t); return; }
        picks++;
        const zone = wpick(PICK_ZONES);
        carried.forEach(it => moveTo(it, zone, t, true, true));
        const it = takeFrom(zone);
        if (it) { moveTo(it, zone, t, true, false); carried.push(it); }
        at(t + rnd(40, 150), step);
      };
      const decide = t => {
        if (!carried.length) return;
        if (unpaid) {
          meta.unpaid++;
          at(t + rnd(30, 60), tt => carried.forEach(it => { crossPortal(it.epc, 'entrance', 'out', tt); moveTo(it, null, tt + 3, true, false); }));
          return;
        }
        const clothing = carried.some(it => it.home !== 'accessories');
        if (clothing && R() < 0.45) {
          meta.frVisits++;
          const tin = t + rnd(30, 60);
          at(tin, tt => carried.forEach(it => moveTo(it, 'fitting', tt, true, true)));
          at(tin + rnd(240, 720), tt => finish(tt, true));
        } else {
          finish(t + rnd(20, 60), false);
        }
      };
      const finish = (t, fr) => {
        const bought = [];
        for (const it of carried) {
          if (R() < (fr ? 0.45 : 0.38)) { bought.push(it); continue; }
          const r = R();
          if (fr && r < 0.55) settle(it, t);
          else if (r < (fr ? 0.85 : 0.85)) at(t + rnd(60, 120), tt => moveTo(it, it.home, tt, false, true));
          else at(t + rnd(60, 120), tt => moveTo(it, otherFloorZone(it.home), tt, false, true));
        }
        if (!bought.length) return;
        meta.buyers++;
        const tc = t + rnd(60, 180);
        at(tc, tt => {
          bought.forEach(it => moveTo(it, 'cashwrap', tt, true, true));
          const dwell = rnd(60, 150);
          const id = 'T' + (txn++);
          const reg = R() < 0.6 ? 'R1' : 'R2';
          bought.forEach((it, i) => {
            const c = catBySku.get(it.sku);
            sales.push({ t: Math.round(tt + dwell - 10 + i), epc: it.epc, sku: it.sku, size: it.size, price: c.price, register: reg, txn: id });
          });
          at(tt + dwell + rnd(40, 120), tx => bought.forEach(it => { crossPortal(it.epc, 'entrance', 'out', tx); moveTo(it, null, tx + 3, true, false); }));
        });
      };
      at(tStart + rnd(30, 90), step);
    }

    const unpaidAt = opts.unpaidTimes || [16 * 3600 + 10 * 60, 19 * 3600 + 40 * 60];
    for (let h = 10; h <= 21; h++) {
      const n = Math.round(HOUR_WEIGHT[h] * shopperBase * (0.85 + R() * 0.3));
      for (let i = 0; i < n; i++) {
        const t = h * 3600 + R() * (h === 21 ? 2700 : 3600);
        at(t, tt => shopper(tt, false));
      }
    }
    unpaidAt.forEach(t => at(t, tt => shopper(tt, true)));

    // Associates sweep the fitting rooms every 25 to 50 minutes.
    let sweep = store.open + 1800;
    while (sweep < store.close) {
      at(sweep, t => {
        let j = 0;
        for (const it of Array.from(resting.get('fitting'))) {
          const last = it.seg[it.seg.length - 1];
          if (t - last.t < 300) continue;
          at(t + 20 + j++ * 12, tt => { if (it.rest && it.zone === 'fitting') moveTo(it, it.home, tt, false, true); });
        }
      });
      sweep += rnd(1500, 3000);
    }

    // Replenishment rounds through the stockroom door.
    const rounds = opts.replenRounds || [11.5, 13.75, 16, 18.25, 20.5].map(h => h * 3600);
    rounds.forEach(tr => at(tr, t => {
      let j = 0;
      for (const c of catalogue) {
        for (const sz of c.sizes) {
          const onFloor = Array.from(resting.get(c.zone)).filter(it => it.sku === c.sku && it.size === sz).length;
          let need = c.face - onFloor;
          if (need <= 0) continue;
          const back = Array.from(resting.get('boh')).filter(it => it.sku === c.sku && it.size === sz);
          while (need-- > 0 && back.length) {
            const it = back.shift();
            const tc = t + j++ * 3;
            crossPortal(it.epc, 'boh-door', 'out', tc);
            moveTo(it, '_transit', tc, true, false);
            at(tc + rnd(40, 140), tt => moveTo(it, it.home, tt, false, true));
          }
        }
      }
    }));

    // Late back-stock: some clearance goes back to the stockroom.
    at(21 * 3600 + 20 * 60, t => {
      const back = Array.from(resting.get('clearance')).slice(0, 8);
      back.forEach((it, j) => {
        const tc = t + 60 + j * 3;
        moveTo(it, '_transit', tc - 30, true, false);
        crossPortal(it.epc, 'boh-door', 'in', tc);
        moveTo(it, 'boh', tc + 5, false, true);
      });
    });

    while (q.size()) { const e = q.pop(); e.fn(e.t); }

    /* ---------- turn true zones into reads ---------- */
    for (const it of items) {
      it.seg.sort((a, b) => a.t - b.t);
      for (let i = 0; i < it.seg.length; i++) {
        const s = it.seg[i];
        const end = i + 1 < it.seg.length ? it.seg[i + 1].t : endT;
        if (!s.zone || s.zone[0] === '_' || end <= s.t) continue;
        let t = s.t;
        if (s.burst) { for (let k = 0; k < 3; k++) if (s.t + k * 2 < end) readAt(it.epc, s.zone, s.t + k * 2); t = s.t + 4; }
        if (s.active) {
          for (t += rnd(5, 15); t < end; t += rnd(10, 20)) readAt(it.epc, s.zone, t);
        } else {
          for (t = s.burst ? s.t + HB * (0.5 + R()) : (i === 0 ? s.t : s.t + R() * HB); t < end; t += HB * (0.85 + R() * 0.3)) {
            readAt(it.epc, s.zone, t);
            if (R() < 0.015) stray(it.epc, s.zone, t + rnd(30, 200));
          }
        }
      }
    }

    // A fixed reference tag beside each doorway antenna, read every 5 minutes, proves the antenna is alive
    // between crossings. The engine uses it for antenna health and leaves it out of stock.
    config.antennas.filter(a => a.portal).forEach((a, i) => {
      const epc = 'FFFF' + String(i + 1).padStart(20, '0');
      for (let t = t0 + R() * 300; t < endT; t += 300) emit(t, epc, a.id, -40 - R() * 4);
    });

    reads.sort((a, b) => a.t - b.t);
    sales.sort((a, b) => a.t - b.t);
    return { tags, reads, sales, meta, truth: items };
  }

  return { simulate, mulberry32 };
});
