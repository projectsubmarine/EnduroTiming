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
function blank(){return {version:2,event:{name:'',date:''},settings:{prec:2},classes:[],riders:[],startOrder:[],startClassOrder:[],runs:[]};}

/* ---------- 保存 ---------- */
// 旧バックアップを補う：
// ・v1以前：classes/startOrderが無い → 補完
// ・v1：classesが文字列配列 → {name,digit}形式へ変換（digitは未設定=null）
function migrate(){
  if(!Array.isArray(S.classes))S.classes=[];
  S.classes=S.classes.map(c=>typeof c==='string'?{name:c,digit:null}:{name:c.name,digit:c.digit??null});
  if(!Array.isArray(S.startOrder))S.startOrder=[];
  if(!Array.isArray(S.startClassOrder))S.startClassOrder=[];
  if(!S.classes.length&&S.riders.length)S.classes=[...new Set(S.riders.map(r=>r.cls).filter(Boolean))].sort(nat).map(name=>({name,digit:null}));
  S.version=2;
  syncStartClassOrder();syncStartOrder();
}
function load(){
  try{const t=localStorage.getItem(KEY);if(t){const d=JSON.parse(t);S=Object.assign(blank(),d);migrate();}}
  catch(e){setStatus('⚠ 保存データを読み込めませんでした');}
}
function save(){
  try{localStorage.setItem(KEY,JSON.stringify(S));setStatus('自動保存 '+new Date().toLocaleTimeString('ja-JP'));}
  catch(e){setStatus('⚠ ブラウザに保存できません。バックアップを書き出してください');}
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
  $('#startClsTable').innerHTML=`<tr><th class="c">出走順</th><th>クラス</th><th class="c">人数</th><th class="noprint"></th></tr>`+
    list.map((name,i)=>`<tr><td class="c">${i+1}</td><td>${esc(name)}</td><td class="c">${S.riders.filter(r=>(r.cls||NOCLS)===name).length}</td>
      <td class="noprint"><button class="b s" ${i===0?'disabled':''} onclick="moveStartClass(${i},-1)">▲</button>
      <button class="b s" ${i===list.length-1?'disabled':''} onclick="moveStartClass(${i},1)">▼</button></td></tr>`).join('')+
    (list.length?'':`<tr><td colspan="4" class="muted">クラスが登録されていません</td></tr>`);
}
function renderStartList(){
  renderStartClassOrder();
  const list=S.startOrder.map(riderOf).filter(Boolean);
  $('#sCount').textContent=`出走予定 ${list.length} 名`;
  $('#sTitle').textContent=(S.event.name||'レース')+' スタートリスト';
  $('#sSub').textContent=[S.event.date,'出力 '+new Date().toLocaleString('ja-JP')].filter(Boolean).join('　');
  $('#sTable').innerHTML=`<tr><th class="c">出走順</th><th>BIB</th><th>氏名</th><th>読み仮名</th><th>クラス</th><th>ICタグ</th><th>特記事項</th><th class="noprint"></th></tr>`+
    list.map((r,i)=>`<tr><td class="c"><b>${i+1}</b></td><td><b>${esc(r.bib)}</b></td><td>${esc(r.name)}</td><td>${esc(r.kana)}</td><td>${esc(r.cls)}</td><td>${esc(r.tag)}</td>
      <td class="note">${esc(r.note)}</td><td class="noprint">
      <button class="b s" ${i===0?'disabled':''} onclick="moveStart('${r.uid}',-1)">▲</button>
      <button class="b s" ${i===list.length-1?'disabled':''} onclick="moveStart('${r.uid}',1)">▼</button></td></tr>`).join('')+
    (list.length?'':`<tr><td colspan="8" class="muted">ライダーが登録されていません</td></tr>`);
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
  const r=riderByBib($('#t_bib').value);
  if(!r){alert('このBIBのライダーは登録されていません。先に「① ライダー登録」で登録してください。');$('#t_bib').focus();return;}
  const sec=z2h($('#t_sec').value);if(!sec){alert('セクション#を入力してください');return;}
  const st=parseClock($('#t_start').value),gl=parseClock($('#t_goal').value);
  if(Number.isNaN(st)){alert('スタート時刻の形式が正しくありません');$('#t_start').focus();return;}
  if(Number.isNaN(gl)){alert('ゴール時刻の形式が正しくありません');$('#t_goal').focus();return;}
  const v={rider:r.uid,sec,start:st,goal:gl,status:$('#t_status').value,note:$('#t_note').value.trim()};
  const dup=S.runs.find(x=>x.rider===r.uid&&x.sec===sec&&x.uid!==editRun);
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
  const x=S.runs.find(r=>r.uid===u);const r=riderOf(x.rider);
  if(!confirm(`BIB ${r.bib} ${r.name} のセクション${x.sec}の記録を削除しますか？`))return;
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
      const stTag=x.status!=='OK'?`<span class="tag t-${x.status}">${x.status}</span>`:(e==null?`<span class="tag t-run">計測中</span>`:'完走');
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
  rd.onload=()=>{try{
    const d=JSON.parse(rd.result);if(!Array.isArray(d.riders)||!Array.isArray(d.runs))throw 0;
    if(!confirm(`バックアップを読み込みます（ライダー${d.riders.length}名・記録${d.runs.length}件）。\n今のデータは置き換えられます。よろしいですか？`))return;
    S=Object.assign(blank(),d);migrate();save();renderAll();alert('読み込みました');
  }catch(_){alert('このファイルは読み込めません（形式が違います）');}};
  rd.readAsText(f);e.target.value='';
};

/* ---------- その他 ---------- */
$('#btnClear').onclick=()=>{
  if(!confirm('全データ（ライダー・記録）を消去します。元に戻せません。\n先にバックアップを書き出しましたか？'))return;
  if(!confirm('本当に消去しますか？'))return;
  S=blank();save();renderAll();
};
$('#btnSample').onclick=()=>{
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

function renderAll(){
  $('#evName').value=S.event.name||'';$('#evDate').value=S.event.date||'';$('#prec').value=S.settings.prec;
  renderClasses();renderRiders();renderStartList();renderRuns();renderResults();tPreview();
}
load();renderAll();
