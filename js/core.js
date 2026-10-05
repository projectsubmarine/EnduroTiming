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

  const Core = {
    DAY_MS, NOCLS, STATUS, nat, z2h, parseClock, fmtClock, fmtClockFull, fmtDur, elapsed, compute, csvCell, toCsv, parseCsv,
    clsComparator, isValidBib, bibRange, classForBib, nextBibInClass,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Core;
  else root.Core = Core;
})(this);
