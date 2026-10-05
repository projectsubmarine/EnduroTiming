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
  const fire = (el, type) => $(el).dispatchEvent(new w.Event(type, { cancelable: true }));
  // クラスは「参加クラス設定」で登録してから選ぶ運用になったため、未登録なら先に追加する（digitは任意：BIB先頭の数字）
  const addClass = (cls, digit) => {
    if (!cls || [...$('#r_cls').options].some(o => o.value === cls)) return;
    $('#cls_name').value = cls; $('#cls_digit').value = digit ? String(digit) : ''; submit('#clsForm');
  };
  const rider = (bib, name, cls, digit) => { addClass(cls, digit); $('#r_bib').value = bib; $('#r_name').value = name; $('#r_cls').value = cls; submit('#rForm'); };
  const time = (bib, sec, st, gl) => { $('#t_bib').value = bib; $('#t_sec').value = sec; $('#t_start').value = st; $('#t_goal').value = gl; submit('#tForm'); };
  const state = () => JSON.parse(w.localStorage.getItem('raceTimer_v1'));
  return { w, $, fire, submit, rider, addClass, time, state, errors, alerts };
}

test('登録→タイム入力→結果表示', { skip: !JSDOM && 'jsdom 未インストール（npm install）' }, () => {
  const ui = open();
  ui.rider('１０１', '太郎', 'IA');           // 全角BIB
  ui.rider('102', '次郎', 'IA');
  ui.rider('102', '重複', 'IA');              // BIB重複 → 拒否
  assert.equal(ui.state().riders.length, 2);

  ui.time('101', '1', '10:00:00.5', '');      // スタートのみ
  ui.time('101', '1', '', '10:05:00.25');     // 後からゴール（マージ）
  ui.time('102', '1', '１００１００', '10:06:00');
  ui.time('103', '1', '1:00', '1:01');        // 未登録BIB → 拒否
  ui.time('102', '1', '10:01:00', '25:00');   // 不正時刻 → 拒否

  const S = ui.state();
  assert.equal(S.runs.length, 2);
  assert.deepEqual([S.runs[0].start, S.runs[0].goal], [36000500, 36300250]);
  assert.equal(ui.alerts.length, 3);

  ui.$('#resView').value = '__ovr'; ui.w.renderResults();
  const rows = [...ui.w.document.querySelectorAll('#resArea tr')]
    .map(r => [...r.cells].map(c => c.textContent.trim()));
  // 列: 総合, クラス順位, BIB, 氏名, クラス, S1, 区間数, 合計
  assert.deepEqual(rows[1].slice(0, 8), ['1', '1', '101', '太郎', 'IA', '4:59.75', '1', '4:59.75']);
  assert.deepEqual(rows[2].slice(0, 4), ['2', '2', '102', '次郎']);
  assert.deepEqual(ui.errors, []);
});

test('BIBナンバー：3桁必須・下2桁00は不可・クラスのBIB番号帯との不一致を拒否', { skip: !JSDOM && 'jsdom 未インストール（npm install）' }, () => {
  const ui = open();
  ui.addClass('IA', 1); // 101〜199
  ui.addClass('IB', 2); // 201〜299

  ui.$('#r_bib').value = '12'; ui.$('#r_name').value = '太郎'; ui.$('#r_cls').value = '';
  ui.submit('#rForm');
  assert.equal(ui.state().riders.length, 0);
  assert.ok(ui.alerts.at(-1).includes('3桁'));

  ui.$('#r_bib').value = '100'; ui.$('#r_name').value = 'ゼロ'; ui.$('#r_cls').value = ''; // 下2桁00は欠番
  ui.submit('#rForm');
  assert.equal(ui.state().riders.length, 0);
  assert.ok(ui.alerts.at(-1).includes('00'));

  ui.$('#r_bib').value = '250'; ui.$('#r_name').value = '次郎'; ui.$('#r_cls').value = 'IA'; // IAの番号帯(101〜199)と不一致
  ui.submit('#rForm');
  assert.equal(ui.state().riders.length, 0);
  assert.ok(ui.alerts.at(-1).includes('番号帯'));

  ui.$('#r_bib').value = '150'; ui.$('#r_name').value = '三郎'; ui.$('#r_cls').value = 'IA';
  ui.submit('#rForm');
  assert.equal(ui.state().riders.at(-1).bib, '150');
  assert.deepEqual(ui.errors, []);
});

