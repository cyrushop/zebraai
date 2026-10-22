// Synthetic fixtures only: this repo is public, never put real exports here.
// Run: node tests/pc-engine.test.js
'use strict';
const assert = require('assert');
const E = require('../app/pc-engine.js');

const H = ['PC Source', 'Price Concession: Created Date', 'Approved/ Rejected Date', 'PC #', 'Price Concession Name',
  'Status', 'Sales Stage', 'Siebel Account Number', 'Account Name', 'Reseller', 'Distributor',
  'Product: Product Conversion Source', 'Product Line', 'Product: Product Sub Line', 'Product Family',
  'Product: Product Sub Family', 'Line Item Reseller: Product', 'Min Qty', 'Max Qty', 'Siebel List Price (converted)',
  'Unit Special Price (converted)', 'Opportunity Number', 'Discount', 'Fulfillment Type', 'Owner Sub Region'];

const EMC = { bu: 'EVM', line: 'Mobile Computing', sub: 'Knowledge Worker', fam: 'TC53XX' };
const ACC = { bu: 'EVM', line: 'Mobile Computing', sub: 'Knowledge Worker', fam: 'BTRY-ENT-ACC' };
const ADC = { bu: 'EVM', line: 'Adv Data Capture', sub: 'General Purpose HandHeld', fam: 'DS227X' };
const PRN = { bu: 'AIT', line: 'Desktop', sub: '4 Inch Line', fam: 'ZD421' };
const RF33 = { bu: 'EVM', line: 'RFID Devices', sub: 'RFID HH Readers', fam: 'MC33XXR' };
const RFHH = { bu: 'EVM', line: 'RFID Devices', sub: 'RFID HH Readers', fam: 'RFD4XXX' };
const RFFX = { bu: 'EVM', line: 'RFID Devices', sub: 'RFID Fixed Readers', fam: 'FX96XX' };

let pcNo = 1000;
const row = (acct, created, part, prod, list, unit, extra) => {
  const o = Object.assign({
    'PC Source': 'Sales PC', 'Price Concession: Created Date': created, 'Approved/ Rejected Date': created + ' 10:00',
    'PC #': String(++pcNo), 'Status': 'Expired', 'Sales Stage': 'Closed - Won', 'Siebel Account Number': acct[0],
    'Account Name': acct[1], 'Reseller': 'Partner A', 'Distributor': 'VAD A', 'Product: Product Conversion Source': prod.bu,
    'Product Line': prod.line, 'Product: Product Sub Line': prod.sub, 'Product Family': prod.fam,
    'Product: Product Sub Family': prod.fam, 'Line Item Reseller: Product': part, 'Min Qty': 1, 'Max Qty': 10,
    'Siebel List Price (converted)': list, 'Unit Special Price (converted)': unit, 'Opportunity Number': 'Z-' + pcNo, 'Discount': 30,
    'Fulfillment Type': 'Distributor Sales Out', 'Owner Sub Region': acct[2] || 'Hong Kong'
  }, extra);
  o['Price Concession Name'] = o['PC #'] + ' : ' + acct[1];
  return o;
};
const A = ['100', 'Alpha Logistics Limited'];
const B = ['200', 'Beta Retail'];
const C = ['300', 'Gamma Freight', 'Taiwan'];

