// Synthetic values only: this repo is public, never put real customer contacts here.
// Run: node tests/pc-justification.test.js
'use strict';
const assert = require('assert');
const P = require('../app/pc-justification.js');

// ------------------------------------------------------------ new PC text
assert.strictEqual(P.buildNew({
  contact: 'Jane Doe, IT, jane@example.com', demand: 'WMS', zebraProduct: 'TC53',
  competitorBrand: 'Honeywell', competitorModel: 'CT47'
}), [
  '1.    Front-end PC',
  '2.    PC+Rebate: No',
  '3.    Sideway Selling: No',
  '4.    Has Free units Request: No',
  '5.    EMC Market Share Acceleration: No',
  '6.    End-user Invoice Providing: Yes',
  '7.    Margin Information：',
  '    a.  Distributor Margin：5%',
  '    b.  Reseller Margin：12%',
  '8.    Bundle Service: Yes',
  'Customer Contact Information：Jane Doe, IT, jane@example.com',
  '9.    Annual Agreement: No',
  '10.  Customer Demand：WMS',
  '11.  Zebra Product & Solution：TC53',
  '12.  Competitor & Model：Honeywell CT47',
  '13.  Other Comments & Update: Nil',
  '14.  Attachment: Nil'
].join('\n'));

// --------------------------------------------------------- repeat PC text
assert.strictEqual(P.buildRepeat({
  previousPc: ' 12345678 ', contact: 'John Roe, Engr, 2000 0000, john@example.com', resellerMargin: '15%'
}), [
  '1.    Previous Repeat PC#: 12345678',
  '2.    Front-end PC',
  '3.    PC+Rebate: No',
  '4.    Sideway Selling: No',
  '5.    Has Free units Request: No',
  '6.    EMC Market Share Acceleration: No',
  '7.    End-user Invoice Providing: Yes',
  '8.    Margin Information：',
  '    a.  Distributor Margin：5%',
  '    b.  Reseller Margin：15%',
  '9.    Bundle Service: Yes',
  'Customer Contact Information：John Roe, Engr, 2000 0000, john@example.com',
  '10.  Annual Agreement: No'
].join('\n'));

// Toggles and blanks.
const t = P.buildNew({ pcRebate: true, invoice: false, otherComments: '  ' });
assert.ok(t.includes('PC+Rebate: Yes'));
assert.ok(t.includes('End-user Invoice Providing: No'));
assert.ok(t.includes('Competitor & Model：Nil'));
assert.ok(t.includes('Other Comments & Update: Nil'));

// ------------------------------------------------------------ categories
const cat = m => (P.category(m) || {}).key;
assert.strictEqual(cat('TC53'), 'touch-mid');
assert.strictEqual(cat('tc58e'), 'touch-mid');
assert.strictEqual(cat('TC530K-1HEA6AP'), 'touch-mid');
assert.strictEqual(cat('Zebra TC22'), 'touch-entry');
assert.strictEqual(cat('TC78'), 'touch-ultra');
assert.strictEqual(cat('MC3400'), 'keypad');
assert.strictEqual(cat('MC3390R'), 'rfid');
assert.strictEqual(cat('MC3390xR'), 'rfid');
assert.strictEqual(cat('MC9400'), 'keypad-ultra');
assert.strictEqual(cat('RFD40'), 'rfid');
assert.strictEqual(cat('ET40'), 'tablet');
assert.strictEqual(cat('ZD421'), 'printer-desktop');
assert.strictEqual(cat('ZT411'), 'printer-industrial');
assert.strictEqual(cat('ZQ630'), 'printer-mobile');
assert.strictEqual(cat('ZC300'), 'printer-card');
assert.strictEqual(cat('DS2208'), 'scanner');
assert.strictEqual(cat('DS3678'), 'scanner-rugged');
assert.strictEqual(cat('FX9600'), 'fixedrfid');
assert.strictEqual(cat('XYZ'), undefined);
assert.strictEqual(cat(''), undefined);

// Every category has an entry and only known brands.
P.CATEGORIES.forEach(c => {
  assert.ok(P.COMPETITORS[c.key], 'missing competitors for ' + c.key);
  Object.keys(P.COMPETITORS[c.key]).forEach(b => assert.ok(P.BRANDS.includes(b), c.key + ': ' + b));
});

// ------------------------------------------------------------- suggestions
assert.deepStrictEqual(P.splitProducts('TC53, ZD421 / DS2208 + MC3400，ET40'), ['TC53', 'ZD421', 'DS2208', 'MC3400', 'ET40']);
const s = P.suggest('TC53, ZD421, ZC300', 'Honeywell');
assert.strictEqual(s.length, 3);
assert.strictEqual(s[0].options[0].model, 'CT47');
assert.strictEqual(s[1].options[0].model, 'PC45');
assert.deepStrictEqual(s[2].options, []);
assert.strictEqual(P.suggest('TC53', 'Urovo')[0].options[0].model, 'DT50');
assert.strictEqual(P.suggest('MC3400', 'TSC')[0].options[0].model, 'Bluebird EK430');
assert.strictEqual(P.suggest('RFD40', 'Chainway')[0].options[0].model, 'C72');
assert.deepStrictEqual(P.suggest('', 'Honeywell'), []);

console.log('pc-justification tests passed');
