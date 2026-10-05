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
      w.alert = m => alerts.push(m); w.confirm = () => true; w.scrollTo = () => {}; w.print = () => {};
      w.HTMLFormElement.prototype.requestSubmit = function () { this.dispatchEvent(new w.Event('submit', { cancelable: true })); };
      w.addEventListener('error', e => errors.push(e.message));
    },
  });
  const w = dom.window, $ = s => w.document.querySelector(s);
  const submit = f => $(f).dispatchEvent(new w.Event('submit', { cancelable: true }));
  const rider = (bib, name, cls) => { $('#r_bib').value = bib; $('#r_name').value = name; $('#r_cls').value = cls; submit('#rForm'); };
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

test('サンプルデータ投入でエラーが出ない', { skip: !JSDOM && 'jsdom 未インストール（npm install）' }, () => {
  const ui = open();
  ui.$('#btnSample').click();
  assert.equal(ui.state().riders.length, 12);
  ui.$('#resView').value = '__all'; ui.w.renderResults();
  assert.equal(ui.w.document.querySelectorAll('.cls-block').length, 3);
  assert.deepEqual(ui.errors, []);
});
