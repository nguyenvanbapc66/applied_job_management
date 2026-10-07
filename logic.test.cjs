// node logic.test.cjs
const assert = require('node:assert');
const L = require('./logic.js');

const jobs = [
  { id: 'a', company: 'A', role: 'x', stage: 'interview', nextDate: '2026-10-08' },
  { id: 'b', company: 'B', role: 'x', stage: 'applied', appliedDate: '2026-09-20' },
  { id: 'c', company: 'C', role: 'x', stage: 'applied', appliedDate: '2026-10-06', nextDate: '2026-10-05' },
  { id: 'd', company: 'D', role: 'x', stage: 'closed', nextDate: '2026-10-07' },
  { id: 'e', company: 'E', role: 'x', stage: 'wish', nextDate: '2026-12-01' },
];
const { due, stale } = L.agenda(jobs, '2026-10-07');
assert.deepStrictEqual(due.map(d => [d.job.id, d.in]), [['c', -2], ['a', 1]]);
assert.deepStrictEqual(stale.map(s => [s.job.id, s.since]), [['b', 17]]);

const w = L.week(jobs, '2026-10-07'); // Wednesday
assert.strictEqual(w[0].date, '2026-10-05');
assert.strictEqual(w[1].count, 1);
assert.strictEqual(w[3].future, true);

assert.throws(() => L.sanitize({}));
const s = L.sanitize([{ company: 'X', role: 'Y', stage: 'bogus', nextDate: '<script>' }, { nope: 1 }]);
assert.strictEqual(s.length, 1);
assert.strictEqual(s[0].stage, 'wish');
assert.strictEqual(s[0].nextDate, '');

assert.strictEqual(L.relDay(-1), 'trễ 1 ngày');
console.log('ok');