// Default events: 2026-03-19 (EMC 15% only) and 2026-10-05 (all categories).
const objs = [
  // EMC: June PC kept the January price → March not passed on, October pending → 15% twice
  row(A, '10/01/2026', 'TC53-X', EMC, 1000, 600),
  row(A, '10/06/2026', 'TC53-X', EMC, 1150, 600),
  // ADC: raised 2% in July ahead of October → RP 1%, ~3% in total
  row(A, '01/02/2026', 'DS2278-X', ADC, 200, 100),
  row(A, '01/07/2026', 'DS2278-X', ADC, 200, 102),
  // Printer: raised 3% on a PC after October → RP 1%; standard discount 40%
  row(A, '01/09/2026', 'ZD421-X', PRN, 500, 300, { 'Discount': 40 }),
  row(A, '08/10/2026', 'ZD421-X', PRN, 515, 309, { 'Discount': 40 }),
  // RFID MC33xxR: no March increase, October pending → 15%
  row(A, '01/05/2026', 'MC333R-X', RF33, 2300, 1500),
  // RFID HH reader, raised in 2025 only → not ahead of October, full 5%
  row(A, '01/03/2025', 'RFD40-X', RFHH, 900, 500),
  row(A, '01/09/2025', 'RFD40-X', RFHH, 900, 520),
  // RFID fixed: first PC after October → RP 3%
  row(A, '12/10/2026', 'FX9600-X', RFFX, 1500, 1000),
  // EMC accessory: no rule → list change since last PC (B's newer PC shows +5%)
  row(A, '01/04/2026', 'BTRY-X', ACC, 100, 50),
  row(B, '15/10/2026', 'BTRY-X', ACC, 105, 60),
  // Rejected PC must not become the baseline
  row(A, '01/08/2026', 'TC53-X', EMC, 1150, 550, { 'Status': 'Rejected' }),
  // Pending PC only counts when the setting allows it
  row(A, '20/10/2026', 'DS2278-X', ADC, 208, 104, { 'Status': 'Pending' }),
  // EMC for B: first PC after October → RP (EMC 15%)
  row(B, '10/10/2026', 'TC53-X', EMC, 1322.5, 700),
  // EMC for C: raised for March, then an October PC at the same price → October still owed
  row(C, '15/01/2026', 'TC53-X', EMC, 1000, 900),
  row(C, '13/05/2026', 'TC53-X', EMC, 1150, 990),
  row(C, '09/10/2026', 'TC53-X', EMC, 1322.5, 990)
];
// a verbatim duplicate line (the export repeats some)
objs.push(Object.assign({}, objs[0]));

const table = { name: 'pc', headers: H, rows: objs.map(o => H.map(h => o[h] ?? null)) };

// detection
assert.ok(E.isPcHeader(H));
assert.ok(!E.isPcHeader(['Opportunity Number', 'Product Name']));
assert.strictEqual(E.tableFromGrid([['report'], H].concat(table.rows), 'g').rows.length, objs.length);

const rows = E.normPc(table);
assert.strictEqual(rows.length, objs.length - 1, 'duplicate line removed');
const idx = E.buildIndex(rows);
assert.deepStrictEqual([...new Set(rows.map(x => x.region))].sort(), ['Hong Kong', 'Taiwan']);
const tw = E.buildIndex(rows.filter(x => x.region === 'Taiwan'), rows);
assert.strictEqual(tw.accounts.length, 1, 'region subset indexes on its own');
assert.strictEqual(tw.latestList['ZD421-X'].list, 515, 'list price comes from every region');
assert.strictEqual(E.buildIndex(rows.filter(x => x.region === 'Taiwan')).latestList['ZD421-X'], undefined);
const R = E.DEFAULT_RULES;
const get = (acct, p, rules) => E.assess(idx, (idx.byAcct[acct] || []).filter(r => r.part === p), rules || R, p);

// categories
const cat = p => idx.info[p].cat;
assert.strictEqual(cat('TC53-X'), 'emc');
assert.strictEqual(cat('BTRY-X'), 'emcAcc');
assert.strictEqual(cat('DS2278-X'), 'adc');
assert.strictEqual(cat('ZD421-X'), 'ait');
assert.strictEqual(cat('MC333R-X'), 'rfid15');
assert.strictEqual(cat('RFD40-X'), 'rfidHH');
assert.strictEqual(cat('FX9600-X'), 'rfidFixed');

const kinds = r => r.steps.map(x => x.event.id + ':' + x.kind);

