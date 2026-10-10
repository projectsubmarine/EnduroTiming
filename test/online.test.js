// オンライン版の結合テスト（jsdom）：本部（index.html）とゴール端末（goal.html）を、
// メモリ上の偽サーバー（js/online.js の代わり）でつないで動かす。Firestore・セキュリティルール自体はここでは試さない。
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch { /* 未インストール */ }
const root = path.join(__dirname, '..');
const T = (h, m, s, ms = 0) => ((h * 60 + m) * 60 + s) * 1000 + ms;
const tick = () => new Promise(r => setTimeout(r, 0));
const settle = async () => { for (let i = 0; i < 10; i++) await tick(); };

/** 偽サーバー（全端末で共有） */
function fakeServer() {
  const ev = {}; const subs = new Set(); let seq = 0;
  const notify = () => subs.forEach(f => f());
  const denied = () => Object.assign(new Error('denied'), { code: 'permission-denied' });
  function client(userInit) {
    let user = null; const authCbs = [];
    const isAdmin = eid => user && ev[eid] && ev[eid].admins.includes(user.uid);
    const isDev = eid => user && ev[eid] && ev[eid].devices[user.uid];
    const watch = (fn) => { subs.add(fn); fn(); return () => subs.delete(fn); };
    return {
      unavailableReason: () => '',
      registerOffline: () => {},
      init: async () => {},
      user: () => user,
      isAdminUser: () => !!user && !user.isAnonymous,
      signInGoogle: async () => { user = { ...userInit, isAnonymous: false }; },
      signInAnon: async () => { if (!user) user = { uid: 'anon' + (++seq), isAnonymous: true }; return user; },
      signOut: async () => { user = null; },
      onAuth: cb => authCbs.push(cb),
      newPin: () => '123456',
      createEvent: async roster => { const eid = 'EV' + (++seq); ev[eid] = { admins: [user.uid], roster, pins: {}, devices: {}, entries: [] }; notify(); return eid; },
      pushRoster: async (eid, roster) => { if (!isAdmin(eid)) throw denied(); ev[eid].roster = roster; notify(); },
      watchEvent: (eid, cb, err) => watch(() => { if (!isAdmin(eid) && !isDev(eid)) return err && err(denied()); cb({ ...ev[eid] }, {}); }),
      getPins: async eid => { if (!isAdmin(eid)) throw denied(); return { ...ev[eid].pins }; },
      setPins: async (eid, pins) => { if (!isAdmin(eid)) throw denied(); ev[eid].pins = { ...pins }; notify(); },
      watchDevices: (eid, cb) => watch(() => cb(Object.entries(ev[eid].devices).map(([id, d]) => ({ id, ...d })))),
      removeDevice: async (eid, id) => { delete ev[eid].devices[id]; notify(); },
      registerDevice: async (eid, sec, pin, label) => {
        if (!ev[eid] || ev[eid].pins[sec] !== pin) throw denied();
        ev[eid].devices[user.uid] = { sec, pin, label }; notify();
      },
      getMyDevice: async eid => ev[eid].devices[user.uid] || null,
      watchEntries: (eid, sec, cb) => watch(() => {
        const list = ev[eid].entries.filter(e => sec == null || e.sec === String(sec)).map(e => ({ ...e, pending: false }));
        cb(list, { fromCache: false, pending: 0 });
      }),
      newEntryId: () => 'id' + String(++seq).padStart(5, '0'),
      addEntry: async (eid, entry, id) => {
        if (!isAdmin(eid) && !(isDev(eid) && isDev(eid).sec === entry.sec)) throw denied();
        if (ev[eid].entries.some(e => e.id === id)) throw denied();
        ev[eid].entries.push({ ...entry, id: id || 'id' + String(++seq).padStart(5, '0'), by: user.uid, clientAt: entry.clientAt ?? Date.now() });
        notify();
      },
    };
  }
  const inject = (eid, e) => { ev[eid].entries.push(e); notify(); }; // 他の端末からの書き込みを模擬
  return { ev, client, inject };
}

