// Synthetic fixtures only: this repo is public, never put real exports here.
// Run: node tests/rfid-engine.test.js
'use strict';
const assert = require('assert');
const C = require('../rfid/config.js');
const E = require('../rfid/engine.js');
const Sim = require('../rfid/sim.js');

let passed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('ok   ' + name); }
  catch (e) { console.error('FAIL ' + name); console.error(e); process.exitCode = 1; }
}

const OPEN = 10 * 3600;
const cat = [{ sku: '526', name: 'Mesh polo', color: 'Navy', zone: 'polo', cat: "Men's polo", price: 690, face: 2, sizes: ['M'] }];
const EPC = 'E1';
const tags = [{ epc: EPC, sku: '526', size: 'M' }];
function engine(extra) {
  const cfg = C.defaultConfig();
  Object.assign(cfg.params, extra || {});
  return E.createEngine(cfg, { catalogue: cat, tags, baselineUntil: OPEN });
}
const rd = (t, ant, rssi, epc) => ({ t, epc: epc || EPC, ant, rssi });

test('first read places the item in the zone of the strongest antenna', () => {
  const e = engine();
  e.load({ reads: [rd(OPEN - 100, 'A4', -50), rd(OPEN - 100.2, 'A5', -68)] });
  e.runTo(OPEN);
  assert.strictEqual(e.item(EPC).zone, 'polo');
});

test('a single weak stray read does not move an item', () => {
  const e = engine();
  e.load({ reads: [rd(OPEN - 100, 'A4', -50), rd(OPEN + 200, 'A5', -66)] });
  e.runTo(OPEN + 400);
  assert.strictEqual(e.item(EPC).zone, 'polo');
  assert.strictEqual(e.state.movements.length, 0);
});

test('a new zone that wins two windows in a row moves the item and logs a movement', () => {
  const e = engine();
  e.load({ reads: [rd(OPEN - 100, 'A4', -50), rd(OPEN + 201, 'A5', -63), rd(OPEN + 212, 'A5', -63)] });
  e.runTo(OPEN + 400);
  assert.strictEqual(e.item(EPC).zone, 'mens');
  assert.deepStrictEqual(e.state.movements.map(m => [m.from, m.to]), [['polo', 'mens']]);
});

test('a strong win in one window moves the item at once', () => {
  const e = engine();
  e.load({ reads: [rd(OPEN - 100, 'A4', -50), rd(OPEN + 201, 'A4', -70), rd(OPEN + 201.5, 'B5', -48)] });
  e.runTo(OPEN + 400);
  assert.strictEqual(e.item(EPC).zone, 'womens');
});

test('stockroom door: inner then outer is stockroom to floor, outer then inner is the reverse', () => {
  const e = engine();
  e.load({ reads: [rd(OPEN + 10, 'A2', -50), rd(OPEN + 12, 'A3', -50), rd(OPEN + 500, 'A3', -50), rd(OPEN + 502, 'A2', -50)] });
  e.runTo(OPEN + 600);
  assert.deepStrictEqual(e.state.portalEvents.map(p => p.portal + ':' + p.dir), ['boh-door:out', 'boh-door:in']);
  const f = e.flow();
  assert.strictEqual(f.portals['boh-door'].out, 1);
  assert.strictEqual(f.portals['boh-door'].in, 1);
});

test('portal reads too far apart or too weak give no direction', () => {
  const e = engine();
  e.load({ reads: [rd(OPEN + 10, 'A2', -50), rd(OPEN + 30, 'A3', -50), rd(OPEN + 100, 'A2', -50), rd(OPEN + 101, 'A3', -72)] });
  e.runTo(OPEN + 200);
  assert.strictEqual(e.state.portalEvents.length, 0);
});

test('leaving through the entrance unsold raises an unpaid-exit alert; sold does not', () => {
  const e = engine();
  const reads = [rd(OPEN + 5, 'A4', -50), rd(OPEN + 5, 'A4', -50, 'E2'),
    rd(OPEN + 100, 'B7', -50), rd(OPEN + 102, 'B8', -50),
    rd(OPEN + 300, 'B7', -50, 'E2'), rd(OPEN + 302, 'B8', -50, 'E2')];
  e.load({ reads, sales: [{ t: OPEN + 250, epc: 'E2', sku: '526', size: 'M', price: 690 }], tags: [{ epc: 'E2', sku: '526', size: 'M' }] });
  e.runTo(OPEN + 400);
  const unpaid = e.alerts().filter(a => a.type === 'unpaid-exit');
  assert.strictEqual(unpaid.length, 1);
  assert.strictEqual(e.item(EPC).left, true);
  assert.strictEqual(e.kpis().sold, 1);
  assert.strictEqual(e.kpis().onHand, 0);
});

