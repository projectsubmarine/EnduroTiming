/*
 * app.js — 画面（DOM操作・入力フォーム・保存・出力）
 * 計算ロジックは core.js（window.Core）にある。状態は S に集約し、変更したら save() → render*() を呼ぶ。
 */
'use strict';
const KEY='raceTimer_v1';
const $=s=>document.querySelector(s);
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const {nat,z2h,parseClock,elapsed,NOCLS,STATUS,toCsv}=Core;
// 表示用：現在の表示桁数設定で整形
const fmtClock=ms=>Core.fmtClock(ms,S.settings.prec);
const fmtDur=ms=>Core.fmtDur(ms,S.settings.prec);
const fmtClockFull=Core.fmtClockFull;
const compute=()=>Core.compute(S);

let S=blank();
function blank(){return {version:2,event:{name:'',date:''},settings:{prec:2},classes:[],riders:[],startOrder:[],startClassOrder:[],startPlan:{sec:'1',classes:{}},runs:[]};}

/* ---------- 保存 ---------- */
// 旧バックアップを補う：
// ・v1以前：classes/startOrderが無い → 補完
// ・startPlan（スタート時刻の自動入力の設定）が無い → 空の設定を補完（versionは2のまま。項目の追加のみ）
// ・v1：classesが文字列配列 → {name,digit}形式へ変換（digitは未設定=null）
function migrate(){
  if(!Array.isArray(S.classes))S.classes=[];
  S.classes=S.classes.map(c=>typeof c==='string'?{name:c,digit:null}:{name:c.name,digit:c.digit??null});
  if(!Array.isArray(S.startOrder))S.startOrder=[];
  if(!Array.isArray(S.startClassOrder))S.startClassOrder=[];
  if(!S.startPlan||typeof S.startPlan!=='object')S.startPlan={sec:'1',classes:{}};
  if(!S.startPlan.classes||typeof S.startPlan.classes!=='object')S.startPlan.classes={};
  if(!S.startPlan.sec)S.startPlan.sec='1';
  if(!S.classes.length&&S.riders.length)S.classes=[...new Set(S.riders.map(r=>r.cls).filter(Boolean))].sort(nat).map(name=>({name,digit:null}));
  S.version=2;
  syncStartClassOrder();syncStartOrder();
}
function load(){
  try{const t=localStorage.getItem(KEY);if(t){const d=JSON.parse(t);S=Object.assign(blank(),d);migrate();}}
  catch(e){setStatus('⚠ 保存データを読み込めませんでした');}
}
function save(){
  if(olOn())olDerive(); // オンライン時は記録をサーバーの入力記録から組み立て直す（ライダー登録で不明BIBが解消する等）
  try{localStorage.setItem(KEY,JSON.stringify(S));setStatus('自動保存 '+new Date().toLocaleTimeString('ja-JP'));}
  catch(e){setStatus('⚠ ブラウザに保存できません。バックアップを書き出してください');}
  if(olOn()){olPushRoster();renderRuns();renderOlBanner();} // 名簿の変更で記録の紐づけ・競合表示が変わることがある
}
function setStatus(t){$('#status').textContent=t;}

/* ---------- 時刻 ---------- */
const riderOf=u=>S.riders.find(r=>r.uid===u);
// BIB未設定（CSV取り込み直後など）のライダーが複数いても、空欄入力では一致させない
const riderByBib=b=>{b=z2h(b);if(!b)return undefined;return S.riders.find(r=>String(r.bib)===b);};

/* ---------- タブ ---------- */
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('nav button').forEach(x=>x.classList.toggle('on',x===b));
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('on',t.id==='tab-'+b.dataset.tab));
  if(b.dataset.tab==='res')renderResults();
  if(b.dataset.tab==='start')renderStartList();
  if(b.dataset.tab==='times')$('#t_bib').focus();
});

// Enterで次の欄へ、最後の欄でEnterを押すと登録
function enterNav(form){
  form.addEventListener('keydown',e=>{
    if(e.key!=='Enter'||e.isComposing||e.target.tagName==='BUTTON')return;
    e.preventDefault();
    const f=[...form.querySelectorAll('input,select')].filter(x=>!x.hidden&&!x.disabled);
    const i=f.indexOf(e.target);
    if(i>=0&&i<f.length-1){f[i+1].focus();f[i+1].select?.();}else form.requestSubmit();
  });
}

/* ---------- 参加クラス設定 ---------- */
// S.classes の要素は {name, digit} 。digit（1〜9）は任意：BIBナンバーの100の位をこのクラスの番号帯として扱う。
$('#clsForm').onsubmit=e=>{
  e.preventDefault();
  const name=$('#cls_name').value.trim();
  const digit=$('#cls_digit').value?+$('#cls_digit').value:null;
  if(!name)return;
  if(S.classes.some(c=>c.name===name)){alert(`クラス「${name}」は既に登録されています`);return;}
  if(digit&&S.classes.some(c=>c.digit===digit)){alert(`BIB先頭の数字「${digit}」は既に別のクラスで使われています`);return;}
  S.classes.push({name,digit});$('#cls_name').value='';$('#cls_digit').value='';
  save();renderClasses();
};
function moveCls(i,dir){
  const j=i+dir;if(j<0||j>=S.classes.length)return;
  [S.classes[i],S.classes[j]]=[S.classes[j],S.classes[i]];
  save();renderClasses();renderRiders();
}
function renameCls(i){
  const cur=S.classes[i];
  const name=prompt('新しいクラス名を入力してください',cur.name);
  if(name==null)return;
  const v=name.trim();
  if(!v){alert('クラス名を入力してください');return;}
  if(v!==cur.name&&S.classes.some(c=>c.name===v)){alert(`クラス「${v}」は既に登録されています`);return;}
  const old=cur.name;cur.name=v;
  S.riders.forEach(r=>{if(r.cls===old)r.cls=v;});
  S.startClassOrder=S.startClassOrder.map(n=>n===old?v:n);
  if(S.startPlan.classes[old]){S.startPlan.classes[v]=S.startPlan.classes[old];delete S.startPlan.classes[old];}
  save();renderClasses();renderRiders();renderStartList();
}
function setClsDigit(i){
  const cur=S.classes[i];
  const input=prompt('BIBナンバーの先頭の数字（1〜9）を入力してください。\n設定しない場合は空欄のままにしてください。',cur.digit??'');
  if(input==null)return;
  const t=input.trim();
  if(!t){cur.digit=null;save();renderClasses();return;}
  if(!/^[1-9]$/.test(t)){alert('先頭の数字は1〜9の半角数字で入力してください');return;}
  const d=+t;
  if(S.classes.some((c,j)=>j!==i&&c.digit===d)){alert(`BIB先頭の数字「${d}」は既に別のクラスで使われています`);return;}
  cur.digit=d;save();renderClasses();
}
function delCls(i){
  const name=S.classes[i].name;const n=S.riders.filter(r=>r.cls===name).length;
  if(n){alert(`クラス「${name}」は ${n} 名のライダーが使用中のため削除できません。先にライダーのクラスを変更してください。`);return;}
  if(!confirm(`クラス「${name}」を削除しますか？`))return;
  S.classes.splice(i,1);save();renderClasses();
}
function renderClasses(){
  $('#clsTable').innerHTML=`<tr><th>クラス名</th><th class="c">BIB先頭の数字</th><th class="c">番号帯</th><th class="c">人数</th><th class="noprint"></th></tr>`+
    S.classes.map((c,i)=>{const r=Core.bibRange(c.digit);
      return `<tr><td><b>${esc(c.name)}</b></td><td class="c">${c.digit??'<span class="muted">未設定</span>'}</td>
      <td class="c">${r?`${r.min}〜${r.max}`:'<span class="muted">—</span>'}</td>
      <td class="c">${S.riders.filter(x=>x.cls===c.name).length}</td>
      <td class="noprint"><button class="b s" ${i===0?'disabled':''} onclick="moveCls(${i},-1)">▲</button>
      <button class="b s" ${i===S.classes.length-1?'disabled':''} onclick="moveCls(${i},1)">▼</button>
      <button class="b s" onclick="renameCls(${i})">名称変更</button>
      <button class="b s" onclick="setClsDigit(${i})">先頭の数字</button>
      <button class="b s d" onclick="delCls(${i})">削除</button></td></tr>`;}).join('')+
    (S.classes.length?'':`<tr><td colspan="5" class="muted">クラスが登録されていません</td></tr>`);
  const sel=$('#r_cls'),cur=sel.value;
  sel.innerHTML='<option value="">（未設定）</option>'+S.classes.map(c=>{const r=Core.bibRange(c.digit);
    return `<option value="${esc(c.name)}">${esc(c.name)}${r?`（${r.min}〜${r.max}）`:''}</option>`;}).join('');
  sel.value=[...sel.options].some(o=>o.value===cur)?cur:'';
}

