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

// Journey log
let log = L.withMove([], 'applied', '2026-10-01');
log = [...log, L.logEntry('applied', '2026-10-01', 'Gửi CV qua TopCV')];
log = L.withMove(log, 'screening', '2026-10-05');
log[2].text = 'HR gọi, hẹn tuần sau';
assert.deepStrictEqual(L.sortedLog(log).map(e => e.stage), ['screening', 'applied', 'applied']);
assert.strictEqual(L.sortedLog(log)[1].text, 'Gửi CV qua TopCV'); // same day: later entry first
assert.strictEqual(L.lastNote(log), 'HR gọi, hẹn tuần sau');
assert.strictEqual(L.lastNote(L.withMove([], 'wish', '2026-10-01')), '');

const withLog = L.sanitize([{ company: 'X', role: 'Y', log: [{ stage: 'rejected', date: '2026-10-02', text: 'Not move forward' }, { stage: 'nope', date: '2026-10-02' }, 'junk'] }]);
assert.strictEqual(withLog[0].log.length, 1);
assert.strictEqual(withLog[0].log[0].move, false);
assert.deepStrictEqual(L.sanitize([{ company: 'X', role: 'Y' }])[0].log, []);
assert.ok(!L.agenda([{ id: 'r', stage: 'rejected', nextDate: '2026-10-07' }], '2026-10-07').due.length);

// Links
assert.deepStrictEqual(L.linkify('Xem https://drjoy.vn/product.\nVideo: https://www.youtube.com/watch?v=MmAvMB4o_DU'),
  ['Xem ', { url: 'https://drjoy.vn/product' }, '.\nVideo: ', { url: 'https://www.youtube.com/watch?v=MmAvMB4o_DU' }]);
assert.deepStrictEqual(L.linkify('(https://drjoy.co.jp/)'), ['(', { url: 'https://drjoy.co.jp/' }, ')']);
assert.deepStrictEqual(L.linkify('javascript:alert(1) không có link'), ['javascript:alert(1) không có link']);
assert.deepStrictEqual(L.linkify(''), []);

console.log('ok');