test('BIBナンバー：クラス選択でBIB先頭の数字の番号帯（x00を除く）から自動入力される', { skip: !JSDOM && 'jsdom 未インストール（npm install）' }, () => {
  const ui = open();
  ui.addClass('IA', 1); // 101〜199

  ui.$('#r_cls').value = 'IA'; ui.fire('#r_cls', 'change');
  assert.equal(ui.$('#r_bib').value, '101'); // 未使用の最小番号（100は欠番なので101から）
  ui.$('#r_name').value = '太郎';
  ui.submit('#rForm');
  assert.equal(ui.state().riders.at(-1).bib, '101');

  ui.$('#r_cls').value = 'IA'; ui.fire('#r_cls', 'change'); // 登録後は自動でクラスが保持され、次の番号が入る
  assert.equal(ui.$('#r_bib').value, '102');

  ui.$('#r_bib').value = ''; ui.$('#r_cls').value = ''; ui.fire('#r_cls', 'change');
  assert.equal(ui.$('#r_bib').value, ''); // クラス未選択では自動入力しない
  assert.deepEqual(ui.errors, []);
});

test('クラス設定：追加・使用中は削除不可・名称変更で全ライダーに反映', { skip: !JSDOM && 'jsdom 未インストール（npm install）' }, () => {
  const ui = open();
  ui.rider('101', '太郎', 'IA');
  ui.rider('201', '次郎', 'IB');
  assert.deepEqual(ui.state().classes.map(c => c.name), ['IA', 'IB']);

  ui.w.delCls(0); // IAはライダーが使用中なので削除できない
  assert.ok(ui.alerts.at(-1).includes('使用中'));
  assert.deepEqual(ui.state().classes.map(c => c.name), ['IA', 'IB']);

  ui.w.prompt = () => 'IA改';
  ui.w.renameCls(0); // 名称変更は既存ライダーのクラスにも反映される
  const S = ui.state();
  assert.deepEqual(S.classes.map(c => c.name), ['IA改', 'IB']);
  assert.equal(S.riders.find(r => r.bib === '101').cls, 'IA改');
  assert.deepEqual(ui.errors, []);
});

test('クラス設定：BIB先頭の数字の設定・重複防止、旧形式（文字列配列）からの移行', { skip: !JSDOM && 'jsdom 未インストール（npm install）' }, () => {
  const ui = open();
  ui.addClass('IA', 1);
  ui.addClass('IB'); // 先頭の数字は未設定のまま追加

  ui.w.prompt = () => '2';
  ui.w.setClsDigit(1); // IBに2を設定
  assert.deepEqual(ui.state().classes, [{ name: 'IA', digit: 1 }, { name: 'IB', digit: 2 }]);

  ui.w.prompt = () => '1'; // IAと重複するので拒否
  ui.w.setClsDigit(1);
  assert.ok(ui.alerts.at(-1).includes('使われています'));
  assert.deepEqual(ui.state().classes, [{ name: 'IA', digit: 1 }, { name: 'IB', digit: 2 }]);

  // 旧形式（classesが文字列配列）のバックアップは読み込み時に{name,digit}形式へ移行される
  const legacy = { version: 1, event: {}, settings: { prec: 2 }, classes: ['X', 'Y'], riders: [], startOrder: [], runs: [] };
  ui.w.localStorage.setItem('raceTimer_v1', JSON.stringify(legacy));
  ui.w.load(); ui.w.save(); ui.w.renderAll();
  assert.deepEqual(ui.state().classes, [{ name: 'X', digit: null }, { name: 'Y', digit: null }]);
  assert.deepEqual(ui.errors, []);
});