/* ---------- ① ライダー ---------- */
let editRider=null;
enterNav($('#rForm'));
// クラスを選ぶと、そのクラスのBIB番号帯（先頭の数字）から未使用の最小番号を自動入力する（BIB欄が空の時のみ）
function autoFillBib(){
  if($('#r_bib').value.trim())return;
  const name=$('#r_cls').value;if(!name)return;
  const used=S.riders.filter(r=>r.uid!==editRider).map(r=>r.bib);
  const next=Core.nextBibInClass(name,S.classes,used);
  if(next)$('#r_bib').value=next;
}
$('#r_cls').addEventListener('change',autoFillBib);
$('#rForm').onsubmit=e=>{
  e.preventDefault();
  const v={bib:z2h($('#r_bib').value),name:$('#r_name').value.trim(),
    kana:$('#r_kana').value.trim(),cls:$('#r_cls').value.trim(),tag:$('#r_tag').value.trim(),note:$('#r_note').value.trim()};
  if(!v.bib||!v.name){alert('BIBナンバーと氏名は必須です');return;}
  if(!Core.isValidBib(v.bib)){alert('BIBナンバーは100〜999の3桁の数字で入力してください（下2桁が00の番号は使用しません）');$('#r_bib').focus();return;}
  const others=S.riders.filter(r=>r.uid!==editRider);
  if(others.some(r=>String(r.bib)===v.bib)){alert(`BIB ${v.bib} は既に登録されています`);$('#r_bib').focus();return;}
  if(v.cls){
    const target=S.classes.find(c=>c.name===v.cls);
    const range=target&&Core.bibRange(target.digit);
    if(range&&(+v.bib<range.min||+v.bib>range.max)){
      alert(`BIB ${v.bib} はクラス「${v.cls}」のBIB番号帯（${range.min}〜${range.max}）と一致しません`);$('#r_bib').focus();return;
    }
  }
  if(v.tag&&others.some(r=>r.tag&&r.tag===v.tag)){alert(`ICタグ ${v.tag} は既に登録されています`);$('#r_tag').focus();return;}
  if(editRider){Object.assign(riderOf(editRider),v);}
  else S.riders.push({uid:uid(),...v});
  const keepCls=v.cls;
  resetRiderForm();$('#r_cls').value=keepCls;autoFillBib();
  syncStartClassOrder();syncStartOrder();save();renderRiders();renderStartList();$('#r_bib').focus();
};
function resetRiderForm(){
  editRider=null;$('#rForm').reset();
  $('#rFormTitle').textContent='ライダー登録';$('#rSubmit').textContent='登録';$('#rCancel').hidden=true;
}
$('#rCancel').onclick=resetRiderForm;
function editR(u){
  const r=riderOf(u);if(!r)return;editRider=u;
  for(const k of ['bib','name','kana','cls','tag','note'])$('#r_'+k).value=r[k]??'';
  $('#rFormTitle').textContent=`ライダー編集（BIB ${r.bib}）`;$('#rSubmit').textContent='更新';$('#rCancel').hidden=false;
  $('#r_bib').focus();window.scrollTo({top:0,behavior:'smooth'});
}
function delR(u){
  const r=riderOf(u);const n=S.runs.filter(x=>x.rider===u).length;
  if(!confirm(`BIB ${r.bib} ${r.name} を削除しますか？${n?`\nタイム記録 ${n} 件も一緒に削除されます。`:''}`))return;
  S.riders=S.riders.filter(x=>x.uid!==u);S.runs=S.runs.filter(x=>x.rider!==u);
  if(editRider===u)resetRiderForm();
  syncStartClassOrder();syncStartOrder();save();renderRiders();renderStartList();
}
function renderRiders(){
  const q=$('#rFilter').value.trim().toLowerCase();
  const list=S.riders.slice().sort((a,b)=>nat(a.bib,b.bib))
    .filter(r=>!q||[r.bib,r.name,r.kana,r.cls,r.tag].join(' ').toLowerCase().includes(q));
  $('#rCount').textContent=`登録 ${S.riders.length} 名`;
  $('#rTable').innerHTML=`<tr><th>BIB</th><th>氏名</th><th>読み仮名</th><th>クラス</th><th>ICタグ</th><th>特記事項</th><th class="c">記録数</th><th class="noprint"></th></tr>`+
    list.map(r=>`<tr><td><b>${r.bib?esc(r.bib):'<span class="muted">未設定</span>'}</b></td><td>${esc(r.name)}</td><td>${esc(r.kana)}</td>
      <td>${r.cls?esc(r.cls):'<span class="muted">未設定</span>'}</td><td>${esc(r.tag)}</td>
      <td class="note">${esc(r.note)}</td><td class="c">${S.runs.filter(x=>x.rider===r.uid).length}</td>
      <td class="noprint"><button class="b s" onclick="editR('${r.uid}')">編集</button> <button class="b s d" onclick="delR('${r.uid}')">削除</button></td></tr>`).join('')+
    (list.length?'':`<tr><td colspan="8" class="muted">ライダーはまだ登録されていません</td></tr>`);
}
$('#rFilter').oninput=renderRiders;

