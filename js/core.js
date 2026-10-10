/*
 * core.js — 画面に依存しない計算ロジック（時刻の解析・整形、順位計算、CSV生成）
 * ブラウザでは window.Core、Node では require('./js/core.js') で使える。
 * DOM・localStorage には触れないこと（テストしやすさのため）。
 */
(function (root) {
  'use strict';

  const DAY_MS = 86400000;
  const NOCLS = '（クラス未設定）';
  const STATUS = { OK: '完走', DNF: 'DNF', DNS: 'DNS', DSQ: 'DSQ' };

  /** 自然順比較（"2" < "10"、日本語対応） */
  const nat = (a, b) => String(a ?? '').localeCompare(String(b ?? ''), 'ja', { numeric: true });

  /**
   * クラス名の並び順比較関数を作る。
   * definedOrder（S.classes、クラス設定で登録した順）に載っているクラスはその順。
   * 載っていないクラス（旧データ等）はnat順で後ろに、未設定(NOCLS)は常に最後。
   * definedOrderが空／未指定なら、全クラスをnat順に比較（従来の挙動）。
   * S.classesの要素は文字列（旧形式）・{name,digit}（現形式）のどちらでもよい。
   */
  function clsComparator(definedOrder) {
    const order = (Array.isArray(definedOrder) ? definedOrder : []).map(c => typeof c === 'string' ? c : c?.name);
    return (a, b) => {
      if (a === NOCLS) return b === NOCLS ? 0 : 1;
      if (b === NOCLS) return -1;
      const ia = order.indexOf(a), ib = order.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return nat(a, b);
    };
  }

  /** BIBナンバーが3桁（100〜999）の形式か。下2桁が00（100,200,…,900）は欠番として使用しない */
  function isValidBib(bib) {
    const s = String(bib ?? '');
    if (!/^[1-9]\d{2}$/.test(s)) return false;
    return Number(s) % 100 !== 0;
  }

  /**
   * クラスの「先頭の数字」(1〜9)から、そのクラスのBIB番号帯 {min,max} を返す。範囲外・未指定はnull。
   * 下2桁が00の番号（例：digit=1なら100）は欠番のため、minは+1から始まる。
   */
  function bibRange(digit) {
    const d = Number(digit);
    if (!Number.isInteger(d) || d < 1 || d > 9) return null;
    return { min: d * 100 + 1, max: d * 100 + 99 };
  }

  /**
   * BIBナンバーが、指定クラス一覧（[{name,digit}]）のどのクラスの番号帯に入るかを返す。
   * 該当するクラスが無い（どの番号帯にも入らない／形式が不正）場合はnull。
   */
  function classForBib(bib, classes) {
    const n = parseInt(bib, 10);
    if (!Number.isInteger(n)) return null;
    for (const c of (classes || [])) {
      if (!c || typeof c !== 'object') continue;
      const r = bibRange(c.digit);
      if (r && n >= r.min && n <= r.max) return c.name;
    }
    return null;
  }

  /**
   * 指定クラス名の番号帯の中で、未使用の最小のBIBナンバーを返す（文字列）。
   * クラスが見つからない／先頭の数字が未設定／番号帯が満杯の場合はnull。
   */
  function nextBibInClass(name, classes, usedBibs) {
    const target = (classes || []).find(c => c && typeof c === 'object' && c.name === name);
    const r = target && bibRange(target.digit);
    if (!r) return null;
    const used = new Set((usedBibs || []).map(b => parseInt(b, 10)));
    for (let n = r.min; n <= r.max; n++) if (!used.has(n)) return String(n);
    return null;
  }

  /** 全角数字・記号を半角にし、空白を除去 */
  function z2h(s) {
    return String(s ?? '')
      .replace(/[０-９．：，]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
      .replace(/\s/g, '');
  }

  /**
   * 時刻文字列 → 0時からのミリ秒
   * 受け付ける形式: "10:05", "10:05:23", "10:05:23.45", "100523", "100523.4"（全角可）
   * @returns {number|null} null=空欄, NaN=不正
   */
  function parseClock(s) {
    s = z2h(s);
    if (!s) return null;
    const m = s.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?(?:[.,](\d{1,3}))?$/)
           || s.match(/^(\d{2})(\d{2})(\d{2})(?:[.,](\d{1,3}))?$/);
    if (!m) return NaN;
    const h = +m[1], mi = +m[2], se = +(m[3] || 0), f = +((m[4] || '') + '000').slice(0, 3);
    if (h > 23 || mi > 59 || se > 59) return NaN;
    return ((h * 60 + mi) * 60 + se) * 1000 + f;
  }

  /** 小数部（prec桁、切り捨て） */
  function fracStr(ms, prec) {
    if (!prec) return '';
    return '.' + String(ms % 1000).padStart(3, '0').slice(0, prec);
  }

  /** 時刻表示 "10:05:23.45" */
  function fmtClock(ms, prec = 2) {
    if (ms == null) return '';
    const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}${fracStr(ms, prec)}`;
  }

  /** 時刻を精度を落とさず表示（編集フォーム用。末尾の0は省く） */
  function fmtClockFull(ms) {
    if (ms == null) return '';
    return fmtClock(ms, 3).replace(/\.?0+$/, '').replace(/:(\d\d)$/, ':$1');
  }

  /** 所要時間表示 "5:23.45" / "1:05:23.45" */
  function fmtDur(ms, prec = 2) {
    if (ms == null) return '';
    const h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
    const body = h ? `${h}:${String(m).padStart(2, '0')}` : `${m}`;
    return `${body}:${String(s).padStart(2, '0')}${fracStr(ms, prec)}`;
  }

  /** 1区間のタイム（ms）。完走でない／時刻が欠けている場合は null。ゴール<スタートは日付またぎ扱い */
  function elapsed(run) {
    if (run.status !== 'OK' || run.start == null || run.goal == null) return null;
    let d = run.goal - run.start;
    if (d < 0) d += DAY_MS;
    return d;
  }

  /**
   * 順位計算
   * ルール: ①有効区間数が多い順 ②合計タイムが短い順。DSQを含むライダーは順位なし。同タイムは同順位。
   * @param {object} state  { riders:[], runs:[], settings:{prec} }
   * @returns {{secs:string[], overall:Row[], classes:string[], byClass:Object<string,Row[]>}}
   *   Row: { rd, cls, bySec:{[sec]:{e,r}}, n, total, ranked, label, notes, ovr, ovrGap, clsR, clsRGap }
   */
  function compute(state) {
    const prec = state.settings?.prec ?? 2;
    const secs = [...new Set(state.runs.map(r => r.sec))].sort(nat);

    const rows = state.riders.map(rd => {
      const runs = state.runs.filter(r => r.rider === rd.uid);
      const bySec = {}; let n = 0, total = 0;
      const st = new Set(); const notes = [];
      for (const r of runs) {
        const e = elapsed(r);
        bySec[r.sec] = { e, r };
        if (e != null) { n++; total += e; }
        if (r.status !== 'OK') st.add(r.status);
        if (r.note) notes.push(`S${r.sec}:${r.note}`);
      }
      const dsq = st.has('DSQ');
      let label = '';
      if (dsq) label = 'DSQ';
      else if (n === 0) label = st.has('DNF') ? 'DNF' : st.has('DNS') ? 'DNS' : (runs.length ? '計測中' : '記録なし');
      return {
        rd, cls: rd.cls || NOCLS, bySec, n, total: n ? total : null,
        ranked: !dsq && n > 0, label,
        notes: [rd.note, ...notes].filter(Boolean).join(' / '),
      };
    });

    const cmp = (a, b) => (b.n - a.n) || (a.total - b.total) || nat(a.rd.bib, b.rd.bib);
    const gap = (x, lead) => x === lead ? ''
      : x.n < lead.n ? `-${lead.n - x.n}区間`
      : '+' + fmtDur(x.total - lead.total, prec);

    const assign = (list, key) => {
      const ranked = list.filter(x => x.ranked).sort(cmp);
      let prev = null;
      ranked.forEach((x, i) => {
        x[key] = prev && prev.n === x.n && prev.total === x.total ? prev[key] : i + 1;
        prev = x;
      });
      ranked.forEach(x => { x[key + 'Gap'] = gap(x, ranked[0]); });
      const un = list.filter(x => !x.ranked).sort((a, b) => nat(a.label, b.label) || nat(a.rd.bib, b.rd.bib));
      return ranked.concat(un);
    };

    const overall = assign(rows, 'ovr');
    const classes = [...new Set(rows.map(r => r.cls))].sort(clsComparator(state.classes));
    const byClass = {};
    classes.forEach(c => { byClass[c] = assign(rows.filter(r => r.cls === c), 'clsR'); });
    return { secs, overall, classes, byClass };
  }

  /** CSV（Excelで文字化けしないようBOM付き、CRLF） */
  const csvCell = v => { v = String(v ?? ''); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const toCsv = rows => '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n');

  /**
   * CSV文字列を行×列の文字列配列に変換する（RFC4180相当）。
   * 引用符 "…" によるエスケープ（内部の""は"1つ）、カンマ・改行を含むフィールド、CRLF/LFどちらも対応。
   * 先頭のBOMは除去。完全に空の行（内容が1つもない行）はスキップする。
   */
  function parseCsv(text) {
    const s = String(text ?? '').replace(/^﻿/, '');
    const rows = [];
    let row = [], field = '', inQ = false;
    const pushField = () => { row.push(field); field = ''; };
    const pushRow = () => { pushField(); if (row.length > 1 || row[0] !== '') rows.push(row); row = []; };
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (inQ) {
        if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
        else field += c;
      } else if (c === '"') inQ = true;
      else if (c === ',') pushField();
      else if (c === '\n') pushRow();
      else if (c === '\r') { if (s[i + 1] === '\n') i++; pushRow(); }
      else field += c;
    }
    if (field !== '' || row.length) pushRow();
    return rows;
  }

  /**
   * 他端末（各走行セクションを個別に計測するPCなど）のバックアップデータを、現在の状態に
   * 「タイム記録（runs）だけ」マージする。ライダー登録・クラス設定などは変更しない。
   *
   * 対応付けは rider の uid 優先（本部で配布した名簿をそのまま読み込んだ端末なら一致する）。
   * uid が一致しない場合（セクション側で独自に追加したライダーなど）は、incoming側の riders から
   * BIBを引いて、現在の riders をBIBで探す（本部で後から同じBIBのライダーを登録していれば救済できる）。
   * どちらにも一致しなければ unmatched に積んで取り込まない（データを失わないため、現在のstateは変更しない）。
   *
   * 既存の記録が空欄の項目は、取り込んだ値で埋める（merged）。start/goalの両方に値があり、既存と
   * 取り込み側で異なる場合は上書きせず conflicts に積む（その記録はまるごと変更しない）。
   * 既存と完全に同じ内容なら unchanged。新規の(rider,sec)の組み合わせなら added。
   *
   * @param {object} state 現在の状態（{riders, runs} を含む）。このオブジェクト自体は変更しない。
   * @param {object} incoming 取り込むデータ（{riders, runs} を含む。バックアップJSON全体でよい）
   * @param {() => string} [mkUid] 新規runに使うuid生成関数（省略時は内蔵の簡易生成器）
   * @returns {{runs:object[], added:number, merged:number, unchanged:number,
   *            conflicts:{bib,name,sec}[], unmatched:{bib,name,sec}[]}}
   */
  function mergeSectionData(state, incoming, mkUid) {
    const genUid = mkUid || (() => Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
    const riders = state.riders || [];
    const byUid = new Map(riders.map(r => [r.uid, r]));
    const byBib = new Map(riders.map(r => [String(r.bib), r]));
    const inRidersByUid = new Map((incoming.riders || []).map(r => [r.uid, r]));

    const runs = (state.runs || []).map(r => ({ ...r }));
    const keyOf = (riderUid, sec) => riderUid + '\u0000' + sec;
    const byKey = new Map(runs.map(r => [keyOf(r.rider, r.sec), r]));

    let added = 0, merged = 0, unchanged = 0;
    const conflicts = [], unmatched = [];

    for (const inRun of (incoming.runs || [])) {
      const inRider = inRidersByUid.get(inRun.rider);
      const rider = byUid.get(inRun.rider) || (inRider && byBib.get(String(inRider.bib)));
      if (!rider) {
        unmatched.push({ bib: inRider ? inRider.bib : '?', name: inRider ? inRider.name : '', sec: inRun.sec });
        continue;
      }
      const existing = byKey.get(keyOf(rider.uid, inRun.sec));
      if (!existing) {
        const row = { uid: genUid(), rider: rider.uid, sec: inRun.sec, start: inRun.start ?? null,
          goal: inRun.goal ?? null, status: inRun.status || 'OK', note: inRun.note || '' };
        runs.push(row); byKey.set(keyOf(rider.uid, inRun.sec), row);
        added++;
        continue;
      }
      const conflict = (inRun.start != null && existing.start != null && inRun.start !== existing.start)
                     || (inRun.goal != null && existing.goal != null && inRun.goal !== existing.goal);
      if (conflict) {
        conflicts.push({ bib: rider.bib, name: rider.name, sec: inRun.sec });
        continue;
      }
      let changed = false;
      if (existing.start == null && inRun.start != null) { existing.start = inRun.start; changed = true; }
      if (existing.goal == null && inRun.goal != null) { existing.goal = inRun.goal; changed = true; }
      if (inRun.status && inRun.status !== existing.status) { existing.status = inRun.status; changed = true; }
      if (inRun.note && inRun.note !== existing.note) { existing.note = inRun.note; changed = true; }
      if (changed) merged++; else unchanged++;
    }
    return { runs, added, merged, unchanged, conflicts, unmatched };
  }

  /**
   * オンライン版：入力記録（entries。追記のみで書き換えない）から runs を組み立てる。
   * entry: { id, rider（riders.uid。不明ならnull）, bib, sec, start?, goal?, status?, note?,
   *          fix?（訂正：既存の値を上書き）, del?（その(rider,sec)の記録を削除）, by, dev, clientAt }
   *
   * - clientAt（端末の時計、epoch ms）の順に適用する。同時刻は id 順。
   * - ライダーは rider(uid) 優先、見つからなければ bib で riders を探す（後から本部で登録すれば自動で紐づく）。
   *   どちらにも一致しないものは unmatched に積む。
   * - start/goal：通常の entry は「空欄なら入れる・同じ値なら何もしない・違う値なら上書きせず conflicts に積む」
   *   （データを失わないため。オフライン版の mergeSectionData と同じ考え方）。
   *   fix の entry は、項目があれば（nullでも）上書きし、その項目の競合を解消済みにする。
   * - status：指定があれば後勝ち。note：空でなければ後勝ち（fix なら空でも上書き）。
   * - del：その(rider,sec)の記録と競合を消す。
   *
   * @param {object[]} entries
   * @param {object[]} riders 現在の riders
   * @returns {{runs:object[], conflicts:{rider,sec,field,kept,value,by,dev,clientAt,id}[], unmatched:object[]}}
   */
  function runsFromEntries(entries, riders) {
    const byUid = new Map((riders || []).map(r => [r.uid, r]));
    const byBib = new Map((riders || []).filter(r => r.bib !== '' && r.bib != null).map(r => [String(r.bib), r]));
    const sorted = (entries || []).slice().sort((a, b) =>
      ((a.clientAt || 0) - (b.clientAt || 0)) || String(a.id ?? '').localeCompare(String(b.id ?? '')));
    const runs = new Map(), conflicts = new Map(), unmatched = [];
    for (const e of sorted) {
      const rider = byUid.get(e.rider) || (e.bib != null && e.bib !== '' ? byBib.get(String(e.bib)) : undefined);
      if (!rider) { unmatched.push(e); continue; }
      const sec = String(e.sec ?? '');
      const key = rider.uid + '\u0000' + sec;
      if (e.del) {
        runs.delete(key);
        for (const k of [...conflicts.keys()]) if (k.startsWith(key + '\u0000')) conflicts.delete(k);
        continue;
      }
      let run = runs.get(key);
      if (!run) {
        run = { uid: rider.uid + '_' + sec, rider: rider.uid, sec, start: null, goal: null, status: 'OK', note: '' };
        runs.set(key, run);
      }
      for (const f of ['start', 'goal']) {
        const ck = key + '\u0000' + f;
        if (e.fix) {
          if (f in e) { run[f] = e[f] ?? null; conflicts.delete(ck); }
          continue;
        }
        const v = e[f];
        if (v == null) continue;
        if (run[f] == null) run[f] = v;
        else if (run[f] !== v) {
          if (!conflicts.has(ck)) conflicts.set(ck, []);
          conflicts.get(ck).push({ rider: rider.uid, sec, field: f, kept: run[f], value: v,
            by: e.by, dev: e.dev, clientAt: e.clientAt, id: e.id });
        }
      }
      if (e.status) run.status = e.status;
      if (e.note || (e.fix && 'note' in e)) run.note = e.note || '';
    }
    return { runs: [...runs.values()], conflicts: [...conflicts.values()].flat(), unmatched };
  }

  /** runs（オフライン版のデータ）を、オンライン版の entry（訂正扱い）に変換する。初回の公開時に既存の記録を引き継ぐため */
  function entriesFromRuns(runs, riders) {
    const byUid = new Map((riders || []).map(r => [r.uid, r]));
    return (runs || []).filter(x => byUid.has(x.rider)).map(x => ({
      rider: x.rider, bib: String(byUid.get(x.rider).bib ?? ''), sec: String(x.sec),
      start: x.start ?? null, goal: x.goal ?? null, status: x.status || 'OK', note: x.note || '', fix: true,
    }));
  }

  /**
   * スタート間隔の文字列 → ミリ秒
   * 受け付ける形式: "30"（秒）, "30.5", "1:30"（分:秒）, "1:30.5"（全角可）
   * @returns {number|null} null=空欄, NaN=不正
   */
  function parseInterval(s) {
    s = z2h(s);
    if (!s) return null;
    const m = s.match(/^(?:(\d{1,3}):)?(\d{1,4})(?:[.,](\d{1,3}))?$/);
    if (!m) return NaN;
    const mi = +(m[1] || 0), se = +m[2], f = +((m[3] || '') + '000').slice(0, 3);
    if (m[1] != null && se > 59) return NaN;
    return (mi * 60 + se) * 1000 + f;
  }

  /** スタート間隔の表示（入力欄用）。60秒未満は秒 "30" / "30.5"、それ以上は "1:30" */
  function fmtInterval(ms) {
    if (ms == null) return '';
    const frac = ms % 1000 ? '.' + String(ms % 1000).padStart(3, '0').replace(/0+$/, '') : '';
    const se = Math.floor(ms / 1000);
    return se < 60 ? se + frac : `${Math.floor(se / 60)}:${String(se % 60).padStart(2, '0')}${frac}`;
  }

  /**
   * クラスごとの「1番走者の出走時刻」「スタート間隔」から、各走者のスタート時刻を求める。
   * 各クラスの中の順番は startOrder（出走順）に従う。出走時刻・間隔のどちらかが未設定のクラスは対象外。
   * 24時を超えた場合は翌日の時刻（0時からのms）に折り返す。
   * @param {object} state { riders, startOrder, startPlan:{ classes:{ [クラス名]:{first, interval} } } }
   * @returns {{rider:string, start:number}[]} 出走順に並んだ（riders.uid, スタート時刻ms）の配列
   */
  function planStartTimes(state) {
    const plan = (state.startPlan && state.startPlan.classes) || {};
    const byUid = new Map((state.riders || []).map(r => [r.uid, r]));
    const count = new Map(), out = [];
    for (const u of (state.startOrder || [])) {
      const r = byUid.get(u);
      if (!r) continue;
      const cls = r.cls || NOCLS, p = plan[cls];
      if (!p || p.first == null || p.interval == null) continue;
      const i = count.get(cls) || 0;
      count.set(cls, i + 1);
      out.push({ rider: u, start: (p.first + i * p.interval) % DAY_MS });
    }
    return out;
  }

  /**
   * planStartTimes() の結果を、指定セクションの runs のスタート時刻に反映する（state は変更せず、新しい runs を返す）。
   * 記録が無ければ新規追加（ゴール未入力・状態OK）、あればスタート時刻だけを書き換える（ゴール・状態・特記事項は残す）。
   * @param {object[]} runs 現在の runs
   * @param {{rider:string, start:number}[]} list planStartTimes() の結果
   * @param {string} sec セクション#
   * @param {() => string} [mkUid] 新規runに使うuid生成関数
   * @returns {{runs:object[], added:number, filled:number, overwritten:number, unchanged:number}}
   *   filled=スタート未入力の既存記録に入れた件数、overwritten=別の時刻が入っていた記録を書き換えた件数
   */
  function applyStartTimes(runs, list, sec, mkUid) {
    const genUid = mkUid || (() => Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
    const out = (runs || []).map(r => ({ ...r }));
    const byRider = new Map(out.filter(r => r.sec === sec).map(r => [r.rider, r]));
    let added = 0, filled = 0, overwritten = 0, unchanged = 0;
    for (const { rider, start } of list) {
      const ex = byRider.get(rider);
      if (!ex) {
        const row = { uid: genUid(), rider, sec, start, goal: null, status: 'OK', note: '' };
        out.push(row); byRider.set(rider, row); added++;
      } else if (ex.start == null) { ex.start = start; filled++; }
      else if (ex.start !== start) { ex.start = start; overwritten++; }
      else unchanged++;
    }
    return { runs: out, added, filled, overwritten, unchanged };
  }

  const Core = {
    DAY_MS, NOCLS, STATUS, nat, z2h, parseClock, fmtClock, fmtClockFull, fmtDur, elapsed, compute, csvCell, toCsv, parseCsv,
    clsComparator, isValidBib, bibRange, classForBib, nextBibInClass, mergeSectionData, runsFromEntries, entriesFromRuns,
    parseInterval, fmtInterval, planStartTimes, applyStartTimes,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  else root.Core = Core;
})(this);
