// Synthetic fixtures only: this repo is public, never put real exports here.
// Run: node tests/pc-engine.test.js
'use strict';
const assert = require('assert');
const E = require('../app/pc-engine.js');

const H = ['PC Source', 'Price Concession: Created Date', 'Approved/ Rejected Date', 'PC #', 'Price Concession Name',
  'Status', 'Sales Stage', 'Siebel Account Number', 'Account Name', 'Reseller', 'Distributor',
  'Product: Product Conversion Source', 'Product Line', 'Product: Product Sub Line', 'Product Family',
  'Product: Product Sub Family', 'Line Item Reseller: Product', 'Min Qty', 'Max Qty', 'Siebel List Price (converted)',
  'Unit Special Price (converted)', 'Opportunity Number'];

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
    'Siebel List Price (converted)': list, 'Unit Special Price (converted)': unit, 'Opportunity Number': 'Z-' + pcNo
  }, extra);
  o['Price Concession Name'] = o['PC #'] + ' : ' + acct[1];
  return o;
};
const A = ['100', 'Alpha Logistics Limited'];
const B = ['200', 'Beta Retail'];

const objs = [
  // EMC: last PC before the increase, no uplift → full 15%
  row(A, '10/03/2026', 'TC53-X', EMC, 1000, 600),
  row(A, '10/06/2026', 'TC53-X', EMC, 1000, 600),
  // ADC: raised 2% in July (price) → repeat 1%, cumulative ~3%
  row(A, '01/02/2026', 'DS2278-X', ADC, 200, 100),
  row(A, '01/07/2026', 'DS2278-X', ADC, 200, 102),
  // Printer: last PC after the effective date → repeat 1%
  row(A, '01/09/2026', 'ZD421-X', PRN, 500, 300),
  row(A, '08/10/2026', 'ZD421-X', PRN, 515, 309),
  // RFID MC33xxR, single PC → full 15%
  row(A, '01/05/2026', 'MC333R-X', RF33, 2000, 1500),
  // RFID HH reader, raised in 2025 only → not counted (before liftFrom), full 5%
  row(A, '01/03/2025', 'RFD40-X', RFHH, 900, 500),
  row(A, '01/09/2025', 'RFD40-X', RFHH, 900, 520),
  // RFID fixed: after effective date → repeat 3%
  row(A, '12/10/2026', 'FX9600-X', RFFX, 1500, 1000),
  // EMC accessory: no rule → list change since last PC (B's newer PC shows +5%)
  row(A, '01/04/2026', 'BTRY-X', ACC, 100, 50),
  row(B, '15/10/2026', 'BTRY-X', ACC, 105, 60),
  // Rejected PC must not become the baseline
  row(A, '01/05/2026', 'TC53-X', EMC, 1000, 550, { 'Status': 'Rejected' }),
  // Pending PC only counts when the setting allows it
  row(A, '20/10/2026', 'DS2278-X', ADC, 208, 104, { 'Status': 'Pending' }),
  // EMC for customer B after the increase → repeat has no rule → list change (0) → 0%
  row(B, '10/10/2026', 'TC53-X', EMC, 1150, 700)
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

// EMC, not raised → full 15%; the rejected 550 PC is ignored
let r = get('100', 'TC53-X');
assert.strictEqual(r.state, 'full');
assert.strictEqual(r.last.unit, 600);
assert.strictEqual(r.rate, 15);
assert.strictEqual(r.suggested, 690);
assert.strictEqual(r.history.length, 3, 'history keeps the rejected PC');

// ADC raised by price this year → repeat 1%, cumulative 3.02%
r = get('100', 'DS2278-X');
assert.strictEqual(r.state, 'repeat');
assert.strictEqual(r.reason, 'price');
assert.strictEqual(r.rate, 1);
assert.strictEqual(r.suggested, 103.02);
assert.ok(Math.abs(r.cumulative - 0.0302) < 1e-9);

// pending PC as baseline when allowed: created after the effective date → repeat
r = get('100', 'DS2278-X', Object.assign({}, R, { includePending: true }));
assert.strictEqual(r.last.unit, 104);
assert.strictEqual(r.reason, 'date');

// printer, last PC after the effective date → repeat 1%
r = get('100', 'ZD421-X');
assert.strictEqual(r.state, 'repeat');
assert.strictEqual(r.reason, 'date');
assert.strictEqual(r.rate, 1);
assert.strictEqual(r.suggested, 312.09);

// RFID
assert.strictEqual(get('100', 'MC333R-X').rate, 15);
r = get('100', 'RFD40-X');
assert.strictEqual(r.state, 'full', '2025 uplift does not count');
assert.strictEqual(r.rate, 5);
r = get('100', 'FX9600-X');
assert.strictEqual(r.state, 'repeat');
assert.strictEqual(r.rate, 3);

// no rule → list price change since last PC
r = get('100', 'BTRY-X');
assert.strictEqual(r.rateSource, 'list');
assert.strictEqual(r.rate, 5);
assert.strictEqual(r.suggested, 52.5);

// EMC repeat has no rule → list change (none) → 0%
r = get('200', 'TC53-X');
assert.strictEqual(r.state, 'repeat');
assert.strictEqual(r.rateSource, 'list');
assert.strictEqual(r.rate, 0);

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
assert.deepStrictEqual(E.otherCustomers(idx, 'TC53-X', '100', R).map(x => x.acctKey), ['200']);

console.log('pc-engine tests passed');