/* ---------- CSVからライダーを取り込む（氏名・読み仮名。BIB・クラスは未設定のまま追加し、後で編集する） ---------- */
let csvRows=null; // 列の対応付け確定前の、取り込み待ちのCSV（行×列の文字列配列）
$('#btnCsvImport').onclick=()=>$('#csvFileIn').click();
$('#csvFileIn').onchange=e=>{
  const f=e.target.files[0];if(!f)return;
  const rd=new FileReader();
  rd.onload=()=>{
    const buf=rd.result;
    let text=new TextDecoder('utf-8').decode(buf);
    if(text.includes('�')){ // UTF-8として復号できない＝Shift_JIS等のExcel書き出しCSVと推定
      try{text=new TextDecoder('shift_jis').decode(buf);}catch(_){/* 対応していない場合はUTF-8のまま */}
    }
    const rows=Core.parseCsv(text).filter(r=>r.some(c=>String(c).trim()!==''));
    if(!rows.length){alert('CSVに読み込めるデータがありません');return;}
    renderCsvImportPanel(rows);
  };
  rd.onerror=()=>alert('ファイルを読み込めませんでした');
  rd.readAsArrayBuffer(f);
  e.target.value='';
};
function guessCsvCol(rows,i){
  const h=String(rows[0]?.[i]??'');
  if(/氏名|名前|なまえ/.test(h))return 'name';
  if(/フリガナ|ふりがな|カナ|かな|読み/.test(h))return 'kana';
  return 'ignore';
}
function renderCsvImportPanel(rows){
  csvRows=rows;
  const ncols=Math.max(...rows.map(r=>r.length));
  const opt=v=>`<option value="${v}">`;
  const selHtml=i=>`<select data-col="${i}">${opt('ignore')}（使用しない）</option>${opt('name')}氏名</option>${opt('kana')}読み仮名</option>${opt('note')}特記事項</option></select>`;
  const head=`<tr>${Array.from({length:ncols},(_,i)=>`<th>${selHtml(i)}</th>`).join('')}</tr>`;
  const body=rows.slice(0,6).map(r=>`<tr>${Array.from({length:ncols},(_,i)=>`<td>${esc(r[i]??'')}</td>`).join('')}</tr>`).join('')+
    (rows.length>6?`<tr><td colspan="${ncols}" class="muted">…他 ${rows.length-6} 行</td></tr>`:'');
  $('#csvMapTable').innerHTML=head+body;
  [...document.querySelectorAll('#csvMapTable select')].forEach((sel,i)=>{sel.value=guessCsvCol(rows,i);});
  $('#csvImportPanel').hidden=false;
  window.scrollTo({top:document.body.scrollHeight,behavior:'smooth'});
}
$('#btnCsvImportCancel').onclick=()=>{$('#csvImportPanel').hidden=true;csvRows=null;};
$('#btnCsvImportConfirm').onclick=()=>{
  const mapping=[...document.querySelectorAll('#csvMapTable select')].map(s=>s.value);
  const nameIdx=mapping.indexOf('name');
  if(nameIdx===-1){alert('「氏名」の列を選んでください');return;}
  const kanaIdx=mapping.indexOf('kana');
  const noteIdxs=mapping.reduce((a,m,i)=>m==='note'?[...a,i]:a,[]);
  const dataRows=$('#csv_header').checked?csvRows.slice(1):csvRows;
  if(!confirm(`${dataRows.length}件を取り込みます。よろしいですか？`))return;
  let added=0,skipped=0;
  dataRows.forEach(r=>{
    const name=(r[nameIdx]??'').trim();
    if(!name){skipped++;return;}
    const kana=kanaIdx>=0?(r[kanaIdx]??'').trim():'';
    const note=noteIdxs.map(i=>(r[i]??'').trim()).filter(Boolean).join(' / ');
    S.riders.push({uid:uid(),bib:'',name,kana,cls:'',tag:'',note});
    added++;
  });
  syncStartClassOrder();syncStartOrder();save();renderAll();
  $('#csvImportPanel').hidden=true;csvRows=null;
  alert(`${added}件を取り込みました。BIBナンバー・参加クラスは未設定です。一覧の「編集」から設定してください。`+
    (skipped?`\n氏名が空の${skipped}行はスキップしました。`:''));
};

/* ---------- ② スタートリスト ---------- */
// 出走順はS.startOrder（riders.uidの配列）で管理。ライダーの登録・削除に合わせて自動で追加／除外する。
// クラスの出走順はS.startClassOrder（クラス名の配列。未設定は Core.NOCLS）で管理し、①の「参加クラス設定」の
// 表示順（結果表用）とは別に、スタートリスト画面で▲▼のみで設定・変更できる。
function defaultStartSort(a,b){return Core.clsComparator(S.startClassOrder)(a.cls||NOCLS,b.cls||NOCLS)||nat(a.bib,b.bib);}
function syncStartClassOrder(){
  const names=new Set(S.classes.map(c=>c.name));
  if(S.riders.some(r=>!r.cls))names.add(NOCLS);
  S.startClassOrder=S.startClassOrder.filter(n=>names.has(n));
  const known=new Set(S.startClassOrder);
  const missing=[...names].filter(n=>!known.has(n)).sort(Core.clsComparator(S.classes));
  S.startClassOrder.push(...missing);
  Object.keys(S.startPlan.classes).forEach(n=>{if(!names.has(n))delete S.startPlan.classes[n];});
}
function syncStartOrder(){
  const ids=new Set(S.riders.map(r=>r.uid));
  S.startOrder=S.startOrder.filter(u=>ids.has(u));
  const known=new Set(S.startOrder);
  const missing=S.riders.filter(r=>!known.has(r.uid)).sort(defaultStartSort).map(r=>r.uid);
  S.startOrder.push(...missing);
}
function moveStart(u,dir){
  const i=S.startOrder.indexOf(u),j=i+dir;
  if(i<0||j<0||j>=S.startOrder.length)return;
  [S.startOrder[i],S.startOrder[j]]=[S.startOrder[j],S.startOrder[i]];
  save();renderStartList();
}
function moveStartClass(i,dir){
  const j=i+dir;if(j<0||j>=S.startClassOrder.length)return;
  [S.startClassOrder[i],S.startClassOrder[j]]=[S.startClassOrder[j],S.startClassOrder[i]];
  S.startOrder=S.riders.slice().sort(defaultStartSort).map(r=>r.uid); // クラスの出走順通りに並び替え直す
  save();renderStartList();
}
$('#btnStartReset').onclick=()=>{
  if(S.startOrder.length&&!confirm('出走順を「クラスの出走順→BIB順」で初期化します。手動で並べ替えた順序は失われます。よろしいですか？'))return;
  S.startOrder=S.riders.slice().sort(defaultStartSort).map(r=>r.uid);
  save();renderStartList();
};
$('#btnStartPrint').onclick=()=>{renderStartList();printTab('start');};
// 並び替え（▲▼・初期化）はsave()済みの前提で呼ぶ。登録・削除側は先にsyncStartOrder()してから保存する。
function renderStartClassOrder(){
  const list=S.startClassOrder;
  $('#startClsTable').innerHTML=`<tr><th class="c">出走順</th><th>クラス</th><th class="c">人数</th><th>1番走者の出走時刻</th><th>スタート間隔</th><th class="noprint"></th></tr>`+
    list.map((name,i)=>{const p=S.startPlan.classes[name]||{};return `<tr><td class="c">${i+1}</td><td>${esc(name)}</td><td class="c">${S.riders.filter(r=>(r.cls||NOCLS)===name).length}</td>
      <td><input class="sp" data-i="${i}" data-k="first" value="${esc(fmtClockFull(p.first))}" placeholder="10:00:00" onchange="setStartPlan(this)"></td>
      <td><input class="sp" data-i="${i}" data-k="interval" value="${esc(Core.fmtInterval(p.interval))}" placeholder="30（秒）" onchange="setStartPlan(this)"></td>
      <td class="noprint"><button class="b s" ${i===0?'disabled':''} onclick="moveStartClass(${i},-1)">▲</button>
      <button class="b s" ${i===list.length-1?'disabled':''} onclick="moveStartClass(${i},1)">▼</button></td></tr>`;}).join('')+
    (list.length?'':`<tr><td colspan="6" class="muted">クラスが登録されていません</td></tr>`);
  $('#sp_sec').value=S.startPlan.sec;
}
// スタート時刻の自動入力：クラスごとの「1番走者の出走時刻」「スタート間隔」を S.startPlan に保存し、
// ボタンを押したときに、指定セクションの runs のスタート時刻へ反映する（計算は core.js）。
function setStartPlan(el){
  const name=S.startClassOrder[+el.dataset.i],k=el.dataset.k;
  const v=k==='first'?parseClock(el.value):Core.parseInterval(el.value);
  el.classList.toggle('bad',Number.isNaN(v));
  if(Number.isNaN(v))return; // 不正な入力は保存しない（赤枠で知らせる）
  const p=S.startPlan.classes[name]||(S.startPlan.classes[name]={first:null,interval:null});
  p[k]=v;
  if(p.first==null&&p.interval==null)delete S.startPlan.classes[name];
  el.value=k==='first'?fmtClockFull(v):Core.fmtInterval(v);
  save();
}
$('#sp_sec').onchange=()=>{const v=z2h($('#sp_sec').value);if(!v){$('#sp_sec').value=S.startPlan.sec;return;}S.startPlan.sec=v;save();renderStartList();};
$('#btnStartPlan').onclick=()=>{
  if(olWaiting())return;
  if(document.querySelector('#startClsTable input.bad')){alert('出走時刻またはスタート間隔の形式が正しくありません（赤枠の欄）。修正してからもう一度押してください。');return;}
  const sec=S.startPlan.sec;
  const half=S.startClassOrder.filter(n=>{const p=S.startPlan.classes[n];return p&&(p.first==null)!==(p.interval==null);});
  if(half.length){alert(`クラス「${half.join('」「')}」は、出走時刻とスタート間隔の片方しか入力されていません。両方入力するか、両方空欄にしてください。`);return;}
  const list=Core.planStartTimes(S);
  if(!list.length){alert('スタート時刻を入れる対象がありません。クラスごとに「1番走者の出走時刻」と「スタート間隔」を入力してください。');return;}
  const res=Core.applyStartTimes(S.runs,list,sec,uid);
  if(res.overwritten&&!confirm(`セクション${sec}には、既に別のスタート時刻が入っている記録が${res.overwritten}件あります。\n今回の設定で上書きしますか？（ゴール時刻・状態は変わりません）`))return;
  if(olOn())olApplyStartTimes(list,sec);
  else{S.runs=res.runs;save();renderStartList();renderRuns();}
  alert(`セクション${sec}のスタート時刻を${list.length}名分入力しました。`+
    (res.overwritten?`\n（うち${res.overwritten}件は既存のスタート時刻を上書き）`:'')+
    `\n「③ タイム入力」の一覧で確認・修正できます。`);
};
function renderStartList(){renderStartClassOrder();renderStartTable();}
// 出走リストの表だけを描き直す（オンライン時、記録が届くたびに呼ぶ。クラスの表の入力欄は入力中かもしれないので触らない）
function renderStartTable(){
  const list=S.startOrder.map(riderOf).filter(Boolean);
  const sec=S.startPlan.sec;
  const stOf=new Map(S.runs.filter(x=>x.sec===sec).map(x=>[x.rider,x.start]));
  $('#sCount').textContent=`出走予定 ${list.length} 名`;
  $('#sTitle').textContent=(S.event.name||'レース')+' スタートリスト';
  $('#sSub').textContent=[S.event.date,'出力 '+new Date().toLocaleString('ja-JP')].filter(Boolean).join('　');
  $('#sTable').innerHTML=`<tr><th class="c">出走順</th><th class="c">スタート時刻（S${esc(sec)}）</th><th>BIB</th><th>氏名</th><th>読み仮名</th><th>クラス</th><th>ICタグ</th><th>特記事項</th><th class="noprint"></th></tr>`+
    list.map((r,i)=>`<tr><td class="c"><b>${i+1}</b></td><td class="c">${fmtClock(stOf.get(r.uid))}</td><td><b>${esc(r.bib)}</b></td><td>${esc(r.name)}</td><td>${esc(r.kana)}</td><td>${esc(r.cls)}</td><td>${esc(r.tag)}</td>
      <td class="note">${esc(r.note)}</td><td class="noprint">
      <button class="b s" ${i===0?'disabled':''} onclick="moveStart('${r.uid}',-1)">▲</button>
      <button class="b s" ${i===list.length-1?'disabled':''} onclick="moveStart('${r.uid}',1)">▼</button></td></tr>`).join('')+
    (list.length?'':`<tr><td colspan="9" class="muted">ライダーが登録されていません</td></tr>`);
}