function open(file, online, url) {
  const html = fs.readFileSync(path.join(root, file), 'utf8')
    .replace(/<script src="([^"]+)"><\/script>/g, (_, p) =>
      p === 'js/online.js' ? '' : `<script>${fs.readFileSync(path.join(root, p), 'utf8')}</script>`);
  const errors = [], alerts = [], prompts = [];
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: url || 'http://localhost/',
    beforeParse(w) {
      w.Online = online;
      w.alert = m => alerts.push(m); w.confirm = () => true; w.prompt = () => prompts.shift() ?? null;
      w.scrollTo = () => {}; w.print = () => {};
      w.HTMLFormElement.prototype.requestSubmit = function () { this.dispatchEvent(new w.Event('submit', { cancelable: true })); };
      w.addEventListener('error', e => errors.push(e.message));
      w.addEventListener('unhandledrejection', e => errors.push(String(e.reason)));
    },
  });
  const w = dom.window, $ = s => w.document.querySelector(s);
  const submit = f => $(f).dispatchEvent(new w.Event('submit', { cancelable: true }));
  return { w, $, submit, errors, alerts, prompts };
}

const skip = !JSDOM && 'jsdom 未インストール（npm install）';

test('オンライン：本部で公開 → ゴール端末を登録 → ゴール入力が本部の結果に反映される', { skip }, async () => {
  const srv = fakeServer();
  const hq = open('index.html', srv.client({ uid: 'admin1', email: 'hq@example.com' }));
  const S = () => JSON.parse(hq.w.localStorage.getItem('raceTimer_v1'));
  // オフラインで登録・入力しておいた記録も、公開時に引き継がれる
  hq.$('#cls_name').value = 'IA'; hq.$('#cls_digit').value = '1'; hq.submit('#clsForm');
  for (const [bib, name] of [['101', '太郎'], ['102', '次郎']]) {
    hq.$('#r_bib').value = bib; hq.$('#r_name').value = name; hq.$('#r_cls').value = 'IA'; hq.submit('#rForm');
  }
  hq.$('#t_bib').value = '102'; hq.$('#t_sec').value = '1'; hq.$('#t_start').value = '10:01:00'; hq.$('#t_goal').value = '10:06:30'; hq.submit('#tForm');

  hq.w.olLogin(); await settle();
  hq.w.olCreate(); await settle();
  const eid = Object.keys(srv.ev)[0];
  assert.ok(eid);
  assert.equal(srv.ev[eid].roster.riders.length, 2);
  assert.equal(srv.ev[eid].entries.length, 1);               // 公開前の記録
  assert.match(hq.$('#olArea').textContent, new RegExp(eid));
  hq.prompts.push('1'); hq.w.olAddSection(); await settle();
  assert.deepEqual(srv.ev[eid].pins, { 1: '123456' });

  // ゴール端末：PINが違うと登録できない → 正しいPINで登録
  const g = open('goal.html', srv.client({}), `http://localhost/goal.html?e=${eid}`);
  await settle();
  assert.equal(g.$('#s_eid').value, eid);
  g.$('#s_sec').value = '1'; g.$('#s_pin').value = '000000'; g.$('#s_label').value = 'S1ゴール'; g.submit('#setupForm'); await settle();
  assert.match(g.$('#s_info').textContent, /PIN/);
  g.$('#s_pin').value = '123456'; g.submit('#setupForm'); await settle();
  assert.equal(g.$('#main').hidden, false);

  // 名簿が届いていて、BIBから氏名が引ける
  g.$('#g_bib').value = '101'; g.$('#g_bib').dispatchEvent(new g.w.Event('input'));
  assert.match(g.$('#g_who').textContent, /太郎/);
  g.$('#g_time').value = '100523.45'; g.submit('#gForm'); await settle();
  assert.equal(srv.ev[eid].entries.length, 2);

  // 本部：ゴールが届いている。本部でスタートを入力すると1件にまとまる
  await settle();
  const run101 = () => S().runs.find(r => r.rider === S().riders.find(x => x.bib === '101').uid);
  assert.equal(run101().goal, T(10, 5, 23, 450));
  hq.$('#t_bib').value = '101'; hq.$('#t_sec').value = '1'; hq.$('#t_start').value = '10:00:00'; hq.$('#t_goal').value = ''; hq.submit('#tForm');
  await settle();
  assert.deepEqual([run101().start, run101().goal], [T(10, 0, 0), T(10, 5, 23, 450)]);
  assert.equal(S().runs.length, 2);

  // 結果表
  hq.$('#resView').value = '__ovr'; hq.w.renderResults();
  const rows = [...hq.w.document.querySelectorAll('#resArea tbody tr')].map(r => [...r.cells].map(c => c.textContent.trim()));
  assert.deepEqual(rows.map(r => r[2]), ['101', '102']);

  // 名簿にないBIB → 本部で登録すると自動で紐づく
  g.$('#g_bib').value = '150'; g.$('#g_time').value = '101000'; g.submit('#gForm'); await settle();
  assert.match(hq.$('#olTimesBanner').textContent, /150/);
  hq.$('#r_bib').value = '150'; hq.$('#r_name').value = '三郎'; hq.$('#r_cls').value = 'IA'; hq.submit('#rForm'); await settle();
  assert.equal(S().runs.length, 3);
  assert.doesNotMatch(hq.$('#olTimesBanner').textContent, /登録されていないBIB/);

  // 別の端末（オフラインで遅れて届いた等）から違うゴール時刻 → 上書きせず「競合」と表示、本部の編集で解消
  srv.inject(eid, { id: 'zz1', rider: null, bib: '101', sec: '1', goal: T(10, 5, 24), by: 'other', dev: 'S1予備', clientAt: Date.now() });
  await settle();
  assert.equal(run101().goal, T(10, 5, 23, 450));
  assert.match(hq.$('#tTable').textContent, /競合/);
  assert.match(hq.$('#olTimesBanner').textContent, /競合/);
  hq.w.editT(run101().uid); hq.$('#t_goal').value = '10:05:24'; hq.submit('#tForm'); await settle();
  assert.equal(run101().goal, T(10, 5, 24));
  assert.doesNotMatch(hq.$('#tTable').textContent, /競合/);

  // 削除も記録として追加される（サーバーの記録は消えない）
  const before = srv.ev[eid].entries.length;
  hq.w.delT(run101().uid); await settle();
  assert.equal(srv.ev[eid].entries.length, before + 1);
  assert.equal(run101(), undefined);

  // 接続中はサンプル投入・全消去・バックアップ読込はできない
  hq.$('#btnSample').click();
  assert.match(hq.alerts.at(-1), /オンライン接続中/);

  assert.deepEqual(hq.errors, []); assert.deepEqual(g.errors, []);
});

