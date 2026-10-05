// 画面の結合テスト（jsdomでブラウザを模擬）: npm install 後に node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch { /* 未インストール */ }

function open() {
  const root = path.join(__dirname, '..');
  // 外部 <script src> をインライン化して読み込む（file:// だと jsdom の localStorage が使えないため）
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
    .replace(/<script src="([^"]+)"><\/script>/g, (_, p) => `<script>${fs.readFileSync(path.join(root, p), 'utf8')}</script>`);
  const errors = [], alerts = [];
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'http://localhost/',
    beforeParse(w) {
      w.alert = m => alerts.push(m); w.confirm = () => true; w.prompt = () => null; w.scrollTo = () => {}; w.print = () => {};
      w.HTMLFormElement.prototype.requestSubmit = function () { this.dispatchEvent(new w.Event('submit', { cancelable: true })); };
      w.addEventListener('error', e => errors.push(e.message));
    },
  });
  const w = dom.window, $ = s => w.document.querySelector(s);
  const submit = f => $(f).dispatchEvent(new w.Event('submit', { cancelable: true }));
  // クラスは「参加クラス設定」で登録してから選ぶ運用になったため、未登録なら先に追加する
  const addClass = cls => { if (!cls || [...$('#r_cls').options].some(o => o.value === cls)) return; $('#cls_name').value = cls; submit('#clsForm'); };
  const rider = (bib, name, cls) => { addClass(cls); $('#r_bib').value = bib; $('#r_name').value = name; $('#r_cls').value = cls; submit('#rForm'); };
  const time = (bib, sec, st, gl) => { $('#t_bib').value = bib; $('#t_sec').value = sec; $('#t_start').value = st; $('#t_goal').value = gl; submit('#tForm'); };
  const state = () => JSON.parse(w.localStorage.getItem('raceTimer_v1'));
  return { w, $, rider, time, state, errors, alerts };
}

test('登録→タイム入力→結果表示', { skip: !JSDOM && 'jsdom 未インストール（npm install）' }, () => {
  const ui = open();
  ui.rider('７', '太郎', 'IA');           // 全角BIB
  ui.rider('8', '次郎', 'IA');
  ui.rider('8', '重複', 'IA');            // BIB重複 → 拒否
  assert.equal(ui.state().riders.length, 2);

  ui.time('7', '1', '10:00:00.5', '');    // スタートのみ
  ui.time('7', '1', '', '10:05:00.25');   // 後からゴール（マージ）
  ui.time('8', '1', '１００１００', '10:06:00');
  ui.time('9', '1', '1:00', '1:01');      // 未登録BIB → 拒否
  ui.time('8', '1', '10:01:00', '25:00'); // 不正時刻 → 拒否

  const S = ui.state();
  assert.equal(S.runs.length, 2);
  assert.deepEqual([S.runs[0].start, S.runs[0].goal], [36000500, 36300250]);
  assert.equal(ui.alerts.length, 3);

  ui.$('#resView').value = '__ovr'; ui.w.renderResults();
  const rows = [...ui.w.document.querySelectorAll('#resArea tr')]
    .map(r => [...r.cells].map(c => c.textContent.trim()));
  // 列: 総合, クラス順位, BIB, 氏名, クラス, S1, 区間数, 合計
  assert.deepEqual(rows[1].slice(0, 8), ['1', '1', '7', '太郎', 'IA', '4:59.75', '1', '4:59.75']);
  assert.deepEqual(rows[2].slice(0, 4), ['2', '2', '8', '次郎']);
  assert.deepEqual(ui.errors, []);
});

test('クラス設定：追加・使用中は削除不可・名称変更で全ライダーに反映', { skip: !JSDOM && 'jsdom 未インストール（npm install）' }, () => {
  const ui = open();
  ui.rider('1', '太郎', 'IA');
  ui.rider('2', '次郎', 'IB');
  assert.deepEqual(ui.state().classes, ['IA', 'IB']);

  ui.w.delCls(0); // IAはライダーが使用中なので削除できない
  assert.ok(ui.alerts.at(-1).includes('使用中'));
  assert.deepEqual(ui.state().classes, ['IA', 'IB']);

  ui.w.prompt = () => 'IA改';
  ui.w.renameCls(0); // 名称変更は既存ライダーのクラスにも反映される
  const S = ui.state();
  assert.deepEqual(S.classes, ['IA改', 'IB']);
  assert.equal(S.riders.find(r => r.bib === '1').cls, 'IA改');
  assert.deepEqual(ui.errors, []);
});

test('スタートリスト：並び順の初期化（クラス→BIB順）・手動入替・新規登録は末尾に追加', { skip: !JSDOM && 'jsdom 未インストール（npm install）' }, () => {
  const ui = open();
  ui.rider('1', 'イチ', 'IA');
  ui.rider('9', 'キュウ', 'IB');
  ui.rider('2', 'ニ', 'IA');
  const bibsOf = () => { const S = ui.state(); return S.startOrder.map(u => S.riders.find(r => r.uid === u).bib); };
  assert.deepEqual(bibsOf(), ['1', '9', '2']); // 登録順にそのまま末尾へ追加される

  ui.$('#btnStartReset').click(); // クラス設定順(IA→IB)→BIB順に初期化
  assert.deepEqual(bibsOf(), ['1', '2', '9']);

  const order = ui.state().startOrder;
  ui.w.moveStart(order[1], -1); // 先頭2件を手動で入替
  assert.deepEqual(bibsOf(), ['2', '1', '9']);

  ui.rider('3', 'サン', 'IA'); // 新規登録は末尾に追加
  ui.w.renderStartList();
  assert.deepEqual(bibsOf(), ['2', '1', '9', '3']);

  const u9 = ui.state().riders.find(r => r.bib === '9').uid;
  ui.w.delR(u9); // 削除すると一覧から除外される
  assert.deepEqual(bibsOf(), ['2', '1', '3']);
  assert.deepEqual(ui.errors, []);
});

test('サンプルデータ投入でエラーが出ない', { skip: !JSDOM && 'jsdom 未インストール（npm install）' }, () => {
  const ui = open();
  ui.$('#btnSample').click();
  assert.equal(ui.state().riders.length, 12);
  ui.$('#resView').value = '__all'; ui.w.renderResults();
  assert.equal(ui.w.document.querySelectorAll('.cls-block').length, 3);
  assert.deepEqual(ui.errors, []);
});