/* ---------- ③ タイム ---------- */
let editRun=null;
enterNav($('#tForm'));
function tPreview(){
  const r=riderByBib($('#t_bib').value);
  const st=parseClock($('#t_start').value),gl=parseClock($('#t_goal').value);
  $('#t_start').classList.toggle('bad',Number.isNaN(st));$('#t_goal').classList.toggle('bad',Number.isNaN(gl));
  let h='';
  if($('#t_bib').value.trim())h+=r?`<span class="ok">BIB ${esc(r.bib)}：${esc(r.name)}（${esc(r.cls||NOCLS)}）</span>`:`<span class="ng">BIB ${esc(z2h($('#t_bib').value))} は登録されていません</span>`;
  if(Number.isNaN(st)||Number.isNaN(gl))h+=` <span class="ng">時刻の形式が正しくありません</span>`;
  else if(st!=null&&gl!=null){let d=gl-st;const wrap=d<0;if(wrap)d+=86400000;h+=`　タイム <b>${fmtDur(d)}</b>${wrap?' <span class="ng">（日付をまたいだものとして計算）</span>':''}`;}
  if(r&&!editRun){const ex=S.runs.find(x=>x.rider===r.uid&&x.sec===z2h($('#t_sec').value));if(ex)h+=` <span class="muted">※ セクション${esc(ex.sec)}の記録が既にあります（空欄の項目は既存の値を残します）</span>`;}
  $('#tInfo').innerHTML=h;
}
['#t_bib','#t_sec','#t_start','#t_goal'].forEach(s=>$(s).addEventListener('input',tPreview));
$('#tForm').onsubmit=e=>{
  e.preventDefault();
  if(olWaiting())return;
  const r=riderByBib($('#t_bib').value);
  if(!r){alert('このBIBのライダーは登録されていません。先に「① ライダー登録」で登録してください。');$('#t_bib').focus();return;}
  const sec=z2h($('#t_sec').value);if(!sec){alert('セクション#を入力してください');return;}
  const st=parseClock($('#t_start').value),gl=parseClock($('#t_goal').value);
  if(Number.isNaN(st)){alert('スタート時刻の形式が正しくありません');$('#t_start').focus();return;}
  if(Number.isNaN(gl)){alert('ゴール時刻の形式が正しくありません');$('#t_goal').focus();return;}
  const v={rider:r.uid,sec,start:st,goal:gl,status:$('#t_status').value,note:$('#t_note').value.trim()};
  const dup=S.runs.find(x=>x.rider===r.uid&&x.sec===sec&&x.uid!==editRun);
  if(olOn()){olSubmitRun(r,v,dup);return;}
  if(editRun){
    if(dup){alert(`BIB ${r.bib} のセクション${sec}の記録が既にあります`);return;}
    Object.assign(S.runs.find(x=>x.uid===editRun),v);
  }else if(dup){
    const conflict=(v.start!=null&&dup.start!=null&&v.start!==dup.start)||(v.goal!=null&&dup.goal!=null&&v.goal!==dup.goal);
    if(conflict&&!confirm(`BIB ${r.bib} のセクション${sec}には、既に別の時刻が入っています。\n既存：${fmtClock(dup.start)||'—'} → ${fmtClock(dup.goal)||'—'}\n上書きしますか？`))return;
    if(v.start!=null)dup.start=v.start;
    if(v.goal!=null)dup.goal=v.goal;
    dup.status=v.status;
    if(v.note)dup.note=v.note;
  }else S.runs.push({uid:uid(),...v});
  resetRunForm(sec);save();renderRuns();$('#t_bib').focus();
};
function resetRunForm(keepSec){
  editRun=null;const sec=keepSec??$('#t_sec').value;$('#tForm').reset();$('#t_sec').value=sec||'1';
  $('#tFormTitle').textContent='タイム入力';$('#tSubmit').textContent='登録';$('#tCancel').hidden=true;tPreview();
}
$('#tCancel').onclick=()=>resetRunForm();
function editT(u){
  const x=S.runs.find(r=>r.uid===u);const r=riderOf(x.rider);editRun=u;
  $('#t_bib').value=r.bib;$('#t_sec').value=x.sec;$('#t_start').value=fmtClockFull(x.start);$('#t_goal').value=fmtClockFull(x.goal);
  $('#t_status').value=x.status;$('#t_note').value=x.note||'';
  $('#tFormTitle').textContent=`タイム編集（BIB ${r.bib}・セクション${x.sec}）`;$('#tSubmit').textContent='更新';$('#tCancel').hidden=false;
  tPreview();$('#t_start').focus();window.scrollTo({top:0,behavior:'smooth'});
}
function delT(u){
  if(olWaiting())return;
  const x=S.runs.find(r=>r.uid===u);const r=riderOf(x.rider);
  if(!confirm(`BIB ${r.bib} ${r.name} のセクション${x.sec}の記録を削除しますか？`))return;
  if(olOn()){olAdd({rider:x.rider,bib:String(r.bib),sec:x.sec,del:true});if(editRun===u)resetRunForm();return;}
  S.runs=S.runs.filter(r=>r.uid!==u);if(editRun===u)resetRunForm();save();renderRuns();
}
function renderRuns(){
  const q=$('#tFilter').value.trim().toLowerCase();
  const rows=S.runs.map(x=>({x,r:riderOf(x.rider)})).filter(o=>o.r)
    .sort((a,b)=>nat(a.r.bib,b.r.bib)||nat(a.x.sec,b.x.sec))
    .filter(o=>!q||[o.r.bib,o.r.name,o.r.kana,'s'+o.x.sec,o.x.sec].join(' ').toLowerCase().includes(q));
  $('#tCount').textContent=`記録 ${S.runs.length} 件`;
  $('#tTable').innerHTML=`<tr><th>BIB</th><th>氏名</th><th>クラス</th><th class="c">セクション</th><th class="n">スタート</th><th class="n">ゴール</th><th class="n">タイム</th><th class="c">状態</th><th>特記事項</th><th></th></tr>`+
    rows.map(({x,r})=>{const e=elapsed(x);
      const stTag=(x.status!=='OK'?`<span class="tag t-${x.status}">${x.status}</span>`:(e==null?`<span class="tag t-run">計測中</span>`:'完走'))+olConflictTag(x);
      return `<tr><td><b>${esc(r.bib)}</b></td><td>${esc(r.name)}</td><td>${esc(r.cls)}</td><td class="c">${esc(x.sec)}</td>
      <td class="n">${fmtClock(x.start)}</td><td class="n">${fmtClock(x.goal)}</td><td class="n"><b>${fmtDur(e)}</b></td>
      <td class="c">${stTag}</td><td class="note">${esc(x.note)}</td>
      <td><button class="b s" onclick="editT('${x.uid}')">編集</button> <button class="b s d" onclick="delT('${x.uid}')">削除</button></td></tr>`;}).join('')+
    (rows.length?'':`<tr><td colspan="10" class="muted">記録はまだありません</td></tr>`);
}
$('#tFilter').oninput=renderRuns;

