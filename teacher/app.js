const API_BASE='https://listeni-lab-api-yuhpblgpyn.cn-hangzhou.fcapp.run';
const KEY_STORAGE='listening-lab:teacher-key';
const IS_LOCAL=['127.0.0.1','localhost'].includes(location.hostname);
const PACK_URL=setId=>IS_LOCAL?`/packs/${encodeURIComponent(setId)}/pack.json`:`../practice_packs/${encodeURIComponent(setId)}/pack.json`;
const app=document.getElementById('app');

let teacherKey=sessionStorage.getItem(KEY_STORAGE)||'';
let sessions=[];
let answerMap=new Map();
let questionMeta=new Map();
let materialMeta=new Map();
let loadedSetId='';
const questionCollator=new Intl.Collator(undefined,{numeric:true,sensitivity:'base'});

function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function parseJson(v,fallback=[]){try{return typeof v==='string'?JSON.parse(v):v??fallback;}catch{return fallback;}}
function fmtTime(ms){
  if(!ms)return '—';
  const d=new Date(Number(ms));
  return new Intl.DateTimeFormat('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(d);
}
function fmtDuration(start,end){
  if(!start||!end)return '—';
  const s=Math.max(0,Math.round((Number(end)-Number(start))/1000));
  const m=Math.floor(s/60),sec=s%60;
  return m?m+'分'+String(sec).padStart(2,'0')+'秒':sec+'秒';
}
function statusLabel(s){return ({completed:'已完成',abandoned:'中途退出',in_progress:'进行中'})[s]||s||'未知';}
function modeLabel(s){
  if(s==='type_practice')return '题型专项';
  if(s==='single_talk')return '单篇讲座精练';
  if(s==='full_module')return '完整模块';
  return s||'—';
}
function authHeaders(){return {'X-Teacher-Key':teacherKey};}
async function api(path){
  const res=await fetch(API_BASE+path,{headers:authHeaders()});
  const data=await res.json().catch(()=>({}));
  if(res.status===401){sessionStorage.removeItem(KEY_STORAGE);teacherKey='';throw new Error('教师访问密钥不正确');}
  if(!res.ok||data.ok!==true)throw new Error(data.error||('API '+res.status));
  return data;
}
async function loadPack(setId){
  setId=String(setId||'').trim();
  if(!setId){answerMap=new Map();questionMeta=new Map();materialMeta=new Map();loadedSetId='';return;}
  if(loadedSetId===setId)return;
  const res=await fetch(PACK_URL(setId),{cache:'no-store'});
  if(!res.ok)throw new Error('无法读取题包 '+setId+'（HTTP '+res.status+'）');
  const raw=await res.json();
  answerMap=new Map(); questionMeta=new Map(); materialMeta=new Map();
  for(const mod of raw.modules||[]){
    for(const mat of mod.materials||[]){materialMeta.set(mod.module_id+'-'+mat.material_id,{...mat,module_id:mod.module_id});}
    for(const q of mod.questions||[]){
      const id=mod.module_id+'-'+q.question_id;
      answerMap.set(id,q.correct_answer||'');
      questionMeta.set(id,{...q,module_id:mod.module_id});
    }
  }
  loadedSetId=setId;
}
function loginView(message=''){
  app.innerHTML=`<div class="login-wrap"><div class="card login-card">
    <h1>Listening Lab 教师页面</h1>
    <p>查看课堂练习记录、首听表现、分析路径与单篇讲座分析。教师密钥只保存在当前浏览器标签页，不写入 GitHub。</p>
    <form id="loginForm">
      <div class="field"><label>教师访问密钥</label><input id="teacherKey" type="password" autocomplete="current-password" placeholder="输入 Function Compute 中设置的 TEACHER_KEY"></div>
      <button class="btn" type="submit">进入教师页面</button>
      ${message?`<div class="error">${esc(message)}</div>`:''}
    </form>
  </div></div>`;
  document.getElementById('loginForm').onsubmit=async e=>{
    e.preventDefault();
    teacherKey=document.getElementById('teacherKey').value.trim();
    if(!teacherKey)return;
    sessionStorage.setItem(KEY_STORAGE,teacherKey);
    try{await boot();}catch(err){loginView(err.message||String(err));}
  };
}
function layout(inner,actions=''){
  app.innerHTML=`<div class="topbar"><div><div class="brand">Listening Lab · 教师页面</div><div class="subtitle">Classroom Pilot · All Sets</div></div><div class="spacer"></div>${actions}<button class="btn ghost" id="logoutBtn">退出教师页面</button></div><div class="shell">${inner}</div>`;
  document.getElementById('logoutBtn').onclick=()=>{sessionStorage.removeItem(KEY_STORAGE);teacherKey='';loginView();};
}
function stats(){
  return {
    total:sessions.length,
    completed:sessions.filter(x=>x.status==='completed').length,
    abandoned:sessions.filter(x=>x.status==='abandoned').length,
    active:sessions.filter(x=>x.status==='in_progress').length
  };
}
function dashboardView(){
  const s=stats();
  const inner=`
    <div class="page-head"><div><h1>课堂练习记录</h1><p>按学生代号、练习类型和状态查看服务器记录。</p></div><div class="spacer"></div><button class="btn secondary" id="refreshBtn">刷新数据</button></div>
    <div class="metrics">
      <div class="card metric"><div class="label">总 Session</div><div class="value">${s.total}</div></div>
      <div class="card metric"><div class="label">已完成</div><div class="value">${s.completed}</div></div>
      <div class="card metric"><div class="label">中途退出</div><div class="value">${s.abandoned}</div></div>
      <div class="card metric"><div class="label">进行中</div><div class="value">${s.active}</div></div>
    </div>
    <div class="card filters">
      <input id="searchInput" placeholder="搜索学生代号 / Session ID">
      <select id="statusFilter"><option value="">全部状态</option><option value="completed">已完成</option><option value="abandoned">中途退出</option><option value="in_progress">进行中</option></select>
      <select id="modeFilter"><option value="">全部练习</option><option value="type_practice">题型专项</option><option value="single_talk">单篇讲座精练</option><option value="full_module">完整模块</option></select>
      <select id="setFilter"><option value="">全部套题</option>${[...new Set(sessions.map(x=>x.set_id).filter(Boolean))].sort().reverse().map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('')}</select>
      <button class="btn secondary" id="clearFilters">清空筛选</button>
    </div>
    <div class="card table-card"><div class="table-wrap"><table>
      <thead><tr><th>学生</th><th>套题</th><th>练习</th><th>模块</th><th>状态</th><th>开始</th><th>时长</th><th>Session</th><th></th></tr></thead>
      <tbody id="sessionRows"></tbody>
    </table></div></div>`;
  layout(inner);
  const search=document.getElementById('searchInput'),status=document.getElementById('statusFilter'),mode=document.getElementById('modeFilter'),setFilter=document.getElementById('setFilter');
  const renderRows=()=>{
    const q=search.value.trim().toLowerCase();
    const rows=sessions.filter(x=>(!q||String(x.student_code||'').toLowerCase().includes(q)||String(x.session_id||'').toLowerCase().includes(q))&&(!status.value||x.status===status.value)&&(!mode.value||x.practice_mode===mode.value)&&(!setFilter.value||x.set_id===setFilter.value));
    document.getElementById('sessionRows').innerHTML=rows.length?rows.map(x=>`<tr>
      <td><b>${esc(x.student_code||'—')}</b></td>
      <td class="code">${esc(x.set_id||'—')}</td>
      <td>${esc(modeLabel(x.practice_mode))}<div class="small">${esc(x.material_id||'')}</div></td>
      <td>${esc(x.module_id||'—')}</td>
      <td><span class="badge ${esc(x.status||'other')}">${esc(statusLabel(x.status))}</span></td>
      <td>${fmtTime(x.started_at)}</td>
      <td>${fmtDuration(x.started_at,x.ended_at)}</td>
      <td class="code">${esc((x.session_id||'').slice(0,18))}…</td>
      <td><button class="link-btn" data-id="${esc(x.session_id)}">查看详情 →</button></td>
    </tr>`).join(''):`<tr><td colspan="9" class="empty">没有符合条件的记录</td></tr>`;
    document.querySelectorAll('[data-id]').forEach(btn=>btn.onclick=()=>{location.hash='session='+encodeURIComponent(btn.dataset.id);route();});
  };
  [search,status,mode,setFilter].forEach(el=>el.oninput=renderRows);
  document.getElementById('clearFilters').onclick=()=>{search.value='';status.value='';mode.value='';setFilter.value='';renderRows();};
  document.getElementById('refreshBtn').onclick=refreshSessions;
  renderRows();
}
function answerPill(value,correct){
  if(!value)return '<span class="answer-pill">—</span>';
  const cls=correct?value===correct?'ok':'bad':'';
  return `<span class="answer-pill ${cls}">${esc(value)}</span>`;
}
function answerFor(meta,qid){
  const direct=answerMap.get(qid);
  if(direct)return direct;
  const moduleId=String(meta?.module_id||'').trim();
  if(meta?.practice_mode==='full_module'&&moduleId){
    return answerMap.get(moduleId+'-'+qid)||'';
  }
  return '';
}
function detailStats(detail){
  const responses=detail.responses||[], attempts=detail.attempts||[];
  const meta=detail.session||{};
  const amap=new Map(attempts.map(x=>[x.question_id,x]));
  let firstCorrect=0,finalCorrect=0,recovered=0,withKey=0;
  for(const r of responses){
    const ans=answerFor(meta,r.question_id);
    if(!ans)continue;
    withKey++;
    const first=r.first_answer||'';
    const a=amap.get(r.question_id)||{};
    const final=a.post_transcript_answer||a.second_answer||first;
    if(first===ans)firstCorrect++;
    if(final===ans)finalCorrect++;
    if(first!==ans&&final===ans)recovered++;
  }
  return {answered:responses.length,analyzed:attempts.length,withKey,firstCorrect,finalCorrect,recovered};
}
function materialCard(x){
  const before=parseJson(x.main_points_before,[]);
  const after=parseJson(x.main_points_after,[]);
  const vocab=parseJson(x.vocab_marks,[]);
  const issues=parseJson(x.framework_issues,[]);
  const points=arr=>Array.isArray(arr)&&arr.length?'<ol>'+arr.map(p=>'<li>'+esc(p?.text??p)+'</li>').join('')+'</ol>':'—';
  return `<div class="card material-card"><h3>${esc(x.material_id||'Material')}</h3>
    <div class="row"><b>Topic · Before</b> ${esc(x.topic_before||'—')}</div>
    <div class="row"><b>Main Points · Before</b> ${points(before)}</div>
    <div class="row"><b>Topic · After</b> ${esc(x.topic_after||'—')}</div>
    <div class="row"><b>Main Points · After</b> ${points(after)}</div>
    <div class="row"><b>Framework</b> ${issues.length?issues.map(v=>'<span class="reason">'+esc(v)+'</span>').join(''):'—'}</div>
    <div class="row"><b>Vocab Marks</b> ${Array.isArray(vocab)?vocab.length:0}</div>
  </div>`;
}
async function sessionView(id){
  layout('<div class="empty">正在读取 Session…</div>','<button class="btn ghost" id="backBtn">← 返回列表</button>');
  document.getElementById('backBtn').onclick=()=>{location.hash='';route();};
  let data;
  try{data=await api('/teacher/session/'+encodeURIComponent(id));}
  catch(err){layout(`<div class="card empty">读取失败：${esc(err.message||err)}</div>`,'<button class="btn ghost" id="backBtn">← 返回列表</button>');document.getElementById('backBtn').onclick=()=>{location.hash='';route();};return;}
  const meta=data.session||{}, responses=[...(data.responses||[])].sort((a,b)=>questionCollator.compare(a.question_id||'',b.question_id||'')), attempts=[...(data.attempts||[])].sort((a,b)=>questionCollator.compare(a.question_id||'',b.question_id||'')), analyses=[...(data.material_analysis||[])].sort((a,b)=>questionCollator.compare(a.material_id||'',b.material_id||''));
  const st=detailStats(data), amap=new Map(attempts.map(x=>[x.question_id,x]));
  const pct=(a,b)=>b?Math.round(a/b*100)+'%':'—';
  const rows=responses.map(r=>{
    const a=amap.get(r.question_id)||{}, correct=answerFor(meta,r.question_id)||'', first=r.first_answer||'', final=a.post_transcript_answer||a.second_answer||first;
    const firstOk=correct&&first===correct, finalOk=correct&&final===correct;
    const rowClass=!firstOk&&finalOk?'recovered':correct&&!finalOk?'wrong':'';
    const reasons=parseJson(a.error_reasons,[]);
    return `<tr class="${rowClass}"><td><b>${esc(r.question_id)}</b></td><td>${answerPill(first,correct)}</td><td>${answerPill(correct,'')}</td><td>${r.response_ms!=null?Math.round(Number(r.response_ms))/1000+'s':'—'}</td><td>${answerPill(a.second_answer||'','')}</td><td>${answerPill(a.post_transcript_answer||'','')}</td><td>${esc(a.resolution_stage||'—')}</td><td>${Array.isArray(reasons)?reasons.map(v=>'<span class="reason">'+esc(v)+'</span>').join(''):'—'}</td></tr>`;
  }).join('');
  const inner=`
    <div class="detail-head"><button class="btn secondary" id="backBtn">← 返回列表</button><div><h1>${esc(meta.student_code||'未命名学生')}</h1><div class="small code">${esc(meta.session_id||'')}</div></div><div class="spacer"></div><span class="badge ${esc(meta.status||'other')}">${esc(statusLabel(meta.status))}</span></div>
    <div class="card meta-grid">
      <div class="meta-item"><div class="k">练习类型</div><div class="v">${esc(modeLabel(meta.practice_mode))}</div></div>
      <div class="meta-item"><div class="k">模块</div><div class="v">${esc(meta.module_id||'—')}</div></div>
      <div class="meta-item"><div class="k">开始</div><div class="v">${fmtTime(meta.started_at)}</div></div>
      <div class="meta-item"><div class="k">时长</div><div class="v">${fmtDuration(meta.started_at,meta.ended_at)}</div></div>
    </div>
    <div class="metrics">
      <div class="card metric"><div class="label">First Attempt 已作答</div><div class="value">${st.answered}</div></div>
      <div class="card metric"><div class="label">首听正确率</div><div class="value">${pct(st.firstCorrect,st.withKey)}</div><div class="small">${st.firstCorrect}/${st.withKey}</div></div>
      <div class="card metric"><div class="label">已进入分析</div><div class="value">${st.analyzed}</div></div>
      <div class="card metric"><div class="label">分析后修正</div><div class="value">${st.recovered}</div><div class="small">最终正确率 ${pct(st.finalCorrect,st.withKey)}</div></div>
    </div>
    <div class="section"><h2>题目记录</h2><div class="card table-card"><div class="table-wrap"><table class="question-table">
      <thead><tr><th>题目</th><th>First</th><th>正确答案</th><th>反应时间</th><th>Second</th><th>Transcript 后</th><th>分析路径</th><th>错因</th></tr></thead>
      <tbody>${rows||'<tr><td colspan="8" class="empty">没有 First Attempt 数据</td></tr>'}</tbody>
    </table></div></div></div>
    ${analyses.length?`<div class="section"><h2>材料分析</h2><div class="material-grid">${analyses.map(materialCard).join('')}</div></div>`:''}
    <div class="section"><details class="card" style="padding:16px"><summary><b>原始数据</b></summary><pre class="raw">${esc(JSON.stringify(data,null,2))}</pre></details></div>
  `;
  layout(inner);
  document.getElementById('backBtn').onclick=()=>{location.hash='';route();};
}
async function refreshSessions(){
  try{
    const data=await api('/teacher/sessions?limit=500');
    sessions=data.sessions||[];
    dashboardView();
  }catch(err){
    if(!teacherKey)return loginView(err.message||String(err));
    layout(`<div class="card empty">读取失败：${esc(err.message||err)}</div>`);
  }
}
async function route(){
  const m=location.hash.match(/^#session=(.+)$/);
  if(m)return sessionView(decodeURIComponent(m[1]));
  dashboardView();
}
async function boot(){
  if(!teacherKey)return loginView();
  const data=await api('/teacher/sessions?limit=500');
  sessions=data.sessions||[];
  await route();
}
window.addEventListener('hashchange',()=>{if(teacherKey)route();});
boot().catch(err=>loginView(err.message||String(err)));