test('tags first seen in the stockroom after opening count as received', () => {
  const e = engine();
  e.load({ reads: [rd(OPEN - 50, 'A1', -50), rd(OPEN + 900, 'A1', -50, 'E3')], tags: [{ epc: 'E3', sku: '526', size: 'M' }] });
  e.runTo(OPEN + 1000);
  assert.strictEqual(e.flow().received, 1);
});

test('inventory splits floor and stockroom; replenishment suggests what the stockroom can cover', () => {
  const e = engine();
  e.load({
    reads: [rd(OPEN - 60, 'A1', -50, 'B1'), rd(OPEN - 60, 'A1', -50, 'B2'), rd(OPEN - 60, 'A1', -50, 'B3')],
    tags: ['B1', 'B2', 'B3'].map(epc => ({ epc, sku: '526', size: 'M' }))
  });
  e.runTo(OPEN + 60);
  const row = e.inventory().find(r => r.key === '526|M');
  assert.strictEqual(row.floor, 0);
  assert.strictEqual(row.boh, 3);
  const rep = e.replenishment();
  assert.strictEqual(rep.length, 1);
  assert.strictEqual(rep[0].suggest, 2);
  assert.ok(e.alerts().some(a => a.type === 'floor-empty'));
});

test('an antenna with no reads for 10 minutes while open is flagged', () => {
  const e = engine();
  e.load({ reads: [rd(OPEN + 10, 'A4', -50)] });
  e.runTo(OPEN + 1800);
  const st = e.antennaStats();
  assert.strictEqual(st.find(a => a.id === 'A4').status, 'silent');
  assert.ok(e.alerts().some(a => a.type === 'antenna-silent'));
});

test('items left in the fitting room over 15 minutes are flagged', () => {
  const e = engine();
  e.load({ reads: [rd(OPEN + 10, 'A4', -50), rd(OPEN + 100, 'A7', -48), rd(OPEN + 100.5, 'A8', -50)] });
  e.runTo(OPEN + 100 + 16 * 60);
  assert.strictEqual(e.item(EPC).zone, 'fitting');
  assert.strictEqual(e.flow().fr.leftNow, 1);
  assert.ok(e.alerts().some(a => a.type === 'left-fr'));
});

test('reference tags keep a doorway antenna healthy but are not stock', () => {
  const e = engine();
  const reads = [];
  for (let t = OPEN; t < OPEN + 1800; t += 300) reads.push(rd(t, 'A2', -42, 'FFFF00000000000000000001'));
  e.load({ reads });
  e.runTo(OPEN + 1800);
  assert.strictEqual(e.antennaStats().find(a => a.id === 'A2').status, 'ok');
  assert.strictEqual(e.state.items.size, 0);
});

test('runTo refuses to go back in time', () => {
  const e = engine();
  e.runTo(OPEN);
  assert.throws(() => e.runTo(OPEN - 1));
});

test('simulated day: engine zones match the simulator at close and flow adds up', () => {
  const cfg = C.defaultConfig();
  const d = Sim.simulate(cfg, C.CATALOGUE, { seed: 7 });
  const e = E.createEngine(cfg, { catalogue: C.CATALOGUE, tags: d.tags });
  e.load(d);
  e.runTo(cfg.store.close + 600);
  let ok = 0, n = 0;
  for (const it of d.truth) {
    const last = it.seg[it.seg.length - 1];
    if (!last.zone || last.zone[0] === '_') continue;
    n++;
    if (e.item(it.epc).zone === last.zone) ok++;
  }
  assert.ok(n > 200);
  assert.ok(ok / n > 0.97, `zone match ${ok}/${n}`);
  const f = e.flow();
  assert.strictEqual(f.portals.entrance.out, d.sales.length + e.alerts().filter(a => a.type === 'unpaid-exit').reduce((a, x) => a + (parseInt(x.title, 10) || 1), 0));
  assert.strictEqual(f.received, 70);
  assert.strictEqual(f.hourly.reduce((a, h) => a + h.moves, 0), f.totalMoves);
});

console.log(`\n${passed} passed`);