/* ---------- ④ 集計 ---------- */
function renderResults(){
  const R=compute();const sel=$('#resView');const cur=sel.value||'__all';
  sel.innerHTML=`<option value="__ovr">総合順位</option><option value="__all">クラス別（全クラス）</option>`+
    R.classes.map(c=>`<option value="${esc(c)}">クラス：${esc(c)}</option>`).join('');
  sel.value=[...sel.options].some(o=>o.value===cur)?cur:'__all';
  const v=sel.value;
  $('#pTitle').textContent=(S.event.name||'レース')+' 成績表';
  $('#pSub').textContent=[S.event.date,v==='__ovr'?'総合順位':v==='__all'?'クラス別順位':'クラス：'+v,'出力 '+new Date().toLocaleString('ja-JP')].filter(Boolean).join('　');
  if(!S.riders.length){$('#resArea').innerHTML='<div class="card muted">ライダーが登録されていません</div>';return;}
  let h='';
  if(v==='__ovr')h=tableHtml(R.overall,R.secs,'ovr');
  else{
    const list=v==='__all'?R.classes:[v];
    h=list.map(c=>`<div class="cls-block"><h3 class="cls-h">${esc(c)}　<span class="muted" style="font-size:12px;font-weight:normal">${R.byClass[c].length}名</span></h3>${tableHtml(R.byClass[c],R.secs,'cls')}</div>`).join('');
  }
  $('#resArea').innerHTML=`<div class="card">${h}</div>`;
}
function cellSec(o){
  if(!o)return '<span class="muted">—</span>';
  if(o.r.status!=='OK')return `<span class="tag t-${o.r.status}">${o.r.status}</span>`;
  return o.e==null?'<span class="tag t-run">計測中</span>':fmtDur(o.e);
}
function tableHtml(list,secs,mode){
  const main=mode==='ovr'?'ovr':'clsR',sub=mode==='ovr'?'clsR':'ovr';
  const head=`<thead><tr><th class="c">${mode==='ovr'?'総合':'順位'}</th><th class="c">${mode==='ovr'?'クラス順位':'総合'}</th><th>BIB</th><th>氏名</th>${mode==='ovr'?'<th>クラス</th>':''}
    ${secs.map(s=>`<th class="n">S${esc(s)}</th>`).join('')}<th class="c">区間数</th><th class="n">合計タイム</th><th class="n">トップ差</th><th>特記事項</th></tr></thead>`;
  const body=`<tbody>${list.map(x=>{
    const rk=x[main];
    return `<tr class="${x.ranked&&rk<=3?'r'+rk:''}"><td class="c"><b>${x.ranked?rk:`<span class="tag t-${x.label in STATUS?x.label:'DNS'}">${esc(x.label)}</span>`}</b></td>
      <td class="c">${x.ranked?(x[sub]??''):''}</td><td><b>${esc(x.rd.bib)}</b></td>
      <td>${esc(x.rd.name)}${x.rd.kana?`<div class="kana">${esc(x.rd.kana)}</div>`:''}</td>${mode==='ovr'?`<td>${esc(x.cls)}</td>`:''}
      ${secs.map(s=>`<td class="n">${cellSec(x.bySec[s])}</td>`).join('')}
      <td class="c">${x.n}</td><td class="n"><b>${x.ranked?fmtDur(x.total):''}</b></td><td class="n">${x.ranked?x[main+'Gap']:''}</td>
      <td class="note">${esc(x.notes)}</td></tr>`;}).join('')}</tbody>`;
  return `<div class="tw"><table>${head}${body}</table></div>`;
}
$('#resView').onchange=renderResults;
$('#btnPrint').onclick=()=>{renderResults();printTab('res');};

/* ---------- 印刷（結果／スタートリストなど、印刷対象のタブだけ表示して印刷） ---------- */
function printTab(name){document.body.dataset.print=name;window.print();}
window.addEventListener('afterprint',()=>{delete document.body.dataset.print;});