// EMC: March not passed on + October pending → 1.15 × 1.15; the rejected 550 PC is ignored
let r = get('100', 'TC53-X');
assert.strictEqual(r.state, 'full');
assert.strictEqual(r.last.unit, 600);
assert.deepStrictEqual(kinds(r), ['e2026-03:notRaised', 'e2026-10:pending']);
assert.strictEqual(r.rate, 32.25);
assert.strictEqual(r.suggested, 793.5);
assert.strictEqual(r.history.length, 3, 'history keeps the rejected PC');

// ADC raised ahead of October → RP 1%, 3.02% since the February price
r = get('100', 'DS2278-X');
assert.strictEqual(r.state, 'repeat');
assert.deepStrictEqual(kinds(r), ['e2026-10:early']);
assert.strictEqual(r.rate, 1);
assert.strictEqual(r.suggested, 103.02);
assert.ok(Math.abs(r.cumulative - 0.0302) < 1e-9);

// pending PC as baseline when allowed: after October and above July → RP
r = get('100', 'DS2278-X', Object.assign({}, R, { includePending: true }));
assert.strictEqual(r.last.unit, 104);
assert.deepStrictEqual(kinds(r), ['e2026-10:raised']);
assert.strictEqual(r.rate, 1);

// printer raised after October → RP 1%; above the new standard net → no PC needed
r = get('100', 'ZD421-X');
assert.strictEqual(r.state, 'repeat');
assert.deepStrictEqual(kinds(r), ['e2026-10:raised']);
assert.strictEqual(r.suggested, 312.09);
assert.strictEqual(r.newStdNet, 309);
assert.strictEqual(r.aboveStd, true);

// RFID
r = get('100', 'MC333R-X');
assert.deepStrictEqual(kinds(r), ['e2026-10:pending']);
assert.strictEqual(r.rate, 15);
r = get('100', 'RFD40-X');
assert.strictEqual(r.state, 'full', '2025 rise is not ahead of October');
assert.strictEqual(r.rate, 5);
r = get('100', 'FX9600-X');
assert.strictEqual(r.state, 'repeat');
assert.strictEqual(r.rate, 3);

// no rule → list price change since last PC
r = get('100', 'BTRY-X');
assert.strictEqual(r.state, 'norule');
assert.strictEqual(r.rateSource, 'list');
assert.strictEqual(r.rate, 5);
assert.strictEqual(r.suggested, 52.5);

// EMC first PC after October → RP rate
r = get('200', 'TC53-X');
assert.strictEqual(r.state, 'repeat');
assert.strictEqual(r.rate, 15);

// EMC raised for March, October PC kept the price → October owed
r = get('300', 'TC53-X');
assert.deepStrictEqual(kinds(r), ['e2026-03:raised', 'e2026-10:notRaised']);
assert.strictEqual(r.state, 'full');
assert.strictEqual(r.suggested, 1138.5);
assert.strictEqual(r.cumulativeBase.unit, 900);

// rules without events behave like "no rule"
r = get('100', 'TC53-X', Object.assign({}, R, { events: [], rp: {} }));
assert.strictEqual(r.state, 'norule');

// new part for the customer
r = get('200', 'ZD421-X');
assert.strictEqual(r.state, 'new');

// customer view, search helpers
assert.strictEqual(E.customerParts(idx, '100', R).length, 7);
assert.deepStrictEqual(E.customerParts(idx, '100', R, ['ZD421-X', 'NEW-1']).map(x => x.state), ['repeat', 'new']);
assert.strictEqual(E.findAccounts(idx, 'alpha')[0].key, '100');
assert.strictEqual(E.findAccounts(idx, '200')[0].name, 'Beta Retail');
assert.deepStrictEqual(E.findParts(idx, 'tc53'), ['TC53-X']);
assert.deepStrictEqual(E.parsePartList('zd421-x, TC53-X\nzd421-x\t MC333R-X'), ['ZD421-X', 'TC53-X', 'MC333R-X']);
assert.deepStrictEqual(E.otherCustomers(idx, 'TC53-X', '100', R).map(x => x.acctKey), ['200', '300']);

console.log('pc-engine tests passed');
