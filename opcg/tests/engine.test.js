// Run: node opcg/tests/engine.test.js   (synthetic data only)
const assert = require('assert');
const E = require('../app/engine.js');

let passed = 0;
const t = (name, fn) => { fn(); passed++; console.log('ok -', name); };

const cards = {
  'OP08-001': { id: 'OP08-001', category: 'LEADER', colors: ['紅', '綠'] },
  'OP08-002': { id: 'OP08-002', category: 'CHARACTER', colors: ['紅'] },
  'OP08-003': { id: 'OP08-003', category: 'CHARACTER', colors: ['綠'] },
  'OP08-040': { id: 'OP08-040', category: 'CHARACTER', colors: ['藍'] },
  'OP09-010': { id: 'OP09-010', category: 'EVENT', color: '紅' },
};

t('normId / baseId', () => {
  assert.strictEqual(E.normId('op08-001'), 'OP08-001');
  assert.strictEqual(E.normId('4xOP08-001_P1'), 'OP08-001_p1');
  assert.strictEqual(E.normId('PRB01-005'), 'PRB01-005');
  assert.strictEqual(E.normId('P-033'), 'P-033');
  assert.strictEqual(E.normId('hello'), '');
  assert.strictEqual(E.baseId('OP08-001_p2'), 'OP08-001');
});

t('quickId shorthand', () => {
  assert.strictEqual(E.quickId('OP09-118', 'OP08'), 'OP09-118');
  assert.strictEqual(E.quickId('08-1', ''), 'OP08-001');
  assert.strictEqual(E.quickId('45', 'OP10'), 'OP10-045');
  assert.strictEqual(E.quickId('001p1', 'OP08'), 'OP08-001_p1');
  assert.strictEqual(E.quickId('7', 'EB02'), 'EB02-007');
  assert.strictEqual(E.quickId('7', ''), '');
});

t('parseDeckText: common formats', () => {
  const r = E.parseDeckText('1xOP08-001\n4 x OP08-002\n3 OP08-003\nOP09-010 x2\nOP08-002 1\nST01-012\nrubbish line');
  assert.deepStrictEqual(r.entries, [
    { id: 'OP08-001', count: 1 }, { id: 'OP08-002', count: 5 }, { id: 'OP08-003', count: 3 },
    { id: 'OP09-010', count: 2 }, { id: 'ST01-012', count: 1 },
  ]);
  assert.deepStrictEqual(r.unknown, ['rubbish line']);
});

t('parseDeckText: deckgen code and URL', () => {
  const a = E.parseDeckText('1nOP08-001a4nOP08-002a2nOP09-010');
  assert.deepStrictEqual(a.entries, [{ id: 'OP08-001', count: 1 }, { id: 'OP08-002', count: 4 }, { id: 'OP09-010', count: 2 }]);
  const b = E.parseDeckText('https://onepiecetopdecks.com/deckgen/?dn=Test&dg=1nOP08-001a4nOP08-002&au=x');
  assert.deepStrictEqual(b.entries, [{ id: 'OP08-001', count: 1 }, { id: 'OP08-002', count: 4 }]);
});

t('parseDeckText: parallels fold unless keepVariants', () => {
  assert.deepStrictEqual(E.parseDeckText('2xOP08-002_p1\n1xOP08-002').entries, [{ id: 'OP08-002', count: 3 }]);
  assert.deepStrictEqual(E.parseDeckText('2xOP08-002_p1\n1xOP08-002', { keepVariants: true }).entries,
    [{ id: 'OP08-002_p1', count: 2 }, { id: 'OP08-002', count: 1 }]);
});

t('deckToText / toDg put the leader first', () => {
  const entries = [{ id: 'OP08-002', count: 4 }, { id: 'OP08-001', count: 1 }];
  assert.strictEqual(E.deckToText(entries, cards), '1xOP08-001\n4xOP08-002');
  assert.strictEqual(E.toDg(entries, cards), '1nOP08-001a4nOP08-002');
});

