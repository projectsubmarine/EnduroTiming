// firestore.rules のテスト（Firestoreエミュレータが必要。Javaが必要）: npm run test:rules
// 通常の npm test ではエミュレータが無いためスキップする。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const HOST = process.env.FIRESTORE_EMULATOR_HOST;
const skip = !HOST && 'Firestoreエミュレータ未起動（npm run test:rules で実行）';
const T = (h, m, s) => ((h * 60 + m) * 60 + s) * 1000;

let env, R;
const google = uid => env.authenticatedContext(uid, { email: uid + '@example.com', firebase: { sign_in_provider: 'google.com' } }).firestore();
const anon = uid => env.authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous' } }).firestore();
const ev = (db, eid = 'EV1') => db.collection('events').doc(eid);
const entry = (by, o = {}) => ({ rider: 'r1', bib: '101', sec: '1', goal: T(10, 5, 0), dev: 'S1', by, clientAt: Date.now(), ...o });

test.before(async () => {
  if (!HOST) return;
  R = require('@firebase/rules-unit-testing');
  const [host, port] = HOST.split(':');
  env = await R.initializeTestEnvironment({
    projectId: 'demo-enduro',
    firestore: { host, port: +port, rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8') },
  });
});
test.after(async () => { if (env) await env.cleanup(); });
test.beforeEach(async () => {
  if (!env) return;
  await env.clearFirestore();
  // 大会 EV1（本部 admin1）、セクション1のPIN、登録済みのゴール端末 dev1（セクション1）
  await env.withSecurityRulesDisabled(async c => {
    const db = c.firestore();
    await ev(db).set({ admins: ['admin1'], roster: { riders: [{ uid: 'r1', bib: '101', name: 'A' }] } });
    await ev(db).collection('private').doc('pins').set({ pins: { 1: '111111', 2: '222222' } });
    await ev(db).collection('devices').doc('dev1').set({ sec: '1', pin: '111111', label: 'S1' });
    await ev(db).collection('entries').doc('e1').set(entry('dev1'));
    await ev(db).collection('entries').doc('e2').set(entry('admin1', { sec: '2' }));
  });
});

test('大会の作成：Googleログインのみ、自分を管理者にしたときだけ', { skip }, async () => {
  await R.assertSucceeds(ev(google('u9'), 'EV2').set({ admins: ['u9'], roster: {} }));
  await R.assertFails(ev(anon('a9'), 'EV3').set({ admins: ['a9'], roster: {} }));
  await R.assertFails(ev(google('u9'), 'EV4').set({ admins: ['someone'], roster: {} }));
  await R.assertFails(ev(google('u9')).set({ admins: ['u9'], roster: {} }));  // 既存の大会の乗っ取り
});

test('大会・PIN：本部のみ。名簿は登録済み端末も読める', { skip }, async () => {
  await R.assertSucceeds(ev(google('admin1')).get());
  await R.assertSucceeds(ev(google('admin1')).update({ roster: { riders: [] } }));
  await R.assertFails(ev(google('admin1')).update({ admins: ['other'] }));  // 自分を外す
  await R.assertSucceeds(ev(google('admin1')).collection('private').doc('pins').get());
  await R.assertSucceeds(ev(anon('dev1')).get());
  await R.assertFails(ev(anon('dev1')).update({ roster: {} }));
  await R.assertFails(ev(anon('dev1')).collection('private').doc('pins').get());
  await R.assertFails(ev(google('stranger')).get());
  await R.assertFails(ev(anon('nobody')).get());
  await R.assertFails(ev(env.unauthenticatedContext().firestore()).get());
  await R.assertFails(ev(google('admin1')).delete());
});

test('端末の登録：PINが正しく、自分のuidのときだけ', { skip }, async () => {
  const devs = db => ev(db).collection('devices');
  await R.assertFails(devs(anon('a2')).doc('a2').set({ sec: '1', pin: '000000', label: 'x' }));
  await R.assertFails(devs(anon('a2')).doc('a2').set({ sec: '3', pin: '111111', label: 'x' }));  // PIN未発行のセクション
  await R.assertFails(devs(anon('a2')).doc('a2').set({ sec: '1', pin: 111111, label: 'x' }));     // 数値
  await R.assertFails(devs(anon('a2')).doc('other').set({ sec: '1', pin: '111111', label: 'x' }));
  await R.assertFails(devs(anon('a2')).doc('a2').set({ sec: '1', pin: '111111', label: 'x', admin: true }));
  await R.assertSucceeds(devs(anon('a2')).doc('a2').set({ sec: '2', pin: '222222', label: 'S2ゴール' }));
  await R.assertSucceeds(devs(anon('a2')).doc('a2').get());
  await R.assertFails(devs(anon('a2')).doc('dev1').get());
  await R.assertSucceeds(devs(google('admin1')).get());
  await R.assertFails(devs(anon('a2')).get());
});

test('記録の閲覧：端末は自分のセクションだけ', { skip }, async () => {
  const ents = db => ev(db).collection('entries');
  await R.assertSucceeds(ents(anon('dev1')).where('sec', '==', '1').get());
  await R.assertFails(ents(anon('dev1')).where('sec', '==', '2').get());
  await R.assertFails(ents(anon('dev1')).get());
  await R.assertSucceeds(ents(google('admin1')).get());
  await R.assertFails(ents(anon('nobody')).where('sec', '==', '1').get());
});

test('記録の追加：端末は自分のセクション・自分名義・正しい形式のときだけ。書き換え・削除は誰もできない', { skip }, async () => {
  const ents = db => ev(db).collection('entries');
  const d = anon('dev1');
  await R.assertSucceeds(ents(d).doc('n1').set(entry('dev1')));
  await R.assertSucceeds(ents(d).doc('n2').set(entry('dev1', { rider: null, goal: null, status: 'DNF', fix: true })));
  await R.assertFails(ents(d).doc('n3').set(entry('dev1', { sec: '2' })));
  await R.assertFails(ents(d).doc('n4').set(entry('admin1')));
  await R.assertFails(ents(d).doc('n5').set(entry('dev1', { status: 'XXX' })));
  await R.assertFails(ents(d).doc('n6').set(entry('dev1', { goal: 86400000 })));
  await R.assertFails(ents(d).doc('n7').set(entry('dev1', { goal: 1.5 })));
  await R.assertFails(ents(d).doc('n8').set(entry('dev1', { evil: 1 })));
  await R.assertFails(ents(d).doc('n9').set(entry('dev1', { note: 'x'.repeat(201) })));
  await R.assertFails(ents(d).doc('e1').set(entry('dev1', { goal: T(9, 0, 0) })));  // 既存の書き換え
  await R.assertFails(ents(d).doc('e1').delete());
  await R.assertFails(ents(anon('nobody')).doc('n10').set(entry('nobody')));
  // 本部はどのセクションにも追加できるが、書き換え・削除はできない
  await R.assertSucceeds(ents(google('admin1')).doc('h1').set(entry('admin1', { sec: '5', del: true })));
  await R.assertFails(ents(google('admin1')).doc('e1').update({ goal: 0 }));
  await R.assertFails(ents(google('admin1')).doc('e1').delete());
});

test('本部が端末を無効化すると、その端末は読み書きできなくなる', { skip }, async () => {
  await R.assertSucceeds(ev(google('admin1')).collection('devices').doc('dev1').delete());
  await R.assertFails(ev(anon('dev1')).collection('entries').doc('x').set(entry('dev1')));
  await R.assertFails(ev(anon('dev1')).get());
});