test('オンライン：ゴール端末は自分のセクション以外には送れない・取消ができる', { skip }, async () => {
  const srv = fakeServer();
  const hq = open('index.html', srv.client({ uid: 'admin1', email: 'hq@example.com' }));
  hq.$('#r_bib').value = '101'; hq.$('#r_name').value = '太郎'; hq.submit('#rForm');
  hq.w.olLogin(); await settle(); hq.w.olCreate(); await settle();
  const eid = Object.keys(srv.ev)[0];
  hq.prompts.push('2'); hq.w.olAddSection(); await settle();
  const g = open('goal.html', srv.client({}), `http://localhost/goal.html?e=${eid}`); await settle();
  g.$('#s_sec').value = '2'; g.$('#s_pin').value = '123456'; g.$('#s_label').value = 'S2'; g.submit('#setupForm'); await settle();
  // スタートモードで入力
  g.w.document.querySelector('[data-mode="start"]').click();
  g.$('#g_bib').value = '101'; g.$('#g_time').value = '11:00:00'; g.submit('#gForm'); await settle();
  const runs = () => JSON.parse(hq.w.localStorage.getItem('raceTimer_v1')).runs;
  assert.equal(runs()[0].start, T(11, 0, 0)); assert.equal(runs()[0].sec, '2');
  // 取消
  const id = srv.ev[eid].entries[0].id;
  g.w.cancelEntry(id); await settle();
  assert.equal(runs()[0].start, null);
  // DNF
  g.$('#g_bib').value = '101'; g.w.document.querySelector('[data-status="DNF"]').click(); await settle();
  assert.equal(runs()[0].status, 'DNF');
  // 本部で無効化すると送れなくなる（控えは端末に残る）
  hq.w.olRemoveDevice(Object.keys(srv.ev[eid].devices)[0]); await settle();
  g.w.document.querySelector('[data-mode="goal"]').click();
  g.$('#g_bib').value = '101'; g.$('#g_time').value = '11:05:00'; g.submit('#gForm'); await settle();
  assert.match(g.$('#g_warn').textContent, /拒否/);
  assert.ok(g.$('#g_list').textContent.includes('未送信'));
  assert.deepEqual(hq.errors, []); assert.deepEqual(g.errors, []);
});