/* ---------- CSV / JSON ---------- */
function stamp(){const d=new Date(),p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;}
function fname(base,ext){return `${(S.event.name||'race').replace(/[\\/:*?"<>|\s]+/g,'_')}_${base}_${stamp()}.${ext}`;}
function download(name,text,type){
  const b=new Blob([text],{type});const a=document.createElement('a');
  a.href=URL.createObjectURL(b);a.download=name;document.body.appendChild(a);a.click();
  setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},1000);
}
$('#btnResCsv').onclick=()=>{
  const R=compute();const v=$('#resView').value;
  const list=v==='__ovr'?R.overall:(v==='__all'?R.classes:[v]).flatMap(c=>R.byClass[c]);
  const rows=[['総合順位','クラス順位','BIB','氏名','読み仮名','クラス',...R.secs.map(s=>'S'+s),'区間数','合計タイム','総合トップ差','クラストップ差','状態','特記事項']];
  list.forEach(x=>rows.push([x.ranked?x.ovr:'',x.ranked?x.clsR:'',x.rd.bib,x.rd.name,x.rd.kana,x.cls,
    ...R.secs.map(s=>{const o=x.bySec[s];return !o?'':o.r.status!=='OK'?o.r.status:o.e==null?'計測中':fmtDur(o.e);}),
    x.n,x.ranked?fmtDur(x.total):'',x.ranked?x.ovrGap:'',x.ranked?x.clsRGap:'',x.ranked?'':x.label,x.notes]));
  download(fname('結果','csv'),toCsv(rows),'text/csv');
};
$('#btnAllCsv').onclick=()=>{
  const rows=[['BIBナンバー','氏名','読み仮名','参加クラス','ICタグ','セクション#','スタート時刻','ゴール時刻','タイム','状態','特記事項（ライダー）','特記事項（記録）']];
  S.riders.slice().sort((a,b)=>nat(a.bib,b.bib)).forEach(r=>{
    const runs=S.runs.filter(x=>x.rider===r.uid).sort((a,b)=>nat(a.sec,b.sec));
    if(!runs.length)rows.push([r.bib,r.name,r.kana,r.cls,r.tag,'','','','','',r.note,'']);
    runs.forEach(x=>rows.push([r.bib,r.name,r.kana,r.cls,r.tag,x.sec,Core.fmtClock(x.start,3),Core.fmtClock(x.goal,3),Core.fmtDur(elapsed(x),3),STATUS[x.status],r.note,x.note]));
  });
  download(fname('全データ','csv'),toCsv(rows),'text/csv');
};
$('#btnJsonOut').onclick=()=>download(fname('backup','json'),JSON.stringify(S,null,1),'application/json');
$('#btnJsonIn').onclick=()=>$('#fileIn').click();
$('#fileIn').onchange=e=>{
  const f=e.target.files[0];if(!f)return;const rd=new FileReader();
  if(olOn()){alert(OL_BUSY);e.target.value='';return;}
  rd.onload=()=>{try{
    const d=JSON.parse(rd.result);if(!Array.isArray(d.riders)||!Array.isArray(d.runs))throw 0;
    if(!confirm(`バックアップを読み込みます（ライダー${d.riders.length}名・記録${d.runs.length}件）。\n今のデータは置き換えられます。よろしいですか？`))return;
    S=Object.assign(blank(),d);migrate();save();renderAll();alert('読み込みました');
  }catch(_){alert('このファイルは読み込めません（形式が違います）');}};
  rd.readAsText(f);e.target.value='';
};

/* ---------- セクション記録の取り込み（マージ） ---------- */
// 各セクション端末（本部で配った名簿を読み込んだ同じツール）のバックアップを、
// runs（タイム記録）だけ現在のデータに追加・統合する。ライダー・クラス設定などは変更しない。
$('#btnSectionImport').onclick=()=>$('#sectionFileIn').click();
$('#sectionFileIn').onchange=e=>{
  const f=e.target.files[0];if(!f)return;const rd=new FileReader();
  rd.onload=()=>{try{
    const d=JSON.parse(rd.result);if(!Array.isArray(d.runs))throw 0;
    if(!confirm(`セクション記録を取り込みます（記録 ${d.runs.length} 件）。よろしいですか？`))return;
    if(olOn()){olImportSection(d,f.name);return;}
    const r=Core.mergeSectionData(S,d,uid);
    S.runs=r.runs;
    syncStartClassOrder();syncStartOrder();save();renderAll();
    let msg=`取り込みました。\n追加：${r.added}件　更新：${r.merged}件　変更なし：${r.unchanged}件`;
    if(r.conflicts.length)msg+=`\n⚠ 競合のため反映しなかった記録：${r.conflicts.length}件（本部に既にある記録と時刻が異なります。「③タイム入力」で該当のBIB・セクションをご確認ください）`;
    if(r.unmatched.length)msg+=`\n⚠ 対応するライダーが見つからなかった記録：${r.unmatched.length}件（先に「①ライダー登録」でそのBIBを登録してから、もう一度取り込んでください）`;
    alert(msg);
  }catch(_){alert('このファイルは読み込めません（形式が違います）');}};
  rd.readAsText(f);e.target.value='';
};

/* ---------- その他 ---------- */
$('#btnClear').onclick=()=>{
  if(olOn()){alert(OL_BUSY);return;}
  if(!confirm('全データ（ライダー・記録）を消去します。元に戻せません。\n先にバックアップを書き出しましたか？'))return;
  if(!confirm('本当に消去しますか？'))return;
  S=blank();save();renderAll();
};
$('#btnSample').onclick=()=>{
  if(olOn()){alert(OL_BUSY);return;}
  if((S.riders.length||S.runs.length)&&!confirm('今のデータにサンプルを追加します。よろしいですか？'))return;
  const cls=['IA','IB','NA'];const fam=['佐藤','鈴木','高橋','田中','伊藤','渡辺','山本','中村','小林','加藤','吉田','山田'];
  const kn=['サトウ','スズキ','タカハシ','タナカ','イトウ','ワタナベ','ヤマモト','ナカムラ','コバヤシ','カトウ','ヨシダ','ヤマダ'];
  const gn=['翔太','大輔','健','涼','拓海','誠'],gk=['ショウタ','ダイスケ','ケン','リョウ','タクミ','マコト'];
  cls.forEach((c,i)=>{if(!S.classes.some(x=>x.name===c))S.classes.push({name:c,digit:i+1});});
  for(let i=0;i<12;i++){
    const u=uid(),c=cls[i%3],g=i%6;
    const bib=Core.nextBibInClass(c,S.classes,S.riders.map(r=>r.bib))||String(101+S.riders.length);
    S.riders.push({uid:u,bib,name:`${fam[i]} ${gn[g]}`,kana:`${kn[i]} ${gk[g]}`,cls:c,note:''});
    for(const sec of ['1','2']){
      const st=(10*3600+(sec==='2'?3600:0)+i*60)*1000;
      const run={uid:uid(),rider:u,sec,start:st,goal:st+(300+Math.floor(Math.random()*90))*1000+Math.floor(Math.random()*1000),status:'OK',note:''};
      if(i===4&&sec==='2'){run.goal=null;run.status='DNF';run.note='転倒';}
      if(i===9){run.start=run.goal=null;run.status='DNS';}
      S.runs.push(run);
    }
  }
  syncStartClassOrder();syncStartOrder();save();renderAll();alert('サンプルデータを追加しました（12名・2セクション）');
};
$('#prec').onchange=e=>{S.settings.prec=+e.target.value;save();renderAll();};
$('#evName').oninput=e=>{S.event.name=e.target.value;save();};
$('#evDate').onchange=e=>{S.event.date=e.target.value;save();};
window.addEventListener('storage',e=>{if(e.key===KEY){load();renderAll();}}); // 別タブで更新された場合

/* ---------- オンライン（親システム：Firebase。js/online.js） ---------- */
// 接続中は、タイム記録（S.runs）をサーバーの入力記録（entries。各ゴール端末・本部が追記する）から組み立てる。
// ③の登録・編集・削除も entries への追記になる（Core.runsFromEntries）。
// 名簿（ライダー・クラス等）はこの本部端末が正本で、変更するたびにサーバーへ送る（各ゴール端末はそれを参照する）。
const OKEY='raceTimer_online';
const OL_BUSY='オンライン接続中はこの操作はできません。「データ管理 → オンライン」で切断してから行ってください。';
const OL_WAIT='オンラインの大会に接続できていません。「データ管理 → オンライン」でログインしてから入力してください。\n（このまま入力すると、接続したときに記録が失われるため受け付けません）';
const OL={eid:'',ready:false,busy:false,error:'',entries:[],conflicts:[],unmatched:[],pending:0,fromCache:true,devices:[],pins:null,unsub:[],lastRoster:''};
try{OL.eid=JSON.parse(localStorage.getItem(OKEY)||'{}').eid||'';}catch(_){}
const olOn=()=>!!(OL.eid&&OL.ready);
// 大会コードは設定済みなのに接続できていない（ログイン切れ等）。この間のタイム入力は受け付けない
function olWaiting(){if(OL.eid&&!OL.ready&&!Online.unavailableReason()){alert(OL_WAIT);return true;}return false;}
function olSaveKey(){try{localStorage.setItem(OKEY,JSON.stringify({eid:OL.eid}));}catch(_){}}
// JSONを経由して undefined を取り除く（Firestoreは undefined を保存できない）
function olRoster(){const {event,settings,classes,riders,startOrder,startClassOrder,startPlan}=S;return JSON.parse(JSON.stringify({event,settings,classes,riders,startOrder,startClassOrder,startPlan}));}
function olDerive(){
  const r=Core.runsFromEntries(OL.entries,S.riders);
  S.runs=r.runs;OL.conflicts=r.conflicts;OL.unmatched=r.unmatched;
}
let olTimer=null;
function olPushRoster(){
  clearTimeout(olTimer);
  olTimer=setTimeout(()=>{
    const ro=olRoster(),j=JSON.stringify(ro);if(j===OL.lastRoster)return;
    OL.lastRoster=j;Online.pushRoster(OL.eid,ro).catch(olErr);
  },800);
}
function olErr(e){
  console.error(e);
  OL.error=e&&e.code==='permission-denied'?'権限がありません。大会コードが正しいか、この大会の本部として登録したGoogleアカウントでログインしているか確認してください。'
    :String(e&&e.message||e);
  renderOnline();
}
const olAdd=entry=>Online.addEntry(OL.eid,{dev:'本部',...entry}).catch(olErr);
function olUnsub(){OL.unsub.forEach(f=>{try{f();}catch(_){}});OL.unsub=[];}

