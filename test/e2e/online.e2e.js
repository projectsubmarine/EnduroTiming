// オンライン版のブラウザ通しテスト：実際のChrome＋Firebase SDK＋エミュレータ（Firestore・Auth）で、
// 本部とゴール端末を動かす（電波が切れた状態での入力・再読み込み・復帰後の自動送信を含む）。
// 実行：npm run test:e2e （Java と /Applications/Google Chrome.app が必要）
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const pw = require('playwright-core');

const ROOT = path.join(__dirname, '..', '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CFG = 'window.FIREBASE_CONFIG={apiKey:"demo-key",authDomain:"demo-enduro.firebaseapp.com",projectId:"demo-enduro",appId:"1:1:web:1",' +
  'emulator:{firestore:"127.0.0.1:8080",auth:"http://127.0.0.1:9099"}};';
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const T = (h, m, s, ms = 0) => ((h * 60 + m) * 60 + s) * 1000 + ms;
const step = m => process.env.E2E_VERBOSE && console.log('…', m);
async function until(f, ms = 10000) { const t = Date.now(); for (;;) { if (await f()) return; if (Date.now() - t > ms) throw new Error('timeout: ' + f); await sleep(200); } }

setTimeout(() => { console.error('✖ 失敗：2分以内に終わりませんでした'); process.exit(1); }, 120000).unref();

(async () => {
  // 静的ファイル配信（サービスワーカーが動くよう http://localhost で）
  const srv = http.createServer((req, res) => {
    let p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
    if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
  }).listen(0);
  const BASE = `http://localhost:${srv.address().port}/`;
  const b = await pw.chromium.launch({ executablePath: CHROME });
  const errors = [];
  async function open(ctx, url, answers = []) {
    const p = await ctx.newPage();
    p.setDefaultTimeout(15000);
    p.on('console', m => process.env.E2E_VERBOSE && console.log('  [console]', m.text().slice(0, 200)));
    p.on('pageerror', e => errors.push(e.message));
    p.on('dialog', d => d.type() === 'prompt' ? d.accept(answers.shift() || '') : d.accept());
    await p.goto(url); return p;
  }
  try {
    const hctx = await b.newContext(), gctx = await b.newContext();
    for (const c of [hctx, gctx]) await c.route('**/js/firebase-config.js', r => r.fulfill({ contentType: 'text/javascript', body: CFG }));

    step('本部：登録 → Googleログイン（エミュレータ用） → ');
    // 本部：登録 → Googleログイン（エミュレータ用） → 公開 → PIN発行
    const answers = ['1'];
    const hq = await open(hctx, BASE + 'index.html', answers);
    await hq.evaluate(() => {
      const $ = s => document.querySelector(s);
      $('#cls_name').value = 'IA'; $('#cls_digit').value = '1'; $('#clsForm').requestSubmit();
      for (const [b, n] of [['101', '太郎'], ['102', '次郎']]) { $('#r_bib').value = b; $('#r_name').value = n; $('#r_cls').value = 'IA'; $('#rForm').requestSubmit(); }
    });
    await hq.evaluate(async () => {
      await Online.init();
      await firebase.auth().signInWithCredential(firebase.auth.GoogleAuthProvider.credential(JSON.stringify({ sub: 'admin1', email: 'hq@example.com', email_verified: true })));
    });
    await hq.evaluate(() => olCreate()); await until(() => hq.evaluate(() => OL.ready));
    const eid = await hq.evaluate(() => OL.eid);
    await hq.evaluate(() => olAddSection()); await until(() => hq.evaluate(() => !!(OL.pins && OL.pins['1'])));
    const pin = await hq.evaluate(() => OL.pins['1']);

    step('ゴール端末：PINを間違えると登録できない → 正しいPIN');
    // ゴール端末：PINを間違えると登録できない → 正しいPINで登録
    const g = await open(gctx, BASE + 'goal.html?e=' + eid);
    await g.fill('#s_sec', '1'); await g.fill('#s_label', 'S1ゴール');
    await g.fill('#s_pin', '000000'); await g.click('#s_submit');
    await until(async () => /PIN/.test(await g.textContent('#s_info')));
    await g.fill('#s_pin', pin); await g.click('#s_submit');
    await until(() => g.isVisible('#main'));
    await g.fill('#g_bib', '101'); await until(async () => /太郎/.test(await g.textContent('#g_who')));
    await g.fill('#g_time', '100523.45'); await g.press('#g_time', 'Enter');
    await until(async () => /すべて送信済み/.test(await g.textContent('#g_sync')));
    await until(() => g.evaluate(() => !!navigator.serviceWorker.controller)); // ページの保存（sw.js）が有効

    step('電波なし：入力は端末に残り、ページを再読み込みしても開ける');
    // 電波なし：入力は端末に残り、ページを再読み込みしても開ける
    await gctx.setOffline(true);
    await g.fill('#g_bib', '102'); await g.fill('#g_time', '100630'); await g.press('#g_time', 'Enter');
    await until(async () => /未送信 1 件/.test(await g.textContent('#g_sync')));
    await g.reload(); await until(() => g.isVisible('#main'));
    assert.equal(await g.$$eval('#g_list tr', r => r.length - 1), 2);
    assert.equal(await hq.evaluate(() => S.runs.length), 1);
    await gctx.setOffline(false);
    await until(async () => /すべて送信済み/.test(await g.textContent('#g_sync')), 20000);

    step('本部：スタートを入力 → 結果');
    // 本部：スタートを入力 → 結果
    await until(() => hq.evaluate(() => S.runs.length === 2));
    await hq.evaluate(() => {
      const $ = s => document.querySelector(s);
      for (const [b, st] of [['101', '10:00:00'], ['102', '10:01:00']]) { $('#t_bib').value = b; $('#t_sec').value = '1'; $('#t_start').value = st; $('#t_goal').value = ''; $('#tForm').requestSubmit(); }
    });
    await until(() => hq.evaluate(() => S.runs.every(r => r.start != null)));
    const runs = await hq.evaluate(() => S.runs.map(r => [riderOf(r.rider).bib, r.start, r.goal]).sort());
    assert.deepEqual(runs, [['101', T(10, 0, 0), T(10, 5, 23, 450)], ['102', T(10, 1, 0), T(10, 6, 30)]]);

    step('本部の再読み込み：ログイン状態が復元され、自動で再接続する');
    // 本部の再読み込み：ログイン状態が復元され、自動で再接続する
    await hq.reload(); await until(() => hq.evaluate(() => OL.ready && S.runs.length === 2));

    assert.deepEqual(errors, []);
    console.log('✔ オンライン版のブラウザ通しテスト：OK（大会コード ' + eid + '）');
  } finally { await b.close(); srv.close(); }
})().catch(e => { console.error('✖ 失敗', e); process.exit(1); });
