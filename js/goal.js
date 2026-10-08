/*
 * goal.js — ゴール端末（goal.html）。各ゴールのスマホ・PCで、BIBと時刻を入力してオンラインの親システムへ送る。
 * 通信が途切れても入力は止めない：Firestoreのオフライン保存に加えて、この端末で入力した記録の控えを
 * localStorage にも残し、サーバーに届いていないものは再送する。どうしても送れないときはファイルに書き出せる。
 */
'use strict';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const {z2h,parseClock,nat,NOCLS}=Core;
const fmtClock=ms=>Core.fmtClock(ms,2);
const CKEY='raceTimer_goal';
const logKey=eid=>'raceTimer_goal_log_'+eid;     // この端末で入力した記録の控え
const rosterKey=eid=>'raceTimer_goal_roster_'+eid;

const G={cfg:null,roster:null,server:[],fromCache:true,error:'',unsub:[],resent:new Set()};
const ls={
  get(k,d){try{const t=localStorage.getItem(k);return t?JSON.parse(t):d;}catch(_){return d;}},
  set(k,v){try{localStorage.setItem(k,JSON.stringify(v));}catch(_){setError('⚠ この端末に控えを保存できません');}},
};
const myLog=()=>ls.get(logKey(G.cfg.eid),[]);
const mySecLog=()=>myLog().filter(e=>e.sec===G.cfg.sec); // 登録をやり直してセクションが変わった場合に備えて絞る
const riders=()=>(G.roster&&G.roster.riders)||[];
const riderByBib=b=>{b=z2h(b).trim();return b?riders().find(r=>String(r.bib)===b):undefined;};
function setError(t){G.error=t;render();}

function show(id){['setup','main','na'].forEach(x=>{$('#'+x).hidden=x!==id;});}

/* ---------- 記録（サーバーの記録＋端末内の控え） ---------- */
function allEntries(){
  const ids=new Set(G.server.map(e=>e.id));
  const mine=mySecLog().filter(e=>!ids.has(e.id)).map(e=>({...e,pending:true,localOnly:true}));
  return G.server.concat(mine);
}
// 名簿にないBIBの記録も書き出せるよう、仮のライダーを補う
function ridersWithUnknown(list){
  const rs=riders().slice(),known=new Set(rs.map(r=>String(r.bib)));
  for(const e of list)if(!rs.some(r=>r.uid===e.rider)&&e.bib&&!known.has(String(e.bib))){known.add(String(e.bib));rs.push({uid:'bib_'+e.bib,bib:String(e.bib),name:'（名簿にないBIB）',kana:'',cls:'',note:''});}
  return rs;
}
const runsNow=()=>Core.runsFromEntries(allEntries(),riders());

function send(entry){
  const id=Online.newEntryId(G.cfg.eid);
  const e={...entry,sec:G.cfg.sec,dev:G.cfg.label,clientAt:Date.now()};
  const log=myLog();log.push({id,...e});ls.set(logKey(G.cfg.eid),log);
  Online.addEntry(G.cfg.eid,e,id).catch(onErr);
  render();
}
// サーバーの最新状態（キャッシュではない）に、この端末の控えが無ければ再送する（端末内のオフライン保存が消えた場合など）
function resendMissing(){
  if(G.fromCache)return;
  const ids=new Set(G.server.map(e=>e.id));
  for(const e of mySecLog()){
    if(ids.has(e.id)||G.resent.has(e.id))continue;
    G.resent.add(e.id);
    const {id,...rest}=e;
    Online.addEntry(G.cfg.eid,rest,id).catch(onErr);
  }
}
function onErr(e){
  console.error(e);
  if(e&&e.code==='permission-denied')setError('⚠ 送信が拒否されました。この端末の登録が無効になった可能性があります。本部に確認し、必要なら「端末の登録をやり直す」を押してください。（入力した記録はこの端末に残っています）');
  else setError('⚠ '+(e&&e.message||e));
}

/* ---------- 入力 ---------- */
const mode=()=>G.cfg.mode==='start'?'start':'goal';
const fieldName=f=>f==='start'?'スタート':'ゴール';
function setMode(m){G.cfg.mode=m;ls.set(CKEY,G.cfg);render();$('#g_bib').focus();}
document.querySelectorAll('.mode button').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));