// ③の登録（オンライン時）：オフライン版と同じ判断（空欄は既存を残す・違う時刻は確認してから上書き）を entries で表す
function olSubmitRun(r,v,dup){
  const base={rider:r.uid,bib:String(r.bib),sec:v.sec};
  if(editRun){
    if(dup){alert(`BIB ${r.bib} のセクション${v.sec}の記録が既にあります`);return;}
    const old=S.runs.find(x=>x.uid===editRun);
    if(old&&(old.rider!==r.uid||old.sec!==v.sec))olAdd({rider:old.rider,bib:String(riderOf(old.rider)?.bib??''),sec:old.sec,del:true});
    olAdd({...base,start:v.start,goal:v.goal,status:v.status,note:v.note,fix:true});
  }else if(dup){
    const conflict=(v.start!=null&&dup.start!=null&&v.start!==dup.start)||(v.goal!=null&&dup.goal!=null&&v.goal!==dup.goal);
    if(conflict&&!confirm(`BIB ${r.bib} のセクション${v.sec}には、既に別の時刻が入っています。\n既存：${fmtClock(dup.start)||'—'} → ${fmtClock(dup.goal)||'—'}\n上書きしますか？`))return;
    const e={...base,status:v.status};
    if(v.start!=null)e.start=v.start;
    if(v.goal!=null)e.goal=v.goal;
    if(v.note)e.note=v.note;
    if(conflict)e.fix=true;
    olAdd(e);
  }else olAdd({...base,start:v.start,goal:v.goal,status:v.status,note:v.note});
  resetRunForm(v.sec);$('#t_bib').focus();
}
// ②のスタート時刻の自動入力（オンライン時）：スタート時刻だけの entries を追記する（ゴール・状態は触らない）。
// 記録が無い／スタート未入力なら通常の entry、別の時刻が入っていれば fix（上書き。確認は呼び出し側で済み）、同じ時刻なら何も送らない
function olApplyStartTimes(list,sec){
  const cur=new Map(S.runs.filter(x=>x.sec===sec).map(x=>[x.rider,x]));const t=Date.now();
  list.forEach(({rider,start},i)=>{
    const ex=cur.get(rider);
    if(ex&&ex.start===start)return;
    const e={rider,bib:String(riderOf(rider)?.bib??''),sec,start,clientAt:t+i};
    if(ex&&ex.start!=null)e.fix=true;
    olAdd(e);
  });
}
// セクション記録（.json）の取り込み（オンライン時）：記録をそのまま entries に追加する。食い違いは「競合」として表示される
function olImportSection(d,name){
  const inR=new Map((d.riders||[]).map(r=>[r.uid,r]));const t=Date.now();
  (d.runs||[]).forEach((x,i)=>olAdd({rider:x.rider,bib:String(inR.get(x.rider)?.bib??''),sec:String(x.sec),start:x.start??null,goal:x.goal??null,
    status:x.status||'OK',note:x.note||'',dev:('取込 '+name).slice(0,40),clientAt:t+i}));
  alert(`${(d.runs||[]).length}件の記録をオンラインの大会に追加しました。\n既にある記録と時刻が食い違うものは「競合」として③タイム入力に表示されます。`);
}
function olConflictTag(x){
  if(!olOn())return '';
  const cs=OL.conflicts.filter(c=>c.rider===x.rider&&c.sec===x.sec);if(!cs.length)return '';
  const t=cs.map(c=>`${c.field==='start'?'スタート':'ゴール'}：採用 ${fmtClock(c.kept)} ／ 別の入力 ${fmtClock(c.value)}（${c.dev||'不明'}）`).join('\n');
  return ` <span class="tag t-cf" title="${esc(t)}">⚠ 競合</span>`;
}

