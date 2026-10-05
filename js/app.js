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
function blank(){return {version:1,event:{name:'',date:''},settings:{prec:2},riders:[],runs:[]};}

/* ---------- 保存 ---------- */
function load(){
  try{const t=localStorage.getItem(KEY);if(t){const d=JSON.parse(t);S=Object.assign(blank(),d);}}
  catch(e){setStatus('⚠ 保存データを読み込めませんでした');}
}
function save(){
  try{localStorage.setItem(KEY,JSON.stringify(S));setStatus('自動保存 '+new Date().toLocaleTimeString('ja-JP'));}
  catch(e){setStatus('⚠ ブラウザに保存できません。バックアップを書き出してください');}
}
function setStatus(t){$('#status').textContent=t;}

/* ---------- 時刻 ---------- */
const riderOf=u=>S.riders.find(r=>r.uid===u);
const riderByBib=b=>{b=z2h(b);return S.riders.find(r=>String(r.bib)===b);};

/* ---------- タブ ---------- */
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>{
  document.querySelectorAll('nav button').forEach(x=>x.classList.toggle('on',x===b));
  document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('on',t.id==='tab-'+b.dataset.tab));
  if(b.dataset.tab==='res')renderResults();
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

/* ---------- ① ライダー ---------- */
let editRider=null;
enterNav($('#rForm'));
$('#rForm').onsubmit=e=>{
  e.preventDefault();
  const v={id:z2h($('#r_id').value),bib:z2h($('#r_bib').value),name:$('#r_name').value.trim(),
    kana:$('#r_kana').value.trim(),cls:$('#r_cls').value.trim(),note:$('#r_note').value.trim()};
  if(!v.bib||!v.name){alert('BIBナンバーと氏名は必須です');return;}
  const others=S.riders.filter(r=>r.uid!==editRider);
  if(others.some(r=>String(r.bib)===v.bib)){alert(`BIB ${v.bib} は既に登録されています`);$('#r_bib').focus();return;}
  if(!v.id){const nums=S.riders.map(r=>parseInt(r.id,10)).filter(n=>!isNaN(n));v.id=String((nums.length?Math.max(...nums):0)+1);}
  if(others.some(r=>String(r.id)===v.id)){alert(`ID ${v.id} は既に使われています`);$('#r_id').focus();return;}
  if(editRider){Object.assign(riderOf(editRider),v);}
  else S.riders.push({uid:uid(),...v});
  const keepCls=v.cls;
  resetRiderForm();$('#r_cls').value=keepCls;
  save();renderRiders();$('#r_bib').focus();
};
function resetRiderForm(){
  editRider=null;$('#rForm').reset();
  $('#rFormTitle').textContent='ライダー登録';$('#rSubmit').textContent='登録';$('#rCancel').hidden=true;
}
$('#rCancel').onclick=resetRiderForm;
function editR(u){
  const r=riderOf(u);if(!r)return;editRider=u;
  for(const k of ['id','bib','name','kana','cls','note'])$('#r_'+k).value=r[k]??'';
  $('#rFormTitle').textContent=`ライダー編集（BIB ${r.bib}）`;$('#rSubmit').textContent='更新';$('#rCancel').hidden=false;
  $('#r_bib').focus();window.scrollTo({top:0,behavior:'smooth'});
}
function delR(u){
  const r=riderOf(u);const n=S.runs.filter(x=>x.rider===u).length;
  if(!confirm(`BIB ${r.bib} ${r.name} を削除しますか？${n?`\nタイム記録 ${n} 件も一緒に削除されます。`:''}`))return;
  S.riders=S.riders.filter(x=>x.uid!==u);S.runs=S.runs.filter(x=>x.rider!==u);
  if(editRider===u)resetRiderForm();
  save();renderRiders();
}
function renderRiders(){
  const q=$('#rFilter').value.trim().toLowerCase();
  const list=S.riders.slice().sort((a,b)=>nat(a.bib,b.bib))
    .filter(r=>!q||[r.bib,r.name,r.kana,r.cls,r.id].join(' ').toLowerCase().includes(q));
  $('#rCount').textContent=`登録 ${S.riders.length} 名`;
  $('#rTable').innerHTML=`<tr><th>ID</th><th>BIB</th><th>氏名</th><th>読み仮名</th><th>クラス</th><th>特記事項</th><th class="c">記録数</th><th class="noprint"></th></tr>`+
    list.map(r=>`<tr><td>${esc(r.id)}</td><td><b>${esc(r.bib)}</b></td><td>${esc(r.name)}</td><td>${esc(r.kana)}</td><td>${esc(r.cls)}</td>
      <td class="note">${esc(r.note)}</td><td class="c">${S.runs.filter(x=>x.rider===r.uid).length}</td>
      <td class="noprint"><button class="b s" onclick="editR('${r.uid}')">編集</button> <button class="b s d" onclick="delR('${r.uid}')">削除</button></td></tr>`).join('')+
    (list.length?'':`<tr><td colspan="8" class="muted">ライダーはまだ登録されていません</td></tr>`);
  const cls=[...new Set(S.riders.map(r=>r.cls).filter(Boolean))].sort(nat);
  $('#clsList').innerHTML=cls.map(c=>`<option value="${esc(c)}">`).join('');
}
$('#rFilter').oninput=renderRiders;