test('オンライン：スタート時刻の自動入力は entries への追記になり、ゴール記録を残したまま反映される', { skip }, async () => {
  const srv = fakeServer();
  const hq = open('index.html', srv.client({ uid: 'admin1', email: 'hq@example.com' }));
  const S = () => JSON.parse(hq.w.localStorage.getItem('raceTimer_v1'));
  hq.$('#cls_name').value = 'IA'; hq.$('#cls_digit').value = '1'; hq.submit('#clsForm');
  for (const [bib, name] of [['101', '太郎'], ['102', '次郎'], ['103', '三郎']]) {
    hq.$('#r_bib').value = bib; hq.$('#r_name').value = name; hq.$('#r_cls').value = 'IA'; hq.submit('#rForm');
  }
  hq.w.olLogin(); await settle();
  hq.w.olCreate(); await settle();
  const eid = Object.keys(srv.ev)[0];
  const time = (bib, st, gl) => { hq.$('#t_bib').value = bib; hq.$('#t_sec').value = '1'; hq.$('#t_start').value = st; hq.$('#t_goal').value = gl; hq.submit('#tForm'); };
  time('102', '', '10:06:00');          // ゴールだけ入っている
  time('103', '9:00:00', '9:05:00');    // 別のスタート時刻が入っている → 上書き（fix）
  await settle();
  const before = srv.ev[eid].entries.length;

  hq.w.renderStartList();
  const inp = k => hq.w.document.querySelector(`#startClsTable input[data-k="${k}"]`);
  inp('first').value = '10:00:00'; hq.w.setStartPlan(inp('first'));
  inp('interval').value = '30'; hq.w.setStartPlan(inp('interval'));
  hq.$('#btnStartPlan').click(); await settle();

  const added = srv.ev[eid].entries.slice(before);
  assert.deepEqual(added.map(e => [e.bib, e.sec, e.start, !!e.fix, 'goal' in e, 'status' in e]), [
    ['101', '1', T(10, 0, 0), false, false, false],
    ['102', '1', T(10, 0, 30), false, false, false],
    ['103', '1', T(10, 1, 0), true, false, false],
  ]);
  const bib = u => S().riders.find(r => r.uid === u).bib;
  assert.deepEqual(S().runs.map(x => [bib(x.rider), x.start, x.goal]).sort(), [
    ['101', T(10, 0, 0), null], ['102', T(10, 0, 30), T(10, 6, 0)], ['103', T(10, 1, 0), T(9, 5, 0)],
  ]);
  assert.deepEqual([...hq.w.document.querySelectorAll('#sTable tr')].slice(1).map(r => r.cells[1].textContent), ['10:00:00.00', '10:00:30.00', '10:01:00.00']);

  // もう一度押しても、同じ時刻なら何も送らない。設定は名簿と一緒にサーバーへ送られる
  hq.$('#btnStartPlan').click(); await settle();
  assert.equal(srv.ev[eid].entries.length, before + 3);
  await new Promise(r => setTimeout(r, 900)); await settle();
  assert.deepEqual(JSON.parse(JSON.stringify(srv.ev[eid].roster.startPlan)), { sec: '1', classes: { IA: { first: T(10, 0, 0), interval: 30000 } } });
  assert.deepEqual(hq.errors, []);
});