async function olBoot(){
  renderOnline();
  Online.registerOffline();
  if(OL.eid&&!Online.unavailableReason())await olConnect();
}
async function olRun(f){
  OL.busy=true;OL.error='';renderOnline();
  try{await f();}catch(e){olErr(e);}finally{OL.busy=false;renderOnline();}
}
function olLogin(){return olRun(async()=>{await Online.init();if(!Online.isAdminUser())await Online.signInGoogle();if(OL.eid)await olConnect();});}
function olLogout(){if(!confirm('ログアウトしますか？'))return;olUnsub();OL.ready=false;olRun(()=>Online.signOut());renderRuns();}
async function olConnect(){
  await Online.init();
  if(!Online.isAdminUser()){OL.ready=false;renderOnline();renderRuns();return;}
  olUnsub();OL.ready=true;OL.lastRoster='';
  OL.unsub.push(Online.watchEntries(OL.eid,null,(list,meta)=>{
    OL.entries=list;OL.pending=meta.pending;OL.fromCache=meta.fromCache;
    save();renderRiders();renderStartTable();renderRuns();renderResults();renderOnline();tPreview();
  },olErr));
  OL.unsub.push(Online.watchDevices(OL.eid,d=>{OL.devices=d;renderOnline();},olErr));
  try{OL.pins=await Online.getPins(OL.eid);}catch(_){OL.pins=null;} // 通信できないときは表示しない
  olPushRoster();renderOnline();renderRuns();
}
function olCreate(){
  if(!confirm(`この端末の大会データ（ライダー${S.riders.length}名・記録${S.runs.length}件）をオンラインに公開します。よろしいですか？`))return;
  olRun(async()=>{
    const eid=await Online.createEvent(olRoster());
    const t=Date.now(); // 既存の記録を引き継ぐ
    Core.entriesFromRuns(S.runs,S.riders).forEach((e,i)=>Online.addEntry(eid,{dev:'本部（公開前の記録）',...e,clientAt:t+i}).catch(olErr));
    OL.eid=eid;olSaveKey();await olConnect();
  });
}
function olJoin(){
  const code=z2h(prompt('大会コード（6文字）を入力してください')||'').trim().toUpperCase();
  if(!code)return;
  olRun(async()=>{
    const ev=await new Promise((ok,ng)=>{const un=Online.watchEvent(code,d=>{un();ok(d);},ng);});
    if(!ev){alert('その大会コードは見つかりません');return;}
    if(!confirm(`大会「${ev.roster?.event?.name||code}」に接続します。\nこの端末の今のデータは、サーバーの名簿と記録に置き換わります（必要なら先にバックアップを書き出してください）。よろしいですか？`))return;
    S=Object.assign(blank(),ev.roster||{},{runs:[]});migrate();
    OL.eid=code;olSaveKey();await olConnect();renderAll();
  });
}
function olDisconnect(){
  if(!confirm('オンラインの大会から切断します。\nこの端末には今の名簿と記録が残り、ローカル版として使えます（サーバー上のデータは消えません。大会コードで再接続できます）。よろしいですか？'))return;
  olUnsub();Object.assign(OL,{eid:'',ready:false,entries:[],conflicts:[],unmatched:[],pins:null,devices:[],error:''});
  olSaveKey();save();renderAll();renderOnline();
}
function olSetPin(sec){
  olRun(async()=>{const pins={...OL.pins,[sec]:Online.newPin()};await Online.setPins(OL.eid,pins);OL.pins=pins;});
}
function olAddSection(){
  const sec=z2h(prompt('PINを発行するセクション#を入力してください（例：1）')||'').trim();if(!sec)return;
  if(OL.pins&&OL.pins[sec]){alert(`セクション${sec}のPINは発行済みです`);return;}
  olSetPin(sec);
}
function olReissue(sec){
  if(!confirm(`セクション${sec}のPINを再発行しますか？\n（登録済みの端末はそのまま使えます。使えなくするには端末一覧の「無効化」を押してください）`))return;
  olSetPin(sec);
}
function olDelSection(sec){
  if(!confirm(`セクション${sec}のPINを削除しますか？（新しい端末を登録できなくなります）`))return;
  olRun(async()=>{const pins={...OL.pins};delete pins[sec];await Online.setPins(OL.eid,pins);OL.pins=pins;});
}
function olRemoveDevice(id){
  const d=OL.devices.find(x=>x.id===id);
  if(!confirm(`端末「${d?.label||id}」を無効化しますか？（その端末からは記録を送れなくなります。送信済みの記録は残ります）`))return;
  olRun(()=>Online.removeDevice(OL.eid,id));
}
function renderOnline(){
  const el=$('#olArea');if(!el)return;
  const why=Online.unavailableReason();let h='';
  if(why==='file')h='<p class="hint">オンライン機能は、Webで公開している版（https://〜）を開いたときだけ使えます。ファイルを直接開いたこの画面では、従来どおりこのPCの中だけで動きます。</p>';
  else if(why==='config')h='<p class="hint">オンライン機能は未設定です（<code>js/firebase-config.js</code> に接続先を設定すると使えるようになります）。</p>';
  else if(OL.busy)h='<p class="hint">通信中…</p>';
  else if(!Online.isAdminUser())h=`<p class="hint">各ゴールの端末（スマホ等）から送られた記録を、この本部に自動で集めて結果を更新します。本部として、Googleアカウントでログインしてください。</p>
    ${OL.eid?`<p>接続先の大会コード：<span class="ol-code">${esc(OL.eid)}</span>（ログインすると接続します）</p>`:''}
    <div class="btns"><button class="b p" onclick="olLogin()">Googleでログイン</button></div>`;
  else if(!OL.eid)h=`<p class="hint">ログイン中：${esc(Online.user().email||'')}</p>
    <p class="hint">「公開する」と、今のライダー登録・クラス設定・記録をサーバーに送り、大会コードを発行します。別のPCで公開済みの大会を本部として使うときは「大会コードで接続」を選びます。</p>
    <div class="btns"><button class="b p" onclick="olCreate()">この大会をオンラインに公開する</button>
    <button class="b" onclick="olJoin()">大会コードで接続する</button><button class="b" onclick="olLogout()">ログアウト</button></div>`;
  else{
    const goalUrl=new URL('goal.html?e='+encodeURIComponent(OL.eid),location.href).href;
    const secs=Object.keys(OL.pins||{}).sort(nat);
    h=`<p>大会コード：<span class="ol-code">${esc(OL.eid)}</span>　<span class="${OL.fromCache?'ng':'ok'}">${OL.fromCache?'⚠ サーバーに接続できていません（通信が戻ると自動で同期します）':'✓ サーバーと同期中'}</span>
      ${OL.pending?`　<span class="ng">未送信 ${OL.pending} 件</span>`:''}</p>
      <p class="hint">ゴール端末用のページ：<a href="${esc(goalUrl)}" target="_blank">${esc(goalUrl)}</a><br>
      各ゴール端末でこのページを開き、大会コード・セクション#・PINを入力して登録します（登録は通信できる場所で、大会前に済ませてください）。</p>
      <h3 class="cls-h">セクションとPIN</h3>
      ${OL.pins==null?'<p class="hint">PINは通信できるときに表示されます。</p>':`<div class="tw"><table><tr><th class="c">セクション</th><th>PIN</th><th class="c">登録端末</th><th></th></tr>
      ${secs.map(s=>`<tr><td class="c">${esc(s)}</td><td class="ol-code" style="font-size:16px">${esc(OL.pins[s])}</td><td class="c">${OL.devices.filter(d=>d.sec===s).length}</td>
        <td><button class="b s" onclick="olReissue('${esc(s)}')">再発行</button> <button class="b s d" onclick="olDelSection('${esc(s)}')">削除</button></td></tr>`).join('')}
      ${secs.length?'':'<tr><td colspan="4" class="muted">PINはまだ発行していません</td></tr>'}</table></div>
      <div class="btns" style="margin-top:8px"><button class="b" onclick="olAddSection()">セクションのPINを発行</button></div>`}
      <h3 class="cls-h">登録済みの端末</h3>
      <div class="tw"><table><tr><th>端末名</th><th class="c">セクション</th><th class="c">記録数</th><th></th></tr>
      ${OL.devices.slice().sort((a,b)=>nat(a.sec,b.sec)).map(d=>`<tr><td>${esc(d.label||'（名前なし）')}</td><td class="c">${esc(d.sec)}</td>
        <td class="c">${OL.entries.filter(e=>e.by===d.id).length}</td><td><button class="b s d" onclick="olRemoveDevice('${esc(d.id)}')">無効化</button></td></tr>`).join('')}
      ${OL.devices.length?'':'<tr><td colspan="4" class="muted">まだありません</td></tr>'}</table></div>
      <div class="btns" style="margin-top:12px"><button class="b" onclick="olDisconnect()">切断する（ローカル版に戻る）</button><button class="b" onclick="olLogout()">ログアウト</button></div>`;
  }
  if(OL.error)h+=`<p class="info"><span class="ng">⚠ ${esc(OL.error)}</span></p>`;
  el.innerHTML=h;
  renderOlBanner();
}
function renderOlBanner(){
  const b=$('#olTimesBanner');if(!b)return;
  if(!OL.eid||Online.unavailableReason()){b.hidden=true;return;}
  b.hidden=false;
  if(!OL.ready){b.className='ol-banner warn';b.innerHTML=`⚠ オンラインの大会（<b>${esc(OL.eid)}</b>）に接続していません。「データ管理 → オンライン」でログインしてください。接続するまでタイム入力は受け付けません。`;return;}
  const un=[...new Set(OL.unmatched.map(e=>e.bib||'?'))].sort(nat);
  const warn=OL.conflicts.length||un.length||OL.fromCache;
  b.className='ol-banner'+(warn?' warn':'');
  b.innerHTML=`オンライン接続中（大会コード <b>${esc(OL.eid)}</b>）。各ゴールからの記録は自動で反映されます。`+
    (OL.fromCache?'<br>⚠ サーバーに接続できていません。ここでの入力は通信が戻ったときに送信されます。':'')+
    (OL.pending?`<br>未送信 ${OL.pending} 件`:'')+
    (OL.conflicts.length?`<br>⚠ 時刻が食い違う記録（競合）が ${new Set(OL.conflicts.map(c=>c.rider+'_'+c.sec)).size} 件あります。一覧の「⚠ 競合」にマウスを乗せると内容が見られます。「編集」で正しい時刻を登録すると解消します。`:'')+
    (un.length?`<br>⚠ 登録されていないBIBの記録：${un.map(esc).join('、')}（①でそのBIBのライダーを登録すると自動で反映されます）`:'');
}

function renderAll(){
  $('#evName').value=S.event.name||'';$('#evDate').value=S.event.date||'';$('#prec').value=S.settings.prec;
  renderClasses();renderRiders();renderStartList();renderRuns();renderResults();tPreview();
}
load();renderAll();olBoot();