function lookup(){
  const bib=z2h($('#g_bib').value).trim();
  if(!bib)return {bib};
  const r=riderByBib(bib);
  const run=r&&runsNow().runs.find(x=>x.rider===r.uid&&x.sec===G.cfg.sec);
  return {bib,r,run};
}
function preview(){
  const {bib,r,run}=lookup();let h='';
  if(bib){
    h=r?`<span class="ok">${esc(r.name)}（${esc(r.cls||NOCLS)}）</span>`:`<span class="ng">BIB ${esc(bib)} は名簿にありません</span>`;
    if(run)h+=`<br><span class="muted">記録済み：スタート ${fmtClock(run.start)||'—'} ／ ゴール ${fmtClock(run.goal)||'—'}${run.status!=='OK'?' ／ '+run.status:''}</span>`;
  }
  const t=parseClock($('#g_time').value);
  $('#g_time').classList.toggle('bad',Number.isNaN(t));
  if(Number.isNaN(t))h+=` <span class="ng">時刻の形式が正しくありません</span>`;
  $('#g_who').innerHTML=h;
}
['#g_bib','#g_time'].forEach(s=>$(s).addEventListener('input',preview));
$('#gForm').addEventListener('keydown',e=>{
  if(e.key!=='Enter'||e.isComposing)return;
  e.preventDefault();
  if(e.target.id==='g_bib'){$('#g_time').focus();$('#g_time').select();}else $('#gForm').requestSubmit();
});
function confirmRider(bib,r){
  return r||confirm(`BIB ${bib} は名簿にありません。このまま記録しますか？\n（本部でこのBIBのライダーが登録されると、自動で結果に反映されます）`);
}
$('#gForm').onsubmit=e=>{
  e.preventDefault();
  const {bib,r,run}=lookup();
  if(!bib){alert('BIBを入力してください');$('#g_bib').focus();return;}
  const t=parseClock($('#g_time').value);
  if(t==null){alert('時刻を入力してください');$('#g_time').focus();return;}
  if(Number.isNaN(t)){alert('時刻の形式が正しくありません');$('#g_time').focus();return;}
  if(!confirmRider(bib,r))return;
  const f=mode();const entry={rider:r?r.uid:null,bib,[f]:t};
  if(run&&run[f]!=null&&run[f]!==t){
    if(!confirm(`BIB ${bib} には既に${fieldName(f)} ${fmtClock(run[f])} が入っています。\n${fmtClock(t)} に訂正しますか？`))return;
    entry.fix=true;
  }
  const note=$('#g_note').value.trim();if(note)entry.note=note;
  send(entry);
  $('#g_bib').value='';$('#g_time').value='';$('#g_note').value='';preview();$('#g_bib').focus();
};
document.querySelectorAll('[data-status]').forEach(b=>b.onclick=()=>{
  const {bib,r}=lookup();const st=b.dataset.status;
  if(!bib){alert('BIBを入力してください');$('#g_bib').focus();return;}
  if(!confirmRider(bib,r))return;
  if(!confirm(`BIB ${bib}${r?' '+r.name:''} を ${st} として記録しますか？`))return;
  const entry={rider:r?r.uid:null,bib,status:st};
  const note=$('#g_note').value.trim();if(note)entry.note=note;
  send(entry);
  $('#g_bib').value='';$('#g_time').value='';$('#g_note').value='';preview();$('#g_bib').focus();
});
$('#g_now').onclick=()=>{
  const d=new Date();
  const ms=((d.getHours()*60+d.getMinutes())*60+d.getSeconds())*1000+d.getMilliseconds();
  $('#g_time').value=Core.fmtClockFull(ms);preview();
};
// 自分の入力の取り消し：その項目を、自分の入力より前の値に戻す（自分の値が採用されていなければ、採用中の値で確定して競合を消す）
function cancelEntry(id){
  const e=allEntries().find(x=>x.id===id);if(!e)return;
  const r=riders().find(x=>x.uid===e.rider)||riderByBib(e.bib);
  const run=r&&runsNow().runs.find(x=>x.rider===r.uid&&x.sec===G.cfg.sec);
  const f=e.goal!=null?'goal':e.start!=null?'start':e.status?'status':null;if(!f)return;
  const what=f==='status'?e.status:`${fieldName(f)} ${fmtClock(e[f])}`;
  if(!confirm(`BIB ${e.bib} の「${what}」を取り消しますか？`))return;
  if(f==='status'){send({rider:e.rider,bib:e.bib,status:'OK'});return;}
  const cur=run?run[f]:null;
  send({rider:e.rider,bib:e.bib,[f]:cur===e[f]?null:cur,fix:true});
}
window.cancelEntry=cancelEntry;