t('available = owned - reserved by other built decks; parallels optional', () => {
  const state = {
    owned: { 'OP08-002': 5, 'OP08-002_p1': 1, 'OP08-003': 2 },
    decks: [
      { id: 'a', status: 'built', entries: [{ id: 'OP08-002', count: 4 }] },
      { id: 'b', status: 'plan', entries: [{ id: 'OP08-003', count: 4 }] },
      { id: 'c', status: 'sold', entries: [{ id: 'OP08-002', count: 4 }] },
    ],
    settings: { includeParallels: false },
  };
  assert.deepStrictEqual(E.availableTotals(state), { 'OP08-002': 1, 'OP08-003': 2 });
  assert.deepStrictEqual(E.availableTotals(state, 'a'), { 'OP08-002': 5, 'OP08-003': 2 });
  state.settings.includeParallels = true;
  assert.strictEqual(E.availableTotals(state)['OP08-002'], 2);
});

t('deckStatus counts missing cards', () => {
  const st = E.deckStatus([{ id: 'OP08-001', count: 1 }, { id: 'OP08-002', count: 4 }], { 'OP08-001': 1, 'OP08-002': 2 });
  assert.strictEqual(st.need, 5); assert.strictEqual(st.have, 3); assert.strictEqual(st.missing, 2);
  assert.strictEqual(st.rows[1].missing, 2);
  const neg = E.deckStatus([{ id: 'OP08-002', count: 2 }], { 'OP08-002': -3 });
  assert.strictEqual(neg.have, 0);
});

t('validateDeck rules', () => {
  const ok = [{ id: 'OP08-001', count: 1 }, { id: 'OP08-002', count: 4 }, { id: 'OP08-003', count: 4 }];
  for (let i = 100; i < 121; i++) cards['OP08-' + i] = { id: 'OP08-' + i, category: 'CHARACTER', colors: ['紅'] };
  for (let i = 100; i < 121; i++) ok.push({ id: 'OP08-' + i, count: i < 110 ? 2 : 2 });
  // 8 + 42 = 50
  assert.deepStrictEqual(E.validateDeck(ok, cards), []);
  const bad = ok.concat([{ id: 'OP08-040', count: 5 }]);
  const issues = E.validateDeck(bad, cards);
  assert.ok(issues.some(i => i.includes('55')), issues.join('|'));
  assert.ok(issues.some(i => i.includes('超過 4')));
  assert.ok(issues.some(i => i.includes('顏色')));
  assert.ok(E.validateDeck([{ id: 'OP08-002', count: 4 }], cards).some(i => i.includes('領航')));
});

t('sellDeck removes base cards first, parallels only when allowed', () => {
  const owned = { 'OP08-002': 2, 'OP08-002_p1': 3, 'OP08-003': 1 };
  const deck = [{ id: 'OP08-002', count: 4 }, { id: 'OP08-003', count: 2 }];
  const a = E.sellDeck(owned, deck, false);
  assert.deepStrictEqual(a.owned, { 'OP08-002_p1': 3 });
  assert.deepStrictEqual(a.shortfall, [{ id: 'OP08-002', count: 2 }, { id: 'OP08-003', count: 1 }]);
  const b = E.sellDeck(owned, deck, true);
  assert.deepStrictEqual(b.owned, { 'OP08-002_p1': 1 });
  assert.deepStrictEqual(owned, { 'OP08-002': 2, 'OP08-002_p1': 3, 'OP08-003': 1 }, 'input untouched');
});

t('shoppingList adds up competing decks', () => {
  const list = E.shoppingList([
    { entries: [{ id: 'OP08-002', count: 4 }] },
    { entries: [{ id: 'OP08-002', count: 4 }, { id: 'OP08-003', count: 1 }] },
  ], { 'OP08-002': 5, 'OP08-003': 3 });
  assert.deepStrictEqual(list, [{ id: 'OP08-002', need: 8, free: 5, missing: 3 }]);
});

console.log(`\n${passed} tests passed`);
