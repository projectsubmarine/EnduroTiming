// 計算ロジックの単体テスト（依存なし）: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../js/core.js');

const T = (h, m, s, ms = 0) => ((h * 60 + m) * 60 + s) * 1000 + ms;

test('parseClock: 各種形式', () => {
  assert.equal(C.parseClock('10:05:23.45'), T(10, 5, 23, 450));
  assert.equal(C.parseClock('10:05'), T(10, 5, 0));
  assert.equal(C.parseClock('100523'), T(10, 5, 23));
  assert.equal(C.parseClock('100523.4'), T(10, 5, 23, 400));
  assert.equal(C.parseClock('１０：０５：２３．４５'), T(10, 5, 23, 450)); // 全角
  assert.equal(C.parseClock(' '), null);
  assert.ok(Number.isNaN(C.parseClock('25:00')));
  assert.ok(Number.isNaN(C.parseClock('10:60')));
  assert.ok(Number.isNaN(C.parseClock('abc')));
});

test('fmtDur / fmtClock: 切り捨て表示', () => {
  assert.equal(C.fmtDur(T(0, 5, 23, 459), 2), '5:23.45');
  assert.equal(C.fmtDur(T(1, 5, 3, 0), 0), '1:05:03');
  assert.equal(C.fmtClock(T(9, 0, 5, 7), 3), '9:00:05.007');
  assert.equal(C.fmtClockFull(T(10, 0, 0, 500)), '10:00:00.5');
  assert.equal(C.fmtClockFull(T(10, 0, 0)), '10:00:00');
});

test('elapsed: 日付またぎ・未完走', () => {
  assert.equal(C.elapsed({ status: 'OK', start: T(23, 59, 0), goal: T(0, 4, 0) }), T(0, 5, 0));
  assert.equal(C.elapsed({ status: 'DNF', start: 1, goal: 2 }), null);
  assert.equal(C.elapsed({ status: 'OK', start: 1, goal: null }), null);
});

function state() {
  const riders = [
    { uid: 'a', bib: '1', name: 'A', cls: 'IA' },
    { uid: 'b', bib: '2', name: 'B', cls: 'IA' },
    { uid: 'c', bib: '3', name: 'C', cls: 'IB' },
    { uid: 'd', bib: '4', name: 'D', cls: 'IB' },
    { uid: 'e', bib: '5', name: 'E', cls: 'IA' },
    { uid: 'f', bib: '6', name: 'F', cls: '' },
  ];
  const run = (rider, sec, dur, status = 'OK') => ({ rider, sec, start: T(10, 0, 0), goal: dur == null ? null : T(10, 0, 0) + dur, status });
  const runs = [
    run('a', '1', 300000), run('a', '2', 300000),            // 10:00 ×2区間
    run('b', '1', 290000), run('b', '2', null, 'DNF'),        // 1区間のみ（速いが区間数で下位）
    run('c', '1', 310000), run('c', '2', 290000),            // 10:00 同タイム
    run('d', '1', 250000), run('d', '2', 250000, 'DSQ'),      // DSQ → 順位なし
    run('e', '1', null, 'DNS'), run('e', '2', null, 'DNS'),   // 全DNS
    run('f', '1', 320000), run('f', '2', 320000),
  ];
  return { riders, runs, settings: { prec: 2 } };
}

test('compute: 総合順位（区間数→合計タイム、同タイム同順位）', () => {
  const R = C.compute(state());
  const byBib = Object.fromEntries(R.overall.map(x => [x.rd.bib, x]));
  assert.deepEqual(R.secs, ['1', '2']);
  assert.equal(byBib['1'].ovr, 1);
  assert.equal(byBib['3'].ovr, 1);          // 同タイム
  assert.equal(byBib['6'].ovr, 3);          // 1,1,3 方式
  assert.equal(byBib['2'].ovr, 4);          // 区間数が少ない
  assert.equal(byBib['2'].ovrGap, '-1区間');
  assert.equal(byBib['6'].ovrGap, '+0:40.00');
  assert.equal(byBib['4'].ranked, false);
  assert.equal(byBib['4'].label, 'DSQ');
  assert.equal(byBib['5'].label, 'DNS');
  assert.deepEqual(R.overall.slice(-2).map(x => x.rd.bib).sort(), ['4', '5']); // 順位なしは末尾
});

test('compute: クラス別順位と未設定クラス', () => {
  const R = C.compute(state());
  assert.deepEqual(R.classes, ['IA', 'IB', C.NOCLS]);
  assert.deepEqual(R.byClass.IA.filter(x => x.ranked).map(x => [x.rd.bib, x.clsR]), [['1', 1], ['2', 2]]);
  assert.deepEqual(R.byClass.IB.filter(x => x.ranked).map(x => [x.rd.bib, x.clsR]), [['3', 1]]);
  assert.equal(R.byClass[C.NOCLS][0].clsR, 1);
});

test('toCsv: BOM・エスケープ', () => {
  const s = C.toCsv([['a', 'b,c'], ['"x"', '']]);
  assert.equal(s, '﻿a,"b,c"\r\n"""x""",');
});