/* ---------- 表示 ---------- */
function describe(e){
  if(e.del)return '削除（本部）';
  const parts=[];
  for(const f of ['start','goal'])if(f in e&&(e[f]!=null||e.fix))parts.push(`${fieldName(f)} ${e[f]!=null?fmtClock(e[f]):'取消'}`);
  if(e.status)parts.push(e.status==='OK'?(parts.length?'':'状態を戻す'):e.status);
  return (e.fix?'訂正：':'')+parts.filter(Boolean).join(' ')+(e.note?`（${e.note}）`:'');
}
function render(){
  if(!G.cfg)return;
  const ev=(G.roster&&G.roster.event)||{};
  $('#g_title').textContent=`${ev.name||'大会'}　セクション${G.cfg.sec}`;
  $('#g_sub').textContent=`端末名：${G.cfg.label}　大会コード：${G.cfg.eid}`+(G.roster?'':'　（名簿をまだ受信していません）');
  const list=allEntries();
  const pend=list.filter(e=>e.pending).length;
  const s=$('#g_sync');
  if(G.fromCache){s.className='sync ng';s.textContent=`⚠ 通信なし（入力は端末に保存され、つながると自動で送信）${pend?` 未送信 ${pend} 件`:''}`;}
  else if(pend){s.className='sync ng';s.textContent=`送信中… 未送信 ${pend} 件`;}
  else{s.className='sync ok';s.textContent='✓ すべて送信済み';}
  document.querySelectorAll('.mode button').forEach(b=>b.classList.toggle('on',b.dataset.mode===mode()));
  $('#g_tlabel').textContent=fieldName(mode())+'時刻';

  const R=Core.runsFromEntries(list,riders());
  const warn=[];
  if(G.error)warn.push(esc(G.error));
  const cf=new Set(R.conflicts.map(c=>c.rider));
  if(cf.size)warn.push(`⚠ 時刻が食い違う記録があります（BIB ${[...cf].map(u=>esc(riders().find(r=>r.uid===u)?.bib)).join('、')}）。本部が確認します。`);
  const un=[...new Set(R.unmatched.map(e=>e.bib))];
  if(un.length)warn.push(`名簿にないBIB：${un.map(esc).join('、')}（本部で登録されると反映されます）`);
  $('#g_warn').innerHTML=warn.map(w=>`<div class="ng">${w}</div>`).join('');

  const me=Online.user()&&Online.user().uid;
  const rows=list.slice().sort((a,b)=>(b.clientAt||0)-(a.clientAt||0));
  $('#g_count').textContent=`セクション${G.cfg.sec}の入力 ${rows.length} 件`;
  $('#g_list').innerHTML='<tr><th>入力</th><th>BIB</th><th>氏名</th><th>内容</th><th>端末</th><th></th></tr>'+
    rows.map(e=>{const r=riders().find(x=>x.uid===e.rider)||riderByBib(e.bib);const t=new Date(e.clientAt||0);
      const mine=e.by===me||e.localOnly;
      return `<tr><td>${t.toLocaleTimeString('ja-JP')}</td><td><b>${esc(e.bib)}</b></td><td>${esc(r?r.name:'')}</td><td>${esc(describe(e))}</td>
        <td>${mine?'この端末':esc(e.dev||'')}${e.pending?' <span class="pend">未送信</span>':''}</td>
        <td>${mine&&!e.fix&&!e.del&&(e.start!=null||e.goal!=null||(e.status&&e.status!=='OK'))?`<button class="b s" onclick="cancelEntry('${esc(e.id)}')">取消</button>`:''}</td></tr>`;}).join('')+
    (rows.length?'':'<tr><td colspan="6" class="muted">まだ入力はありません</td></tr>');
}