test('スタートリスト：並び順の初期化（クラス→BIB順）・手動入替・新規登録は末尾に追加', { skip: !JSDOM && 'jsdom 未インストール（npm install）' }, () => {
  const ui = open();
  ui.rider('101', 'イチ', 'IA');
  ui.rider('109', 'キュウ', 'IB');
  ui.rider('102', 'ニ', 'IA');
  const bibsOf = () => { const S = ui.state(); return S.startOrder.map(u => S.riders.find(r => r.uid === u).bib); };
  assert.deepEqual(bibsOf(), ['101', '109', '102']); // 登録順にそのまま末尾へ追加される

  ui.$('#btnStartReset').click(); // クラス設定順(IA→IB)→BIB順に初期化
  assert.deepEqual(bibsOf(), ['101', '102', '109']);

  const order = ui.state().startOrder;
  ui.w.moveStart(order[1], -1); // 先頭2件を手動で入替
  assert.deepEqual(bibsOf(), ['102', '101', '109']);

  ui.rider('103', 'サン', 'IA'); // 新規登録は末尾に追加
  ui.w.renderStartList();
  assert.deepEqual(bibsOf(), ['102', '101', '109', '103']);

  const u109 = ui.state().riders.find(r => r.bib === '109').uid;
  ui.w.delR(u109); // 削除すると一覧から除外される
  assert.deepEqual(bibsOf(), ['102', '101', '103']);
  assert.deepEqual(ui.errors, []);
});

test('クラスの出走順：①の参加クラス設定（結果表の表示順）とは別に、▲▼で設定・変更できる', { skip: !JSDOM && 'jsdom 未インストール（npm install）' }, () => {
  const ui = open();
  ui.rider('101', 'イチ', 'IA'); // IAが先に登録される → S.classesはIA,IB順
  ui.rider('201', 'ニ', 'IB');
  ui.rider('102', 'サン', 'IA');
  assert.deepEqual(ui.state().classes.map(c => c.name), ['IA', 'IB']);
  assert.deepEqual(ui.state().startClassOrder, ['IA', 'IB']); // 初期値はクラス設定順に揃う

  ui.w.moveStartClass(0, 1); // クラスの出走順だけをIB→IAに入れ替える
  const S1 = ui.state();
  assert.deepEqual(S1.startClassOrder, ['IB', 'IA']);
  assert.deepEqual(S1.classes.map(c => c.name), ['IA', 'IB']); // ①の表示順は変わらない（結果表はIA→IBのまま）

  const bibsOf = () => { const S = ui.state(); return S.startOrder.map(u => S.riders.find(r => r.uid === u).bib); };
  assert.deepEqual(bibsOf(), ['201', '101', '102']); // 出走順はIBクラス→IAクラス(BIB昇順)に即時反映される

  ui.$('#btnStartReset').click(); // 初期化も「クラスの出走順」を使う（①の表示順ではない）
  assert.deepEqual(bibsOf(), ['201', '101', '102']);

  ui.w.prompt = () => 'IB改';
  ui.w.renameCls(1); // IB→IB改。クラスの出走順にも反映される
  assert.deepEqual(ui.state().startClassOrder, ['IB改', 'IA']);
  assert.deepEqual(ui.errors, []);
});

test('サンプルデータ投入でエラーが出ない', { skip: !JSDOM && 'jsdom 未インストール（npm install）' }, () => {
  const ui = open();
  ui.$('#btnSample').click();
  const S = ui.state();
  assert.equal(S.riders.length, 12);
  assert.ok(S.riders.every(r => /^[1-9]\d{2}$/.test(r.bib) && Number(r.bib) % 100 !== 0)); // すべて3桁BIB・下2桁00なし
  ui.$('#resView').value = '__all'; ui.w.renderResults();
  assert.equal(ui.w.document.querySelectorAll('.cls-block').length, 3);
  assert.deepEqual(ui.errors, []);
});
