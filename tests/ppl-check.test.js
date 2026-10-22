// Synthetic fixtures only: this repo is public, never put real exports here.
// Run: node tests/ppl-check.test.js
'use strict';
const assert = require('assert');
const P = require('../ppl/ppl-check.js');

const H = ['Opportunity Number', 'Opportunity Name', 'Opportunity Owner', 'Opportunity Record Type', 'Sales Stage',
  'Commit Category', 'Last Modified Date', 'First Ship Date', 'Schedule Amount (converted)', 'Forecast Notes',
  'Fulfillment Type', 'Customer Requested Ship Date', 'First Ship Fiscal Quarter New', 'Reseller has ordered via Distribution'];
const row = o => H.map(h => o[h] ?? '');
const base = (opp, extra) => Object.assign({
  'Opportunity Number': opp, 'Opportunity Name': 'Opp ' + opp, 'Opportunity Owner': 'Owner A',
  'Opportunity Record Type': 'Zebra Opportunity', 'Sales Stage': 'Secure', 'Commit Category': 'Commit',
  'Last Modified Date': '20/10/2026', 'First Ship Date': '30/11/2026', 'Schedule Amount (converted)': '1,000',
  'Forecast Notes': '', 'Fulfillment Type': 'Disti Stock', 'Customer Requested Ship Date': '15/11/2026',
  'First Ship Fiscal Quarter New': '2026 Q4', 'Reseller has ordered via Distribution': '1'
}, extra);

// Two title lines above the header, as in some SFDC report views.
const grid = [['My Pipeline'], ['Filtered by: Me'], H,
  row(base('Z-OK')),
  row(base('Z-1', { 'Commit Category': 'Upside' })),                                                  // 1
  row(base('Z-2', { 'Sales Stage': 'Qualify', 'Commit Category': '', 'Last Modified Date': '01/06/2026' })), // 2
  row(base('Z-2b', { 'Sales Stage': 'Qualify', 'Commit Category': '', 'Last Modified Date': '01/04/2026' })), // before 2026-05: no 2
  row(base('Z-3', { 'First Ship Date': '15/10/2026', 'Customer Requested Ship Date': '01/10/2026' })),   // 3
  row(base('Z-4', { 'Schedule Amount (converted)': '30,000' })),
  row(base('Z-4', { 'Schedule Amount (converted)': '25,000' })),                                       // 4: 55k across lines
  row(base('Z-5', { 'Fulfillment Type': '' })),                                                        // 5
  row(base('Z-6', { 'Sales Stage': 'Closed - Won', 'Commit Category': 'Shipped/booked',
    'Customer Requested Ship Date': '01/10/2026' })),                                                  // 6 (+7c? no: crsd past, same Q)
  row(base('Z-7a', { 'Customer Requested Ship Date': '' })),                                           // 7 empty
  row(base('Z-7b', { 'Customer Requested Ship Date': '15/01/2027' })),                                 // 7 other quarter
  row(base('Z-7c', { 'Sales Stage': 'Closed - Won', 'Commit Category': 'Shipped/booked',
    'First Ship Date': '20/10/2026', 'Customer Requested Ship Date': '30/10/2026' })),                 // 7 crsd not past
  row(base('Z-old', { 'First Ship Date': '15/12/2025', 'Fulfillment Type': '' })),                     // before 2026: not checked
  row(base('Z-rt', { 'Opportunity Record Type': 'Partner Opportunity', 'Fulfillment Type': '' })),     // other record type
  row(base('Z-lost', { 'Sales Stage': 'Closed - Lost', 'Fulfillment Type': '' })),                     // not a checked stage
  row(base('Z-S0', { 'Reseller has ordered via Distribution': '0', 'Schedule Amount (converted)': '700' })),
  row(base('Z-S0', { 'Reseller has ordered via Distribution': '0', 'Schedule Amount (converted)': '300' }))
];

const today = '2026-10-22';   // Thursday → cutoff Wednesday 2026-10-28
assert.strictEqual(P.nextWednesday(today), '2026-10-28');
assert.strictEqual(P.nextWednesday('2026-10-28'), '2026-10-28', 'a Wednesday is its own cutoff');

const rows = P.prepare(grid);
assert.strictEqual(rows[0][0], 'Opportunity Number', 'title lines are skipped');
assert.strictEqual(rows[1][7], '2026-11-30', 'dd/mm/yyyy dates become ISO');

const c = P.check(rows, { today });
const rules = opp => (c.violations.find(v => v.opp === opp) || { issues: [] }).issues.map(i => i.rule);
assert.deepStrictEqual(rules('Z-OK'), []);
assert.deepStrictEqual(rules('Z-1'), [1]);
assert.deepStrictEqual(rules('Z-2'), [2]);
assert.deepStrictEqual(rules('Z-2b'), [], 'edits before 2026-05-01 are not flagged');
assert.deepStrictEqual(rules('Z-3'), [3]);
assert.deepStrictEqual(rules('Z-4'), [4], 'amount is summed per opportunity');
assert.deepStrictEqual(rules('Z-5'), [5]);
assert.deepStrictEqual(rules('Z-6'), [6]);
assert.deepStrictEqual(rules('Z-7a'), [7]);
assert.deepStrictEqual(rules('Z-7b'), [7]);
assert.deepStrictEqual(rules('Z-7c'), [7]);
['Z-old', 'Z-rt', 'Z-lost'].forEach(o => assert.deepStrictEqual(rules(o), [], o + ' is out of scope'));
assert.deepStrictEqual(c.stats, { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 3 });
assert.ok(/[發貨週財]/.test(c.violations[0].issues[0].text + c.violations.map(v => v.issues[0].text).join('')));
assert.ok(!/[发货周财检查违规]/.test(JSON.stringify(c)), 'no simplified Chinese in messages');

// Missing record-type column: everything is checked, with a note.
const noRt = P.prepare([H.filter(h => h !== 'Opportunity Record Type'),
  row(base('Z-x', { 'Fulfillment Type': '' })).filter((_, i) => H[i] !== 'Opportunity Record Type')]);
const c2 = P.check(noRt, { today });
assert.strictEqual(c2.violations.length, 1);
assert.strictEqual(c2.notes.length, 1);

// Pivot and Secure-not-ordered
const pv = P.pivot(rows, { metric: 'rows' });
assert.ok(pv.stageList.indexOf('Closed - Lost') < 0, 'lost excluded by default');
assert.strictEqual(pv.qTotal('2026 Q4'), pv.grandTotal);
const sn = P.secureNotOrdered(rows);
assert.strictEqual(sn.length, 1);
assert.strictEqual(sn[0].amount, 1000);

// SFDC links
const rec = P.sfdcLink('Z-1', '006Ab00000XyZ12AAA');
assert.strictEqual(rec.url, 'https://zebra.lightning.force.com/lightning/r/Opportunity/006Ab00000XyZ12AAA/view');
const srch = P.sfdcLink('Z-0002791255', '');
assert.strictEqual(srch.kind, 'search');
const payload = JSON.parse(Buffer.from(srch.url.split('#')[1], 'base64').toString());
assert.strictEqual(payload.attributes.term, 'Z-0002791255');

console.log('ppl-check tests passed:', c.violations.length, 'flagged opportunities');