/* ---------- ファイルへの書き出し（通信がまったく使えなかったときの予備） ---------- */
$('#g_export').onclick=()=>{
  const list=allEntries(),rs=ridersWithUnknown(list);
  const ro=G.roster||{};
  const data={version:2,event:ro.event||{name:'',date:''},settings:ro.settings||{prec:2},classes:ro.classes||[],riders:rs,startOrder:[],startClassOrder:[],
    runs:Core.runsFromEntries(list,rs).runs};
  const b=new Blob([JSON.stringify(data,null,1)],{type:'application/json'});const a=document.createElement('a');
  const d=new Date(),p=n=>String(n).padStart(2,'0');
  a.href=URL.createObjectURL(b);a.download=`section${G.cfg.sec}_${G.cfg.label.replace(/[\\/:*?"<>|\s]+/g,'_')}_${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.json`;
  document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},1000);
};

/* ---------- 端末の登録 ---------- */
$('#g_reset').onclick=()=>{
  if(!confirm('端末の登録をやり直しますか？（この端末で入力した記録の控えは残ります）'))return;
  openSetup(G.cfg);
};
$('#s_cancel').onclick=()=>{show('main');};
function openSetup(prev){
  const q=new URLSearchParams(location.search);
  $('#s_eid').value=prev?.eid||q.get('e')||'';$('#s_sec').value=prev?.sec||'';$('#s_pin').value='';$('#s_label').value=prev?.label||'';
  $('#s_cancel').hidden=!G.cfg;$('#s_info').innerHTML='';show('setup');
}
const withTimeout=(p,ms)=>Promise.race([p,new Promise((_,ng)=>setTimeout(()=>ng(new Error('timeout')),ms))]);
$('#setupForm').onsubmit=async e=>{
  e.preventDefault();
  const cfg={eid:z2h($('#s_eid').value).trim().toUpperCase(),sec:z2h($('#s_sec').value).trim(),label:$('#s_label').value.trim(),mode:G.cfg?.mode||ls.get(CKEY,{}).mode||'goal'};
  const pin=z2h($('#s_pin').value).trim();
  if(!cfg.eid||!cfg.sec||!pin||!cfg.label){alert('すべての欄を入力してください');return;}
  $('#s_submit').disabled=true;$('#s_info').innerHTML='登録中…';
  try{
    await Online.init();await Online.signInAnon();
    await withTimeout(Online.registerDevice(cfg.eid,cfg.sec,pin,cfg.label),20000);
    G.cfg=cfg;ls.set(CKEY,cfg);G.error='';start();
  }catch(err){
    console.error(err);
    $('#s_info').innerHTML=`<span class="ng">${err&&err.message==='timeout'?'通信できません。電波の届く場所でもう一度お試しください。'
      :err&&err.code==='permission-denied'?'登録できませんでした。大会コード・セクション#・PINを確認してください。':'登録できませんでした：'+esc(err&&err.message||err)}</span>`;
  }finally{$('#s_submit').disabled=false;}
};

function start(){
  G.unsub.forEach(f=>{try{f();}catch(_){}});G.unsub=[];
  G.roster=ls.get(rosterKey(G.cfg.eid),null);G.server=[];G.fromCache=true;G.resent.clear();
  show('main');render();$('#g_bib').focus();
  G.unsub.push(Online.watchEvent(G.cfg.eid,d=>{if(d&&d.roster){G.roster=d.roster;ls.set(rosterKey(G.cfg.eid),d.roster);}render();preview();},onErr));
  G.unsub.push(Online.watchEntries(G.cfg.eid,G.cfg.sec,(list,meta)=>{G.server=list;G.fromCache=meta.fromCache;resendMissing();render();},onErr));
}

async function boot(){
  const why=Online.unavailableReason();
  if(why){
    $('#na_msg').innerHTML=why==='file'?'このページは、Webで公開している版（https://〜）を開いて使ってください。'
      :'オンライン機能が未設定です（js/firebase-config.js）。本部に確認してください。';
    show('na');return;
  }
  Online.registerOffline();
  G.cfg=ls.get(CKEY,null);
  const q=new URLSearchParams(location.search).get('e');
  if(G.cfg&&q&&q.toUpperCase()!==G.cfg.eid)G.cfg=null; // 別の大会のURLで開いた
  if(!G.cfg){openSetup(null);return;}
  try{await Online.init();}catch(e){$('#na_msg').textContent='読み込みに失敗しました：'+(e.message||e);show('na');return;}
  if(!Online.user()){const prev=G.cfg;G.cfg=null;openSetup(prev);$('#s_info').innerHTML='<span class="ng">この端末のログイン情報が見つかりません。もう一度PINを入力して登録してください。</span>';return;}
  start();
}
boot();