/* ---------- ② タイム ---------- */
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

/* ---------- ③ 集計 ---------- */
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
  const head=`<tr><th class="c">${mode==='ovr'?'総合':'順位'}</th><th class="c">${mode==='ovr'?'クラス順位':'総合'}</th><th>BIB</th><th>氏名</th>${mode==='ovr'?'<th>クラス</th>':''}
    ${secs.map(s=>`<th class="n">S${esc(s)}</th>`).join('')}<th class="c">区間数</th><th class="n">合計タイム</th><th class="n">トップ差</th><th>特記事項</th></tr>`;
  const body=list.map(x=>{
    const rk=x[main];
    return `<tr class="${x.ranked&&rk<=3?'r'+rk:''}"><td class="c"><b>${x.ranked?rk:`<span class="tag t-${x.label in STATUS?x.label:'DNS'}">${esc(x.label)}</span>`}</b></td>
      <td class="c">${x.ranked?(x[sub]??''):''}</td><td><b>${esc(x.rd.bib)}</b></td>
      <td>${esc(x.rd.name)}${x.rd.kana?`<div class="kana">${esc(x.rd.kana)}</div>`:''}</td>${mode==='ovr'?`<td>${esc(x.cls)}</td>`:''}
      ${secs.map(s=>`<td class="n">${cellSec(x.bySec[s])}</td>`).join('')}
      <td class="c">${x.n}</td><td class="n"><b>${x.ranked?fmtDur(x.total):''}</b></td><td class="n">${x.ranked?x[main+'Gap']:''}</td>
      <td class="note">${esc(x.notes)}</td></tr>`;}).join('');
  return `<div class="tw"><table>${head}${body}</table></div>`;
}
$('#resView').onchange=renderResults;
$('#btnPrint').onclick=()=>{renderResults();window.print();};

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
  const rows=[['総合順位','クラス順位','BIB','ID','氏名','読み仮名','クラス',...R.secs.map(s=>'S'+s),'区間数','合計タイム','総合トップ差','クラストップ差','状態','特記事項']];
  list.forEach(x=>rows.push([x.ranked?x.ovr:'',x.ranked?x.clsR:'',x.rd.bib,x.rd.id,x.rd.name,x.rd.kana,x.cls,
    ...R.secs.map(s=>{const o=x.bySec[s];return !o?'':o.r.status!=='OK'?o.r.status:o.e==null?'計測中':fmtDur(o.e);}),
    x.n,x.ranked?fmtDur(x.total):'',x.ranked?x.ovrGap:'',x.ranked?x.clsRGap:'',x.ranked?'':x.label,x.notes]));
  download(fname('結果','csv'),toCsv(rows),'text/csv');
};
$('#btnAllCsv').onclick=()=>{
  const rows=[['ID','BIBナンバー','氏名','読み仮名','参加クラス','セクション#','スタート時刻','ゴール時刻','タイム','状態','特記事項（ライダー）','特記事項（記録）']];
  S.riders.slice().sort((a,b)=>nat(a.bib,b.bib)).forEach(r=>{
    const runs=S.runs.filter(x=>x.rider===r.uid).sort((a,b)=>nat(a.sec,b.sec));
    if(!runs.length)rows.push([r.id,r.bib,r.name,r.kana,r.cls,'','','','','',r.note,'']);
    runs.forEach(x=>rows.push([r.id,r.bib,r.name,r.kana,r.cls,x.sec,Core.fmtClock(x.start,3),Core.fmtClock(x.goal,3),Core.fmtDur(elapsed(x),3),STATUS[x.status],r.note,x.note]));
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
    S=Object.assign(blank(),d);save();renderAll();alert('読み込みました');
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
  const base=Math.max(0,...S.riders.map(r=>parseInt(r.bib,10)||0));
  for(let i=0;i<12;i++){
    const u=uid(),bib=String(base+i+1),g=i%6;
    S.riders.push({uid:u,id:String(base+i+1),bib,name:`${fam[i]} ${gn[g]}`,kana:`${kn[i]} ${gk[g]}`,cls:cls[i%3],note:''});
    for(const sec of ['1','2']){
      const st=(10*3600+(sec==='2'?3600:0)+i*60)*1000;
      const run={uid:uid(),rider:u,sec,start:st,goal:st+(300+Math.floor(Math.random()*90))*1000+Math.floor(Math.random()*1000),status:'OK',note:''};
      if(i===4&&sec==='2'){run.goal=null;run.status='DNF';run.note='転倒';}
      if(i===9){run.start=run.goal=null;run.status='DNS';}
      S.runs.push(run);
    }
  }
  save();renderAll();alert('サンプルデータを追加しました（12名・2セクション）');
};
$('#prec').onchange=e=>{S.settings.prec=+e.target.value;save();renderAll();};
$('#evName').oninput=e=>{S.event.name=e.target.value;save();};
$('#evDate').onchange=e=>{S.event.date=e.target.value;save();};
window.addEventListener('storage',e=>{if(e.key===KEY){load();renderAll();}}); // 別タブで更新された場合

function renderAll(){
  $('#evName').value=S.event.name||'';$('#evDate').value=S.event.date||'';$('#prec').value=S.settings.prec;
  renderRiders();renderRuns();renderResults();tPreview();
}
load();renderAll();
