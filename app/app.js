const app = document.getElementById('app');
const audio = document.getElementById('audio');
const ACTIVE_SELECTION_KEY = 'listening-lab:active-selection';
const NAVIGATION_KEY = 'listening-lab:navigation-v1.9.2';
const CLASSROOM_STUDENT_KEY = 'listening-lab:classroom-student-code';
const ACTIVE_SESSION_POINTER_KEY = 'listening-lab:active-session-v1.9.3';
const CLASSROOM_API_BASE = 'https://listeni-lab-api-yuhpblgpyn.cn-hangzhou.fcapp.run';
const IS_GITHUB_PAGES = location.hostname.endsWith('github.io');
const REPO_NAME = IS_GITHUB_PAGES ? (location.pathname.split('/').filter(Boolean)[0] || 'Listening-Lab') : '';
const REPO_BASE = IS_GITHUB_PAGES ? `/${REPO_NAME}` : '';
const PACK_BASE = IS_GITHUB_PAGES ? `${REPO_BASE}/practice_packs` : '/packs';
let PACK_CATALOG = [];
let CATALOG_ERRORS = [];
let ACTIVE_PACK = null;
let ACTIVE_PACK_FOLDER = '';
let MODULES = [];
let moduleData = null;
let MATERIAL_SEQUENCE = [];
let STORAGE_KEY = '';

function resolvePackAsset(folder,path){
  if(!path) return '';
  if(/^(?:https?:|data:|blob:|\/)/i.test(path)) return path;
  return `${PACK_BASE}/${encodeURIComponent(folder)}/${String(path).replace(/^\.\//,'')}`;
}
function transcriptToText(value){
  if(Array.isArray(value)) return value.map(x=>{
    if(typeof x==='string') return x;
    const speaker=x?.speaker?`${x.speaker}: `:'';
    return `${speaker}${x?.text||''}`;
  }).filter(Boolean).join('\n\n');
  return value||'';
}
function defaultMaterialTitle(type){
  return ({best_response:'Choose the best response.',conversation:'Listen to a conversation.',announcement:'Listen to an announcement.',academic_talk:'Listen to a talk.'})[type]||'Listening';
}
function compilePack(raw,folder){
  const setId=raw.set_id||folder;
  return (raw.modules||[]).map(mod=>{
    const mats=new Map((mod.materials||[]).map(m=>[m.material_id,m]));
    const moduleAudio=resolvePackAsset(folder,mod.audio);
    const moduleTitle=mod.title||`${setId} · ${mod.module_id}`;
    const questions=(mod.questions||[]).map(q=>{
      const m=mats.get(q.material_id);
      if(!m) throw new Error(`${setId}/${mod.module_id}: question ${q.question_id} references missing material ${q.material_id}`);
      const opts=(q.options||[]).map(x=>typeof x==='string'?x:(x?.text||''));
      return {
        id:q.question_id,
        displayId:q.question_id,
        sourceQuestionId:q.question_id,
        sourceMaterialId:m.material_id,
        sourceModuleId:mod.module_id,
        sourceModuleTitle:moduleTitle,
        sourceAudio:moduleAudio,
        type:m.type,
        materialId:m.material_id,
        displayMaterialId:m.material_id,
        title:m.title||defaultMaterialTitle(m.type),
        listenWindow:m.listen_window,
        visual:resolvePackAsset(folder,m.visual),
        timerSec:Number(q.timer_sec)||(m.type==='academic_talk'?30:20),
        stem:q.stem||defaultMaterialTitle(m.type),
        options:opts,
        answer:q.correct_answer,
        answerVerified:q.answer_verified!==false,
        speakerGender:m.speaker_gender||null,
        transcript:transcriptToText(m.transcript),
        audioMissing:m.audio_missing===true,
        wordTimings:m.word_timings||[],
        wordTimingsAbsolute:m.word_timings_absolute===true,
        explanation:q.explanation||'',
        teacherEvidence:q.evidence||[]
      };
    });
    return {
      id:mod.id||`${setId}-${mod.module_id}`,
      moduleId:mod.module_id,
      title:moduleTitle,
      sourceAudio:moduleAudio,
      questionCount:questions.length,
      questions,
      trainingMode:'full_module',
      questionType:null,
      sourceModules:[mod.module_id]
    };
  });
}
function buildTypeModule(type){
  const setId=ACTIVE_PACK?.set_id||ACTIVE_PACK_FOLDER;
  const sourceModules=[];
  const questions=[];
  MODULES.forEach(m=>{
    const matched=m.questions.filter(q=>q.type===type);
    if(!matched.length) return;
    sourceModules.push(m.moduleId);
    matched.forEach(q=>{
      const sourceQid=q.sourceQuestionId||q.id;
      const sourceMid=q.sourceMaterialId||q.materialId;
      questions.push({
        ...q,
        id:`${m.moduleId}-${sourceQid}`,
        displayId:`${m.moduleId}·${sourceQid}`,
        materialId:`${m.moduleId}::${sourceMid}`,
        displayMaterialId:`${m.moduleId}·${sourceMid}`,
        sourceQuestionId:sourceQid,
        sourceMaterialId:sourceMid,
        sourceModuleId:m.moduleId,
        sourceModuleTitle:m.title,
        sourceAudio:q.sourceAudio||m.sourceAudio
      });
    });
  });
  if(!questions.length) return null;
  return {
    id:`${setId}-TYPE-${type}`,
    moduleId:`TYPE:${type}`,
    title:`${setId} · ${typeLabel(type)} 专项`,
    sourceAudio:null,
    questionCount:questions.length,
    questions,
    trainingMode:'question_type',
    questionType:type,
    sourceModules
  };
}

function buildSingleTalkModule(sourceModuleId,sourceMaterialId){
  const setId=ACTIVE_PACK?.set_id||ACTIVE_PACK_FOLDER;
  const src=MODULES.find(m=>m.moduleId===sourceModuleId||m.id===sourceModuleId);
  if(!src) return null;
  const matched=src.questions.filter(q=>q.type==='academic_talk'&&(q.sourceMaterialId||q.materialId)===sourceMaterialId);
  if(!matched.length) return null;
  const questions=matched.map(q=>({
    ...q,
    id:`${sourceModuleId}-${q.sourceQuestionId||q.id}`,
    displayId:`${sourceModuleId}·${q.sourceQuestionId||q.id}`,
    materialId:`${sourceModuleId}::${sourceMaterialId}`,
    displayMaterialId:`${sourceModuleId}·${sourceMaterialId}`,
    sourceQuestionId:q.sourceQuestionId||q.id,
    sourceMaterialId,
    sourceModuleId,
    sourceModuleTitle:src.title,
    sourceAudio:q.sourceAudio||src.sourceAudio
  }));
  return {
    id:`${setId}-TALK-${sourceModuleId}-${sourceMaterialId}`,
    moduleId:`TALK:${sourceModuleId}:${sourceMaterialId}`,
    title:`${setId} · ${sourceModuleId} · ${sourceMaterialId} 单篇讲座精练`,
    sourceAudio:questions[0]?.sourceAudio||src.sourceAudio,
    questionCount:questions.length,
    questions,
    trainingMode:'single_talk',
    questionType:'academic_talk',
    sourceModules:[sourceModuleId],
    talkRef:{sourceModuleId,sourceMaterialId,title:questions[0]?.title||'Academic Talk'}
  };
}
function isSingleTalkMode(){ return moduleData?.trainingMode==='single_talk'; }
function isGuidedPracticeMode(){ return ['question_type','single_talk'].includes(moduleData?.trainingMode); }
function audioSourceFor(q){ return q?.sourceAudio||moduleData?.sourceAudio||''; }
function questionLabel(q){ return q?.displayId||q?.id||''; }
function materialLabel(q){ return q?.displayMaterialId||q?.materialId||''; }
function sessionModeLabel(){ if(moduleData?.trainingMode==='question_type') return `专项 · ${typeLabel(moduleData.questionType)}`; if(moduleData?.trainingMode==='single_talk') return `单篇讲座精练 · ${moduleData.talkRef?.sourceModuleId||''}·${moduleData.talkRef?.sourceMaterialId||''}`; return 'Listening'; }
async function fetchCatalog(){
  const catalogUrl=IS_GITHUB_PAGES?`${PACK_BASE}/catalog.json`:'/api/packs';
  const res=await fetch(catalogUrl,{cache:'no-store'});
  if(!res.ok) throw new Error(`Cannot read pack catalog (${res.status})`);
  const data=await res.json();
  PACK_CATALOG=Array.isArray(data.packs)?data.packs:[];
  CATALOG_ERRORS=Array.isArray(data.errors)?data.errors:[];
  return PACK_CATALOG;
}
async function fetchPack(folder){
  const meta=PACK_CATALOG.find(x=>x.folder===folder||x.set_id===folder);
  if(!meta) throw new Error(`Practice pack not found: ${folder}`);
  const file=meta.pack_file||'pack.json';
  const res=await fetch(`${PACK_BASE}/${encodeURIComponent(meta.folder)}/${encodeURIComponent(file)}`,{cache:'no-store'});
  if(!res.ok) throw new Error(`Cannot read ${meta.folder}/${file} (${res.status})`);
  return {raw:await res.json(),meta};
}
async function selectModuleGlobals(packRef,moduleRef){
  const loaded=await fetchPack(packRef);
  ACTIVE_PACK=loaded.raw; ACTIVE_PACK_FOLDER=loaded.meta.folder;
  MODULES=compilePack(ACTIVE_PACK,ACTIVE_PACK_FOLDER);
  const requested=moduleRef||MODULES[0]?.moduleId;
  if(String(requested||'').startsWith('TALK:')){
    const parts=String(requested).split(':');
    moduleData=buildSingleTalkModule(parts[1],parts.slice(2).join(':'));
  }else if(String(requested||'').startsWith('TYPE:')){
    moduleData=buildTypeModule(String(requested).slice(5));
  }else{
    moduleData=MODULES.find(m=>m.id===requested||m.moduleId===requested) || MODULES[0];
  }
  if(!moduleData) throw new Error(`No matching practice module in pack ${ACTIVE_PACK_FOLDER}: ${requested||'(none)'}`);
  MATERIAL_SEQUENCE=[...new Set(moduleData.questions.map(q=>q.materialId))];
  STORAGE_KEY=`listening-lab:v1.9.2:${ACTIVE_PACK.set_id||ACTIVE_PACK_FOLDER}:${moduleData.moduleId||moduleData.id}`;
  try{ localStorage.setItem(ACTIVE_SELECTION_KEY,JSON.stringify({pack:ACTIVE_PACK_FOLDER,module:moduleData.moduleId||moduleData.id,training_mode:moduleData.trainingMode||'full_module',question_type:moduleData.questionType||null})); }catch(e){}
}
function readActiveSelection(){
  try{ const raw=localStorage.getItem(ACTIVE_SELECTION_KEY); return raw?JSON.parse(raw):null; }catch(e){ return null; }
}
function readNavigation(){
  try{ const raw=localStorage.getItem(NAVIGATION_KEY); return raw?JSON.parse(raw):null; }catch(e){ return null; }
}
function writeNavigation(view,pack=null){
  try{ localStorage.setItem(NAVIGATION_KEY,JSON.stringify({view,pack:pack||ACTIVE_PACK_FOLDER||null,at:Date.now()})); }catch(e){}
}
function readActiveSessionPointer(){
  try{ const raw=localStorage.getItem(ACTIVE_SESSION_POINTER_KEY); return raw?JSON.parse(raw):null; }catch(e){ return null; }
}
function writeActiveSessionPointer(){
  if(!state||!moduleData||!STORAGE_KEY||!['practice','analysis','results'].includes(state.view)) return;
  try{
    localStorage.setItem(ACTIVE_SESSION_POINTER_KEY,JSON.stringify({
      pack:ACTIVE_PACK_FOLDER,
      module:moduleData.moduleId||moduleData.id,
      storageKey:STORAGE_KEY,
      view:state.view,
      savedAt:Date.now(),
      sessionId:state.sessionId||null,
      studentCode:state.cloud?.studentCode||'',
      completed:!!(state.resultsRevealed||state.cloud?.finalStatus==='completed')
    }));
  }catch(e){}
}
function clearActiveSessionPointer(){ try{ localStorage.removeItem(ACTIVE_SESSION_POINTER_KEY); }catch(e){} }
const letters = ['A','B','C','D'];

const ERROR_REASONS = [
  ['sound_unclear','这句话/关键词我没听清'],
  ['sound_meaning','词听出来了，但没马上反应出意思'],
  ['unknown_vocab','有单词或短语我不认识'],
  ['long_sentence','句子太长，前后关系没理清'],
  ['purpose_focus','我没抓住说话人的目的、态度或重点'],
  ['wrong_evidence','我找错了答案依据的位置'],
  ['option_analysis','我理解了听力，但选项理解或比较错了'],
  ['attention','我中间走神或漏听了一部分'],
  ['guess','我当时不确定，基本是猜的'],
  ['other','其他']
];


function escapeHtml(v){ return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',"'":'&#39;'}[c]||c)); }
function nowIso(){ return new Date().toISOString(); }
function makeSessionId(){ return `${moduleData?.id||'navigation'}-${Date.now()}`; }

const cloudResponseTimers=new Map();
const cloudQuestionTimers=new Map();
const cloudMaterialTimers=new Map();
const CLASSROOM_SET_IDS=new Set(['20260830A','20260908A','20260909A','20260909B','20260915A','20260916A','20260920A','20260923A','20261004A','20261005A']);
function classroomEligible(){ return CLASSROOM_SET_IDS.has(ACTIVE_PACK?.set_id||ACTIVE_PACK_FOLDER); }
function cloudReady(){ return !!(state?.cloud?.sessionId&&classroomEligible()); }
function classroomStudentCode(){
  let previous='';
  try{ previous=localStorage.getItem(CLASSROOM_STUDENT_KEY)||''; }catch(e){}
  const code=window.prompt('请输入课堂代号（例如 ZJM、0347-03）。本次练习记录会保存到课堂服务器。',previous)?.trim();
  if(!code) return null;
  try{ localStorage.setItem(CLASSROOM_STUDENT_KEY,code); }catch(e){}
  return code.slice(0,40);
}
async function classroomPost(path,payload){
  const res=await fetch(`${CLASSROOM_API_BASE}${path}`,{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(payload)
  });
  const data=await res.json().catch(()=>({}));
  if(!res.ok||data.ok!==true) throw new Error(data.error||`Classroom API ${res.status}`);
  return data;
}
function classroomPracticeMode(){
  if(isSingleTalkMode()) return 'single_talk';
  if(moduleData?.trainingMode==='question_type') return 'type_practice';
  return 'full_module';
}
function classroomModuleId(){
  if(isSingleTalkMode()) return moduleData?.talkRef?.sourceModuleId||'';
  if(moduleData?.trainingMode==='question_type'){
    const src=Array.isArray(moduleData?.sourceModules)?moduleData.sourceModules.filter(Boolean):[];
    return src.length?src.join('+'):(moduleData?.moduleId||moduleData?.id||'');
  }
  return moduleData?.moduleId||moduleData?.id||'';
}
async function beginClassroomSession(){
  if(!classroomEligible()) return true;
  const studentCode=classroomStudentCode();
  if(!studentCode){ alert('需要课堂代号才能开始云端课堂练习。'); return false; }
  const materialId=isSingleTalkMode()?[
    moduleData?.talkRef?.sourceModuleId,
    moduleData?.talkRef?.sourceMaterialId
  ].filter(Boolean).join('-'):(moduleData?.moduleId||moduleData?.id||'');
  try{
    const data=await classroomPost('/session',{
      session_id:state.sessionId,
      student_code:studentCode,
      set_id:ACTIVE_PACK?.set_id||ACTIVE_PACK_FOLDER,
      material_id:materialId,
      practice_mode:classroomPracticeMode(),
      module_id:classroomModuleId()
    });
    state.cloud={enabled:true,studentCode,sessionId:data.session_id,status:'connected',lastError:null,finalStatus:null};
    persist();
    return true;
  }catch(err){
    state.cloud={enabled:false,studentCode,sessionId:null,status:'error',lastError:String(err?.message||err),finalStatus:null};
    alert('课堂服务器暂时无法连接。本次练习不会开始，以免记录丢失。\n\n'+state.cloud.lastError);
    return false;
  }
}
async function finishCloudSession(status){
  if(!cloudReady()) return;
  if(state.cloud?.finalStatus) return;
  if(!['completed','abandoned'].includes(status)) return;
  state.cloud.finalStatus=status;
  try{
    await classroomPost('/session/status',{
      session_id:state.cloud.sessionId,
      status,
      event_log:state.eventLog||[]
    });
    state.cloud.status='connected';
    state.cloud.lastError=null;
  }catch(err){
    state.cloud.finalStatus=null;
    state.cloud.status='error';
    state.cloud.lastError=String(err?.message||err);
    console.warn('Session status sync failed',err);
  }
}
function questionHasResponseData(q){
  if(!q) return false;
  const meta=state.firstMeta[q.id]||{};
  return !!(state.firstAnswers[q.id]||meta.completedAt||meta.selections?.length);
}
function questionResponsePayload(q){
  const meta=state.firstMeta[q.id]||{};
  const selections=Array.isArray(meta.selections)?meta.selections:[];
  return {
    session_id:state.cloud.sessionId,
    question_id:q.id,
    first_answer:state.firstAnswers[q.id]||'',
    initial_answer:selections[0]?.answer||'',
    selection_history:selections.map(x=>({answer:x.answer||'',at:x.at||'',elapsed_ms:Number.isFinite(x.elapsedMs)?Math.round(x.elapsedMs):null})),
    selection_count:selections.length,
    change_count:Math.max(0,selections.length-1),
    response_ms:Number.isFinite(meta.responseMs)?Math.round(meta.responseMs):null,
    timeout:!!meta.timeout,
    answered_at:meta.completedAt||selections.at(-1)?.at||''
  };
}
async function syncCloudResponse(qid){
  if(!cloudReady()) return;
  const q=moduleData?.questions?.find(x=>x.id===qid);
  if(!q||!questionHasResponseData(q)) return;
  try{ await classroomPost('/response',questionResponsePayload(q)); state.cloud.status='connected'; state.cloud.lastError=null; }
  catch(err){ state.cloud.status='error'; state.cloud.lastError=String(err?.message||err); console.warn('Response cloud sync failed',err); }
}
function queueCloudResponse(qid,delay=500){
  if(!cloudReady()||!qid) return;
  clearTimeout(cloudResponseTimers.get(qid));
  cloudResponseTimers.set(qid,setTimeout(()=>{cloudResponseTimers.delete(qid);syncCloudResponse(qid);},delay));
}
function questionHasCloudData(q){
  if(!q) return false;
  const err=state.errorData[q.id];
  const fn=state.functionData[q.id],review=state.reviewData[q.id];
  return !!(state.secondAnswers[q.id]||state.postTranscriptAnswers[q.id]||state.evidence[q.id]||state.confidenceData[q.id]||state.understandingData[q.id]||(fn&&(fn.functionTag||fn.keyMeaning))||(review&&(review.visits||review.note||review.evidence||review.audioActions?.length))||(err&&err.status!=='pending'));
}
function questionEventHistory(qid,type){
  return (state.eventLog||[]).filter(x=>x?.questionId===qid&&x?.type===type).map(x=>({answer:x.answer||'',at:x.at||''}));
}
function questionCloudPayload(q){
  const payload={
    session_id:state.cloud.sessionId,
    question_id:q.id
  };
  const second=state.secondAnswers[q.id];
  const post=state.postTranscriptAnswers[q.id];
  const secondHistory=questionEventHistory(q.id,'second_answer');
  const postHistory=questionEventHistory(q.id,'post_transcript_answer');
  const conf=state.confidenceData[q.id]||null;
  const understand=state.understandingData[q.id]||null;
  const err=state.errorData[q.id]||null;
  const e=state.evidence[q.id]||null;
  const fn=state.functionData[q.id]||null;
  const review=state.reviewData[q.id]||null;

  if(second) payload.second_answer=second;
  if(post) payload.post_transcript_answer=post;
  if(secondHistory.length){
    payload.second_selection_history=secondHistory;
    payload.second_change_count=Math.max(0,secondHistory.length-1);
  }
  if(postHistory.length){
    payload.post_selection_history=postHistory;
    payload.post_change_count=Math.max(0,postHistory.length-1);
  }
  if(fn?.functionTag) payload.function_tag=fn.functionTag;
  if(fn?.keyMeaning) payload.key_meaning=fn.keyMeaning;
  if(review) payload.post_review=review;
  if(conf?.level) payload.confidence=conf.level;
  if(conf) payload.analysis_skipped=!!conf.analysisSkipped;

  if(understand?.status==='understood_after_replay') payload.resolution_stage='replay';
  else if(understand?.status==='deep_analysis') payload.resolution_stage='deep_analysis';
  else if(conf?.analysisSkipped) payload.resolution_stage='high_confidence';

  if(err?.status==='confirmed'||err?.status==='skipped') payload.error_reasons=err.selected||[];

  if(e){
    payload.evidence_start=e.type==='point'?e.point:e.start;
    payload.evidence_end=e.type==='point'?e.point:e.end;
  }
  return payload;
}
function errCodes(qid){ return state.errorData[qid]?.selected||[]; }
async function syncCloudQuestion(qid){
  if(!cloudReady()) return;
  const q=moduleData?.questions?.find(x=>x.id===qid);
  if(!q||!questionHasCloudData(q)) return;
  try{ await classroomPost('/question',questionCloudPayload(q)); state.cloud.status='connected'; state.cloud.lastError=null; }
  catch(err){ state.cloud.status='error'; state.cloud.lastError=String(err?.message||err); console.warn('Question cloud sync failed',err); }
}
function queueCloudQuestion(qid,delay=700){
  if(!cloudReady()||!qid) return;
  clearTimeout(cloudQuestionTimers.get(qid));
  cloudQuestionTimers.set(qid,setTimeout(()=>{cloudQuestionTimers.delete(qid);syncCloudQuestion(qid);},delay));
}
function materialHasCloudData(mid){
  if(!mid) return false;
  if(isSingleTalkMode()){
    const t=state.talkLab||{},v=t.vocab?.[mid],fb=t.frameworkBefore?.[mid],fa=t.frameworkAfter?.[mid],fi=t.frameworkIssues?.[mid];
    return !!(state.transcriptViewed[mid]||v?.none||v?.markers?.length||fb||fa||fi||t.directTranscriptSkip?.[mid]||t.postUnchanged?.[mid]||state.replayDecision[mid]||state.materialReplayCount[mid]);
  }
  const m=state.materialMaps[mid]||{};
  return !!(state.transcriptViewed[mid]||state.replayDecision[mid]||state.materialReplayCount[mid]||m.topic||m.main1||m.main2||m.main3||m.topicDontKnow||m.mainDontKnow);
}
function materialCloudPayload(mid){
  if(!isSingleTalkMode()){
    const m=state.materialMaps[mid]||{};
    return {
      session_id:state.cloud.sessionId,
      material_id:mid,
      topic_before:m.topic||'',
      main_points_before:[m.main1,m.main2,m.main3].filter(Boolean).map(text=>({text})),
      topic_dont_know:!!m.topicDontKnow,
      main_dont_know:!!m.mainDontKnow,
      replay_decision:state.replayDecision[mid]||'',
      replay_count:Number(state.materialReplayCount[mid]||0),
      transcript_viewed:!!state.transcriptViewed[mid]
    };
  }
  const t=talkLabState(),v=talkVocab(mid),fb=talkFrameworkBefore(mid),fa=talkFrameworkAfter(mid),fi=talkFrameworkIssues(mid);
  return {
    session_id:state.cloud.sessionId,
    material_id:[
      moduleData?.talkRef?.sourceModuleId,
      moduleData?.talkRef?.sourceMaterialId
    ].filter(Boolean).join('-'),
    topic_before:fb.topic||'',
    main_points_before:(fb.mainPoints||[]).map(x=>({text:x.text||'',time:Number.isFinite(x.time)?x.time:null})),
    topic_after:fa.topic||'',
    main_points_after:(fa.mainPoints||[]).map(x=>({text:x.text||'',time:Number.isFinite(x.time)?x.time:null})),
    vocab_marks:(v.markers||[]).map(x=>({time:x.time,heard_text:x.heard||'',actual_text:x.corrected||'',meaning:x.meaning||'',note:x.note||''})),
    framework_issues:fi.accurate?['accurate']:[...(fi.selected||[]),...(fi.note?[fi.note]:[])],
    direct_transcript_skip:!!t.directTranscriptSkip?.[mid],
    post_unchanged:!!t.postUnchanged?.[mid],
    replay_decision:state.replayDecision[mid]||'',
    replay_count:Number(state.materialReplayCount[mid]||0),
    transcript_viewed:!!state.transcriptViewed[mid]
  };
}
async function syncCloudMaterial(mid){
  if(!cloudReady()||!materialHasCloudData(mid)) return;
  try{ await classroomPost('/analysis',materialCloudPayload(mid)); state.cloud.status='connected'; state.cloud.lastError=null; }
  catch(err){ state.cloud.status='error'; state.cloud.lastError=String(err?.message||err); console.warn('Material cloud sync failed',err); }
}
function queueCloudMaterial(mid,delay=900){
  if(!cloudReady()||!mid) return;
  clearTimeout(cloudMaterialTimers.get(mid));
  cloudMaterialTimers.set(mid,setTimeout(()=>{cloudMaterialTimers.delete(mid);syncCloudMaterial(mid);},delay));
}
function queueCloudSyncFromState(){
  if(!cloudReady()||!moduleData||!state) return;
  const q=typeof getQ==='function'?getQ():null;
  if(q&&questionHasResponseData(q)) queueCloudResponse(q.id);
  if(q&&questionHasCloudData(q)) queueCloudQuestion(q.id);
  if(q&&materialHasCloudData(q.materialId)) queueCloudMaterial(q.materialId);
}
function newState(){
  return {
    version:'1.9.2', sessionId:makeSessionId(), startedAt:nowIso(), view:'sets', idx:0,
    showTime:true, practicePhase:'listen', timer:0, timerId:null, progressPct:0,
    initialAudioDelayDone:false, prepareSeconds:0,
    firstAnswers:{}, firstMeta:{}, practiceAnswersVisible:false,
    secondAnswers:{}, postTranscriptAnswers:{},
    functionData:{}, materialMaps:{},
    evidence:{}, evidenceDraft:{},
    errorData:{}, transcriptViewed:{}, transcriptShown:{}, confidenceData:{}, understandingData:{},
    replayDecision:{}, materialReplayCount:{}, materialPositions:{}, loadedMaterialId:null,
    segment:null, isPlaying:false,
    resultsRevealed:false, reviewMode:false, reviewQuestionId:null, reviewData:{},
    cloud:{enabled:false,studentCode:'',sessionId:null,status:'idle',lastError:null,finalStatus:null},
    talkLab:{mode:'assignment',vocab:{},frameworkBefore:{},frameworkAfter:{},frameworkIssues:{},questionNotes:{},directTranscriptSkip:{},postUnchanged:{}},
    eventLog:[],
    paused:false, pauseSnapshot:null,
    autosaveAt:null, refreshSnapshot:null, uiScroll:null, pageScrollY:0, completionAuditOpen:false, resultsUi:{scrollTop:0,openQids:[]}, restoreResultsUiOnRender:false, practiceReviewOpen:false, practiceReviewSnapshot:null
  };
}
let state = null;
let timeupdateHandler = null;
let practiceStartDelayTimer = null;
let practicePlaybackToken = 0;
let practiceStartTimeout = null;
let startInFlight = false;
const PRACTICE_PREP_SECONDS = 3;
const MOBILE_AUDIO_TAIL_SEC = 0.35;

audio.volume = 1;

function logEvent(type,payload={}){
  state.eventLog.push({at:nowIso(),type,view:state.view,questionId:getQ()?.id||null,materialId:getQ()?.materialId||null,...payload});
  persist();
}
function persist(){
  state.autosaveAt=nowIso();
  try{
    const serial={...state,timerId:null,pauseSnapshot:state.pauseSnapshot?{...state.pauseSnapshot}:null};
    if(STORAGE_KEY) localStorage.setItem(STORAGE_KEY,JSON.stringify(serial));
    writeActiveSessionPointer();
  }catch(e){}
  try{ queueCloudSyncFromState(); }catch(e){}
}

function saveRuntimeSnapshot(){
  try{
    if(state.view==='analysis') state.uiScroll=captureAnalysisScroll();
    state.pageScrollY = window.scrollY || 0;
    if(state.view==='analysis') saveMaterialPosition();
    state.refreshSnapshot={
      savedAt:Date.now(), view:state.view, idx:state.idx, practicePhase:state.practicePhase,
      audioTime:Number.isFinite(audio.currentTime)?audio.currentTime:null,
      audioWasPlaying:!audio.paused && state.isPlaying,
      timerRunning:state.view==='practice' && state.practicePhase==='answer' && !!state.timerId,
      timerRemaining:state.timer,
      materialId:getQ()?.materialId||null,
      progressPct:state.progressPct
    };
    persist();
  }catch(e){}
}
function restorePersistedState(){
  try{
    const raw=localStorage.getItem(STORAGE_KEY); if(!raw) return false;
    const saved=JSON.parse(raw); if(!saved || !saved.sessionId) return false;
    const base=newState();
    state={...base,...saved,timerId:null,version:'1.9.2'};
    state.idx=Math.max(0,Math.min(moduleData.questions.length-1,Number(state.idx)||0));
    state.eventLog=Array.isArray(state.eventLog)?state.eventLog:[];
    state.materialPositions=state.materialPositions||{};
    state.firstAnswers=state.firstAnswers||{}; state.firstMeta=state.firstMeta||{};
    state.secondAnswers=state.secondAnswers||{}; state.postTranscriptAnswers=state.postTranscriptAnswers||{};
    state.functionData=state.functionData||{}; state.materialMaps=state.materialMaps||{};
    state.evidence=state.evidence||{}; state.evidenceDraft=state.evidenceDraft||{};
    state.errorData=state.errorData||{}; state.transcriptViewed=state.transcriptViewed||{}; state.transcriptShown=state.transcriptShown||{};
    state.confidenceData=state.confidenceData||{}; state.understandingData=state.understandingData||{}; state.replayDecision=state.replayDecision||{}; state.materialReplayCount=state.materialReplayCount||{};
    state.reviewData=state.reviewData||{}; state.resultsUi=state.resultsUi||{scrollTop:0,openQids:[]}; state.restoreResultsUiOnRender=!!state.restoreResultsUiOnRender;
    state.practiceReviewOpen=false; state.practiceReviewSnapshot=null;
    const snap=state.refreshSnapshot||{};
    if(['practice','analysis'].includes(state.view)){
      if(state.paused && state.pauseSnapshot){
        state.pauseSnapshot={...state.pauseSnapshot,restoredFromRefresh:true};
      }else{
        state.paused=true;
        state.pauseSnapshot={
          audioWasPlaying:!!snap.audioWasPlaying,
          timerRunning:!!snap.timerRunning,
          pausedAt:Date.now(),
          audioTime:Number.isFinite(snap.audioTime)?snap.audioTime:null,
          timerRemaining:Number.isFinite(snap.timerRemaining)?snap.timerRemaining:state.timer,
          restoredFromRefresh:true
        };
      }
      state.isPlaying=false;
      state.timerId=null;
    }else{
      state.paused=false; state.pauseSnapshot=null;
    }
    return true;
  }catch(e){ return false; }
}
function prepareRestoredPracticeAudio(){
  if(state.view!=='practice') return;
  const q=getQ(),snap=state.refreshSnapshot||{},target=Number.isFinite(snap.audioTime)?snap.audioTime:q.listenWindow[0];
  { const src=audioSourceFor(q); if(!audio.src||!audio.src.includes(src)){ audio.src=src; audio.preload='auto'; audio.load(); } }
  const apply=()=>{
    const t=Math.min(q.listenWindow[1],Math.max(q.listenWindow[0],target));
    try{ audio.currentTime=t; }catch(e){}
    if(state.practicePhase==='listen'){
      state.progressPct=Math.min(100,Math.max(0,((t-q.listenWindow[0])/(q.listenWindow[1]-q.listenWindow[0]))*100));
      updatePracticeProgress();
    }
  };
  if(audio.readyState>=1) apply(); else audio.addEventListener('loadedmetadata',apply,{once:true});
}
function resumePracticeFromRefresh(t){
  const q=getQ(),start=q.listenWindow[0],end=q.listenWindow[1];
  { const src=audioSourceFor(q); if(!audio.src||!audio.src.includes(src)) audio.src=src; }
  const run=()=>{
    const pos=Number.isFinite(t)?Math.min(end,Math.max(start,t)):start;
    audio.currentTime=pos; state.progressPct=Math.min(100,Math.max(0,((pos-start)/(end-start))*100));
    state.isPlaying=true; attachPracticeSegment(q.listenWindow,beginAnswerPhase); updatePracticeProgress(); audio.play().catch(()=>{});
  };
  if(audio.readyState>=1) run(); else audio.addEventListener('loadedmetadata',run,{once:true});
}
function resumeAnalysisFromRefresh(t){
  const q=getQ(); ensureAnalysisAudio(q);
  const run=()=>{
    const pos=Number.isFinite(t)?Math.min(q.listenWindow[1],Math.max(q.listenWindow[0],t)):currentMaterialPosition(q);
    audio.currentTime=pos; state.materialPositions[q.materialId]=pos; state.isPlaying=true; attachAnalysisTracking(q); audio.play().catch(()=>{}); refreshAnalysisTransport(q);
  };
  if(audio.readyState>=1) run(); else audio.addEventListener('loadedmetadata',run,{once:true});
}

function getQ(){ return moduleData.questions[state.idx]; }
function qIndex(id){ return moduleData.questions.findIndex(q=>q.id===id); }
function materialQuestions(mid){ return moduleData.questions.filter(q=>q.materialId===mid); }
function materialIndex(mid){ return MATERIAL_SEQUENCE.indexOf(mid); }
function sameMaterial(a,b){ return (a.materialId||a.id)===(b.materialId||b.id); }

function transcriptWordHtml(q){
 const raw=transcriptFor(q);if(!raw)return '<em>当前材料没有可用文本。</em>';
 const parts=raw.match(/\S+|\s+/g)||[],words=parts.filter(x=>x.trim()),times=q.wordTimings||[];
 const exact=times.length===words.length&&times.length>0&&times.every(x=>Number.isFinite(Number(x?.start)));
 let i=0;
 const html=parts.map(w=>{if(!w.trim())return escapeHtml(w);
  const start=exact?(q.wordTimingsAbsolute?Number(times[i].start):q.listenWindow[0]+Number(times[i].start)):q.listenWindow[0]+(q.listenWindow[1]-q.listenWindow[0])*(i+.3)/words.length;
  const t=Math.max(q.listenWindow[0],Math.min(q.listenWindow[1]-.02,start));i++;
  return '<button type="button" class="transcript-word" data-word-time="'+t.toFixed(3)+'" onclick="seekTranscriptWord('+t.toFixed(3)+')">'+escapeHtml(w)+'</button>';
 }).join('');
 return '<div class="transcript-sync-note">'+(exact?'✓ 已使用逐词对齐时间戳':'⚠ 当前题包未提供逐词时间戳；点击单词为估算跳转，不代表精确对齐')+'</div><div class="transcript-words">'+html+'</div>';
}
function seekTranscriptWord(t){if(state.paused||getQ().audioMissing)return;setAnalysisSeekValue(t,{log:true});playAnalysis();}
function highlightTranscriptWord(t){let current=null;const els=document.querySelectorAll('.transcript-word');for(const e of els){if(+e.dataset.wordTime<=t+.04)current=e;else break;}for(const e of els)e.classList.toggle('active-word',e===current);}
function showTalkPracticeAnswers(){if(!isTalkPracticeMode()||state.view!=='analysis'||state.paused)return;state.practiceAnswersVisible=true;logEvent('practice_answer_check');renderAnalysisPreserveScroll();}
function talkPracticeAnswerPanel(qs){
 if(!isTalkPracticeMode())return '';
 if(!state.practiceAnswersVisible)return '<div class="toolcard"><h3>自主练习 · 答案核对</h3><p>完成首轮作答后，可以直接校对答案，无需完成诊断分析。</p><button class="btn" onclick="showTalkPracticeAnswers()">查看正确答案与对错</button></div>';
 const valid=qs.filter(q=>q.answer&&q.answerVerified&&!q.audioMissing),correct=valid.filter(q=>state.firstAnswers[q.id]===q.answer).length;
 return '<div class="toolcard"><h3>首轮正确率：'+correct+'/'+valid.length+'</h3><p>只统计有验证答案且音频正常的题目。</p>'+qs.map(q=>{
 const a=state.firstAnswers[q.id]||'—',ok=a===q.answer;
 if(q.audioMissing||!q.answerVerified)return '<div class="practice-answer-row">⚠ '+questionLabel(q)+'：音频或答案未核实，不计分</div>';
 return '<div class="practice-answer-row '+(ok?'correct':'incorrect')+'"><b>'+questionLabel(q)+' · '+(ok?'✓ 正确':'✕ 错误')+'</b><div>首次选择：'+a+'；正确答案：<b>'+q.answer+'</b> '+escapeHtml(q.options[letters.indexOf(q.answer)]||'')+'</div><button class="btn secondary mini-btn" onclick="jump('+qIndex(q.id)+')">本题回听</button></div>';
 }).join('')+'</div>';
}
function renderMissingAudioAnalysis(){
 const q=getQ();app.innerHTML='<main class="page"><section class="card source-audio-warning"><h2>'+questionLabel(q)+' · 音频缺失</h2><p>原题包是静音占位片段，无法用于正常听力作答；本题不计分。</p><button class="btn" onclick="goNextAnalysis()">下一题 →</button><button class="btn secondary" onclick="goFirstIncomplete()">查看待完成题</button><button class="btn secondary" onclick="go(\'library\')">退出</button></section></main>';
}

function transcriptFor(q){
  if(q.transcript) return q.transcript;
  const sibling=moduleData.questions.find(x=>sameMaterial(x,q)&&x.transcript);
  return sibling?.transcript||'';
}
function fmt(sec){ const s=Math.max(0,Math.round(Number(sec)||0)); return `00:${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; }
function fmtShort(sec){ const s=Math.max(0,Number(sec)||0); return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(Math.floor(s%60)).padStart(2,'0')}`; }
function relTime(q,t){ return Math.max(0,t-q.listenWindow[0]); }

function functionInfo(qid){
  if(!state.functionData[qid]) state.functionData[qid]={functionTag:'',keyMeaning:''};
  return state.functionData[qid];
}
function mapInfo(mid){
  if(!state.materialMaps[mid]) state.materialMaps[mid]={topic:'',topicDontKnow:false,main1:'',main2:'',main3:'',mainDontKnow:false};
  return state.materialMaps[mid];
}
function errorInfo(qid){
  if(!state.errorData[qid]) state.errorData[qid]={selected:[],otherText:'',status:'pending'};
  return state.errorData[qid];
}
function reviewInfo(qid){
  if(!state.reviewData[qid]) state.reviewData[qid]={visits:0,evidence:null,note:'',audioActions:[]};
  return state.reviewData[qid];
}

function confidenceInfo(qid){ return state.confidenceData[qid]||null; }
function understandingInfo(qid){ return state.understandingData[qid]||null; }
function questionUnderstood(q){ return understandingInfo(q.id)?.status==='understood_after_replay'; }
function questionDeepPath(q){ return understandingInfo(q.id)?.status==='deep_analysis'; }
function quickCheckReady(q){
  if(questionSkipped(q)) return false;
  if(!replayStepDone(q.materialId) || !state.secondAnswers[q.id]) return false;
  if(q.type==='best_response' && !bestCoreDone(q)) return false;
  if(q.type==='academic_talk' && !mapDone(q.materialId)) return false;
  return true;
}
function markUnderstood(){
  if(state.paused) return; const q=getQ(); if(state.transcriptViewed[q.materialId]||!quickCheckReady(q)) return;
  state.understandingData[q.id]={status:'understood_after_replay',secondAnswer:state.secondAnswers[q.id],at:nowIso()};
  // 走快速路径后，不再要求旧的深度分析字段。已有旧字段保留在日志中，但不作为完成条件。
  logEvent('analysis_understood_after_replay',{secondAnswer:state.secondAnswers[q.id]});
  renderAnalysisPreserveScroll();
}
function chooseDeepAnalysis(){
  if(state.paused) return; const q=getQ(); if(state.transcriptViewed[q.materialId]||!quickCheckReady(q)) return;
  state.understandingData[q.id]={status:'deep_analysis',secondAnswer:state.secondAnswers[q.id],at:nowIso()};
  logEvent('analysis_deep_path_selected',{secondAnswer:state.secondAnswers[q.id]});
  renderAnalysisPreserveScroll();
}
function undoUnderstandingChoice(){
  const q=getQ(); if(state.resultsRevealed||state.transcriptViewed[q.materialId]) return;
  delete state.understandingData[q.id]; logEvent('analysis_understanding_choice_undo'); renderAnalysisPreserveScroll();
}
function questionSkipped(q){ return confidenceInfo(q.id)?.analysisSkipped===true; }
function materialAllSkipped(mid){ const qs=materialQuestions(mid); return qs.length>0 && qs.every(questionSkipped); }
function questionAnalysisStarted(q){
  const f=state.functionData[q.id]; const e=state.errorData[q.id];
  return !!state.secondAnswers[q.id] || !!state.understandingData[q.id] || !!state.evidence[q.id] || !!state.evidenceDraft[q.id] || !!state.postTranscriptAnswers[q.id] || !!(f&&(f.functionTag||f.keyMeaning)) || !!(e&&e.status!=='pending');
}
function canHighConfidenceSkip(q){ return !!state.firstAnswers[q.id] && !state.transcriptViewed[q.materialId] && !questionSkipped(q) && !questionAnalysisStarted(q); }
function skipHighConfidence(){
  if(state.paused) return; const q=getQ(); if(!canHighConfidenceSkip(q)) return;
  state.confidenceData[q.id]={level:'very_high',analysisSkipped:true,firstAnswer:state.firstAnswers[q.id],at:nowIso()};
  logEvent('analysis_skip_high_confidence',{firstAnswer:state.firstAnswers[q.id],confidence:'very_high'});
  renderAnalysisPreserveScroll();
}
function undoHighConfidenceSkip(){
  const q=getQ(); if(state.resultsRevealed) return; delete state.confidenceData[q.id];
  logEvent('analysis_skip_undo'); renderAnalysisPreserveScroll();
}
function captureAnalysisScroll(){
  return {
    qid:getQ()?.id||null,
    tools:document.querySelector('.analysis-tools')?.scrollTop||0,
    question:document.querySelector('.analysis-question')?.scrollTop||0,
    nav:document.querySelector('.qnav')?.scrollTop||0
  };
}
function restoreAnalysisScroll(snap){
  if(!snap||snap.qid!==getQ()?.id) return;
  requestAnimationFrame(()=>{
    const a=document.querySelector('.analysis-tools'),b=document.querySelector('.analysis-question'),c=document.querySelector('.qnav');
    if(a)a.scrollTop=snap.tools; if(b)b.scrollTop=snap.question; if(c)c.scrollTop=snap.nav;
  });
}
function renderAnalysisPreserveScroll(){ const snap=captureAnalysisScroll(); renderAnalysis(); restoreAnalysisScroll(snap); }

function clearSegment(){
  if(timeupdateHandler){ audio.removeEventListener('timeupdate',timeupdateHandler); timeupdateHandler=null; }
}
function saveMaterialPosition(){
  if(state.loadedMaterialId && Number.isFinite(audio.currentTime)) state.materialPositions[state.loadedMaterialId]=audio.currentTime;
}
function stopAudio({save=true}={}){
  if(save) saveMaterialPosition();
  audio.pause(); state.isPlaying=false; clearSegment(); refreshAnalysisTransport();
}
function setVolume(v){ audio.volume=Math.max(0,Math.min(1,Number(v))); document.querySelectorAll('.vol-readout').forEach(el=>el.textContent=Math.round(audio.volume*100)+'%'); }
function updatePracticeProgress(){ document.querySelectorAll('.audio-progress').forEach(el=>el.style.width=`${state.progressPct}%`); }
function cancelPendingPracticePlayback(){
  practicePlaybackToken++;
  if(practiceStartTimeout){ clearTimeout(practiceStartTimeout); practiceStartTimeout=null; }
}
function primeMobileAudio(){
  // Mobile browsers may revoke autoplay permission after a delayed start.
  // Prime the shared media element synchronously from the user's Start tap.
  // Never let the async prime callback reset a real source back to time 0.
  try{
    const SILENT='data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=';
    audio.muted=true; audio.src=SILENT; audio.load();
    const cleanup=()=>{
      const stillSilent=String(audio.currentSrc||audio.src||'').startsWith('data:audio/');
      if(stillSilent){ audio.pause(); try{ audio.currentTime=0; }catch(e){} }
      audio.muted=false;
    };
    const p=audio.play();
    if(p&&typeof p.then==='function') p.then(cleanup).catch(()=>{ audio.muted=false; });
    else cleanup();
  }catch(e){ audio.muted=false; }
}
function practicePlaybackEnd(segment){
  const nominal=Number(segment?.[1])||0;
  const duration=Number.isFinite(audio.duration)?audio.duration:Infinity;
  return Math.min(duration, nominal + MOBILE_AUDIO_TAIL_SEC);
}

// ---------- Global pause / resume ----------
function pauseSession(){
  if(state.paused || !['practice','analysis'].includes(state.view)) return;
  const timerRunning = state.view==='practice' && state.practicePhase==='answer' && !!state.timerId;
  const audioWasPlaying=!audio.paused;
  state.pauseSnapshot={audioWasPlaying,timerRunning,pausedAt:Date.now(),audioTime:Number.isFinite(audio.currentTime)?audio.currentTime:null,timerRemaining:state.timer};
  clearInterval(state.timerId); state.timerId=null;
  audio.pause(); state.isPlaying=false; state.paused=true;
  logEvent('session_pause',{audioWasPlaying,timerRunning,audioTime:state.pauseSnapshot.audioTime,timerRemaining:state.timer});
  showPauseOverlay();
}
function resumeSession(){
  if(!state.paused) return;
  const snap=state.pauseSnapshot||{};
  state.paused=false; state.pauseSnapshot=null;
  removePauseOverlay();
  if(snap.timerRunning && state.view==='practice' && state.practicePhase==='answer'){
    if(Number.isFinite(snap.timerRemaining)) state.timer=snap.timerRemaining;
    startCountdown(false);
  }
  if(snap.restoredFromRefresh && state.view==='practice' && state.practicePhase==='prepare'){
    state.initialAudioDelayDone=false;
    beginInitialPracticeDelay(getQ(),state.prepareSeconds||3);
  }else if(snap.audioWasPlaying){
    if(snap.restoredFromRefresh && state.view==='practice' && state.practicePhase==='listen') resumePracticeFromRefresh(snap.audioTime);
    else if(snap.restoredFromRefresh && state.view==='analysis') resumeAnalysisFromRefresh(snap.audioTime);
    else { state.isPlaying=true; audio.play().catch(()=>{}); }
  }
  logEvent('session_resume',{pausedMs:snap.pausedAt?Date.now()-snap.pausedAt:null,restoredFromRefresh:!!snap.restoredFromRefresh});
  refreshAnalysisTransport(); persist();
}
function showPauseOverlay(){
  removePauseOverlay();
  const el=document.createElement('div'); el.id='sessionPauseOverlay'; el.className='pause-overlay';
  const restored=!!state.pauseSnapshot?.restoredFromRefresh; el.innerHTML=`<div class="pause-card"><div class="pause-icon">Ⅱ</div><h2>${restored?'练习进度已恢复':'练习已暂停'}</h2><p>${restored?'页面刷新前的题目、答案、分析数据、倒计时和音频位置都已保留。':'音频与答题倒计时均已暂停。'}</p><button class="btn" onclick="resumeSession()">${restored?'从这里继续 ▶':'继续练习 ▶'}</button></div>`;
  app.appendChild(el);
}
function removePauseOverlay(){ document.getElementById('sessionPauseOverlay')?.remove(); }

function go(view){
  if((view==='library'||view==='sets')&&cloudReady()&&!state.cloud?.finalStatus){
    finishCloudSession('abandoned');
  }
  clearInterval(state.timerId); state.timerId=null; clearPracticeStartDelay(); cancelPendingPracticePlayback(); stopAudio({save:true}); state.paused=false; removePauseOverlay(); removePracticeReviewOverlay(); state.practiceReviewOpen=false; state.practiceReviewSnapshot=null; state.view=view;
  if(view==='library') writeNavigation('library',ACTIVE_PACK_FOLDER); else if(view==='sets') writeNavigation('sets',null);
  persist(); render();
}

function confirmExitSession(){
  if(!state||!['practice','analysis','results'].includes(state.view)){ go('library'); return; }
  const completed=state.view==='results'||state.resultsRevealed;
  const message=completed
    ?'返回本套题？\n\n本次结果已经保存。之后可以通过“查看上次结果”再次进入结果页面。'
    :'暂时退出当前练习？\n\n当前进度会自动保存，之后可以通过“继续上次练习”回到当前位置。';
  if(!window.confirm(message)) return;
  logEvent('session_exit_to_library',{fromView:state.view,idx:state.idx,questionId:getQ()?.id||null});
  saveRuntimeSnapshot();
  clearInterval(state.timerId); state.timerId=null; clearPracticeStartDelay(); cancelPendingPracticePlayback();
  stopAudio({save:false}); removePauseOverlay(); removePracticeReviewOverlay();
  const packRef=ACTIVE_PACK_FOLDER;
  writeNavigation('library',packRef);
  state=newState(); state.view='library'; moduleData=null; MATERIAL_SEQUENCE=[]; STORAGE_KEY='';
  renderLibrary(); window.scrollTo(0,0);
}
function exitTypePractice(){ confirmExitSession(); }
async function resumeSavedSession(){
  const pointer=readActiveSessionPointer();
  if(!pointer?.pack||!pointer?.module){ alert('没有找到可恢复的练习记录。'); return; }
  try{
    await selectModuleGlobals(pointer.pack,pointer.module);
    state=newState();
    const restored=restorePersistedState();
    if(!restored||!['practice','analysis','results'].includes(state.view)){
      clearActiveSessionPointer(); state=newState(); state.view='library'; STORAGE_KEY='';
      alert('这条本地记录已经无法恢复。可以重新开始一轮练习。'); renderLibrary(); return;
    }
    writeNavigation('session',ACTIVE_PACK_FOLDER); render();
    if(state.view==='practice') prepareRestoredPracticeAudio();
    if(state.view==='analysis'&&state.uiScroll) restoreAnalysisScroll(state.uiScroll);
    requestAnimationFrame(()=>{ if(Number.isFinite(state.pageScrollY)) window.scrollTo(0,state.pageScrollY); });
    if(state.paused) showPauseOverlay();
  }catch(err){ alert('恢复练习失败：'+String(err?.message||err)); }
}
function practiceReviewVisitedQuestions(){
  return moduleData.questions.filter((q,i)=>i<=state.idx || !!state.firstMeta[q.id]?.completedAt || !!state.firstAnswers[q.id]);
}
function removePracticeReviewOverlay(){ document.getElementById('practiceReviewOverlay')?.remove(); }
function openPracticeReview(){
  if(!isGuidedPracticeMode() || state.practiceReviewOpen || state.view!=='practice') return;
  const timerRunning=state.practicePhase==='answer' && !!state.timerId;
  const audioWasPlaying=!audio.paused && state.isPlaying;
  state.practiceReviewSnapshot={timerRunning,audioWasPlaying,timerRemaining:state.timer,audioTime:Number.isFinite(audio.currentTime)?audio.currentTime:null};
  clearInterval(state.timerId); state.timerId=null; audio.pause(); state.isPlaying=false; state.practiceReviewOpen=true;
  logEvent('practice_review_open',{visited:practiceReviewVisitedQuestions().length});
  renderPracticeReviewOverlay(); persist();
}
function closePracticeReview(){
  if(!state.practiceReviewOpen) return;
  const snap=state.practiceReviewSnapshot||{}; removePracticeReviewOverlay(); state.practiceReviewOpen=false; state.practiceReviewSnapshot=null;
  if(snap.timerRunning && state.view==='practice' && state.practicePhase==='answer'){ if(Number.isFinite(snap.timerRemaining)) state.timer=snap.timerRemaining; startCountdown(false); }
  if(snap.audioWasPlaying && state.view==='practice' && state.practicePhase==='listen'){ state.isPlaying=true; audio.play().catch(()=>{}); }
  logEvent('practice_review_close'); persist();
}
function renderPracticeReviewOverlay(){
  removePracticeReviewOverlay();
  const visited=practiceReviewVisitedQuestions();
  const rows=visited.map((q,i)=>{
    const idx=moduleData.questions.indexOf(q), selected=state.firstAnswers[q.id]||null, current=idx===state.idx;
    const stem=q.type==='best_response'?'Choose the best response.':q.stem;
    const opts=q.options.map((o,j)=>`<div class="practice-review-option ${selected===letters[j]?'selected':''}"><span><b>${letters[j]}.</b> ${o}</span>${selected===letters[j]?'<span class="review-choice-tag">第一遍选择</span>':''}</div>`).join('');
    return `<section class="practice-review-item ${current?'current':''}"><div class="practice-review-item-head"><b>${questionLabel(q)}</b><span>${current?'当前题':(state.firstMeta[q.id]?.completedAt?'已完成':'已到达')}</span></div><div class="mini-stem">${stem}</div><div class="practice-review-options">${opts}</div></section>`;
  }).join('');
  const el=document.createElement('div'); el.id='practiceReviewOverlay'; el.className='practice-review-overlay';
  el.innerHTML=`<div class="practice-review-modal"><div class="practice-review-head"><div><h2>题目回看</h2><p>只显示本轮已经到达的题目与第一遍选择，不显示正确答案，也不会修改答案。</p></div><button class="btn secondary" onclick="closePracticeReview()">关闭并继续 →</button></div><div class="practice-review-list">${rows||'<div class="muted">还没有可回看的题目。</div>'}</div></div>`;
  app.appendChild(el);
}


function clearPracticeStartDelay(){
  if(practiceStartDelayTimer){ clearInterval(practiceStartDelayTimer); practiceStartDelayTimer=null; }
  if(practiceStartTimeout){ clearTimeout(practiceStartTimeout); practiceStartTimeout=null; }
}
function preloadPracticeSegment(q){
  if(!q||q.audioMissing) return;
  const src=audioSourceFor(q),target=Number(q.listenWindow?.[0]);
  if(!src||!Number.isFinite(target)) return;
  const apply=()=>{
    if(state?.view!=='practice'||getQ()?.id!==q.id) return;
    try{ audio.currentTime=target; }catch(e){}
  };
  if(!audio.src||!audio.src.includes(src)){ audio.src=src; audio.preload='auto'; audio.load(); }
  if(audio.readyState>=1) apply(); else audio.addEventListener('loadedmetadata',apply,{once:true});
}
function beginInitialPracticeDelay(q,seconds=PRACTICE_PREP_SECONDS){
  clearPracticeStartDelay();
  cancelPendingPracticePlayback();
  stopAudio({save:false});
  preloadPracticeSegment(q);
  state.practicePhase='prepare';
  state.prepareSeconds=Math.max(1,Number(seconds)||PRACTICE_PREP_SECONDS);
  state.progressPct=0;
  logEvent('first_audio_prepare_start',{seconds:state.prepareSeconds,questionId:q?.id||null,materialId:q?.materialId||null});
  renderPractice();
  practiceStartDelayTimer=setInterval(()=>{
    if(!state || state.view!=='practice'){ clearPracticeStartDelay(); return; }
    if(state.paused) return;
    state.prepareSeconds=Math.max(0,(Number(state.prepareSeconds)||0)-1);
    if(state.prepareSeconds<=0){
      clearPracticeStartDelay();
      state.initialAudioDelayDone=true;
      state.practicePhase='listen';
      logEvent('first_audio_prepare_end',{questionId:q?.id||null,materialId:q?.materialId||null});
      renderPractice();
      // q may have become stale after navigation/timeout; play only if it is still current.
      if(getQ()?.id===q?.id) playPracticeSegment(q.listenWindow,beginAnswerPhase);
    }else{
      const el=document.getElementById('prepareCount'); if(el) el.textContent=state.prepareSeconds;
      const label=document.querySelector('.audio-label'); if(label) label.textContent=`准备时间 · ${state.prepareSeconds} 秒后自动播放`;
      persist();
    }
  },1000);
}

// ---------- First attempt ----------
function resetAll(){
  clearInterval(state.timerId); clearPracticeStartDelay(); stopAudio({save:false}); state=newState(); audio.volume=1;
}
async function start(packRef,moduleRef,options={}){
  if(startInFlight) return;
  startInFlight=true;
  try{
    primeMobileAudio();
    if(packRef && (packRef!==ACTIVE_PACK_FOLDER || (moduleRef && moduleRef!==(moduleData?.moduleId||moduleData?.id)))) await selectModuleGlobals(packRef,moduleRef);
    resetAll();
    if(isSingleTalkMode()) state.talkLab.mode=options.talkMode==='practice'?'practice':'assignment';
    if(!(await beginClassroomSession())) return;
    state.view='practice'; state.idx=0; writeNavigation('session',ACTIVE_PACK_FOLDER); logEvent('session_start',{setId:ACTIVE_PACK?.set_id||ACTIVE_PACK_FOLDER,trainingMode:moduleData?.trainingMode||'full_module',questionType:moduleData?.questionType||null,sourceModules:moduleData?.sourceModules||[],talkMode:isSingleTalkMode()?state.talkLab.mode:null}); enterListenPhase();
  }finally{
    startInFlight=false;
  }
}
async function startType(packRef,type){ return start(packRef,`TYPE:${type}`); }
async function startSingleTalk(packRef,moduleId,materialId,mode='assignment'){ return start(packRef,`TALK:${moduleId}:${materialId}`,{talkMode:mode}); }
function attachPracticeSegment(segment,onEnd,token){
  clearSegment(); state.segment=segment; state.progressPct=0; updatePracticeProgress();
  const [a,b]=segment, effectiveEnd=practicePlaybackEnd(segment);
  const finish=()=>{
    if(token!==practicePlaybackToken) return;
    audio.pause(); state.isPlaying=false; state.progressPct=100; updatePracticeProgress(); clearSegment();
    logEvent('first_audio_end',{nominalEnd:b,effectiveEnd}); onEnd?.();
  };
  timeupdateHandler=()=>{
    if(token!==practicePlaybackToken) return;
    if(audio.currentTime<a) return;
    state.progressPct=Math.min(100,Math.max(0,((audio.currentTime-a)/(Math.max(.01,b-a)))*100)); updatePracticeProgress();
    if(audio.currentTime>=effectiveEnd-.02) finish();
  };
  audio.addEventListener('timeupdate',timeupdateHandler);
  audio.addEventListener('ended',finish,{once:true});
}
function practiceBufferedAhead(target){
  try{
    for(let i=0;i<audio.buffered.length;i++){
      const a=audio.buffered.start(i),b=audio.buffered.end(i);
      if(target>=a-.05 && target<=b+.05) return Math.max(0,b-target);
    }
  }catch(e){}
  return 0;
}
function playPracticeSegment(segment,onEnd){
  const q=getQ();
  const expectedQid=q?.id, expectedMaterialId=q?.materialId;
  cancelPendingPracticePlayback();
  const token=practicePlaybackToken;
  stopAudio({save:false});
  const src=audioSourceFor(q);
  const sourceChanged=!audio.src || !audio.src.includes(src);
  if(sourceChanged){ audio.src=src; audio.preload='auto'; audio.load(); }

  const stillCurrent=()=>token===practicePlaybackToken && state.view==='practice' && getQ()?.id===expectedQid && getQ()?.materialId===expectedMaterialId;
  const begin=()=>{
    if(!stillCurrent()) return;
    const delta=Math.abs((Number(audio.currentTime)||0)-segment[0]);
    if(delta>.18){
      logEvent('first_audio_seek_guard',{wanted:segment[0],actual:Number(audio.currentTime)||0});
      try{ audio.currentTime=segment[0]; }catch(e){}
      audio.addEventListener('seeked',()=>{ if(stillCurrent()) setTimeout(begin,40); },{once:true});
      return;
    }
    state.isPlaying=true; attachPracticeSegment(segment,onEnd,token);
    logEvent('first_audio_start',{start:segment[0],end:segment[1],effectiveEnd:practicePlaybackEnd(segment),sourceModuleId:q.sourceModuleId||moduleData.moduleId,bufferedAhead:practiceBufferedAhead(segment[0])});
    const p=audio.play();
    if(p&&typeof p.catch==='function') p.catch(err=>logEvent('first_audio_play_rejected',{message:String(err)}));
  };

  const waitForBuffer=(startedAt=performance.now())=>{
    if(!stillCurrent()) return;
    const needed=Math.min(.75,Math.max(.2,(segment[1]-segment[0])*.25));
    const enough=audio.readyState>=3 || practiceBufferedAhead(segment[0])>=needed;
    if(enough || performance.now()-startedAt>1400){ begin(); return; }
    setTimeout(()=>waitForBuffer(startedAt),70);
  };

  const seekOnce=()=>{
    if(!stillCurrent()) return;
    const target=segment[0];
    const afterSeek=()=>{
      if(!stillCurrent()) return;
      waitForBuffer();
    };
    try{
      const delta=Math.abs((Number(audio.currentTime)||0)-target);
      if(delta<=.12 && !audio.seeking){ afterSeek(); return; }
      audio.currentTime=target;
      if(audio.seeking) audio.addEventListener('seeked',afterSeek,{once:true});
      else setTimeout(afterSeek,40);
    }catch(e){
      audio.addEventListener('loadedmetadata',seekOnce,{once:true});
    }
  };

  if(audio.readyState>=1) seekOnce(); else audio.addEventListener('loadedmetadata',seekOnce,{once:true});
}
function isFirstQuestionOfMaterial(i){ return i===0 || moduleData.questions[i-1].materialId!==moduleData.questions[i].materialId; }
function enterListenPhase(){
  clearInterval(state.timerId); state.timerId=null; clearPracticeStartDelay(); cancelPendingPracticePlayback(); stopAudio({save:false});
  const q=getQ(); state.progressPct=0;
  if(q.audioMissing){state.practicePhase='source_missing';logEvent('source_audio_missing_skip',{questionId:q.id});renderPractice();return;}
  // Every piece of audio gets the same 3-second preparation period:
  // each Best Response item and the first question of each shared material.
  if(q.type==='best_response' || isFirstQuestionOfMaterial(state.idx)) beginInitialPracticeDelay(q,PRACTICE_PREP_SECONDS);
  else beginAnswerPhase();
}
function beginAnswerPhase(){
  const q=getQ(); state.practicePhase='answer'; state.timer=q.timerSec;
  state.firstMeta[q.id]=state.firstMeta[q.id]||{answerShownAt:nowIso(),answerShownMs:Date.now(),selections:[],timeout:false};
  logEvent('first_answer_phase_start',{timerSec:q.timerSec}); renderPractice(); startCountdown(true);
}
function startCountdown(reset=false){
  clearInterval(state.timerId); if(reset) state.timer=getQ().timerSec;
  state.timerId=setInterval(()=>{
    state.timer=Math.max(0,state.timer-1); const el=document.getElementById('timer'); if(el) el.textContent=state.showTime?fmt(state.timer):'--:--';
    if(state.timer===0){ clearInterval(state.timerId); state.timerId=null; const q=getQ(); state.firstMeta[q.id]=state.firstMeta[q.id]||{}; state.firstMeta[q.id].timeout=true; logEvent('first_timeout'); nextQ(true); }
  },1000);
}
function toggleTime(){ state.showTime=!state.showTime; const el=document.getElementById('timer'); if(el) el.textContent=state.showTime?fmt(state.practicePhase==='answer'?state.timer:getQ().timerSec):'--:--'; persist(); }
function chooseFirst(letter){
  if(state.practicePhase!=='answer'||state.paused) return;
  const q=getQ(); const meta=state.firstMeta[q.id]||{};
  state.firstAnswers[q.id]=letter; meta.selections=meta.selections||[]; meta.selections.push({answer:letter,at:nowIso(),elapsedMs:meta.answerShownMs?Date.now()-meta.answerShownMs:null}); meta.finalAnswer=letter; state.firstMeta[q.id]=meta;
  logEvent('first_answer_select',{answer:letter}); renderPractice();
}
function finalizeFirstQuestion(fromTimeout=false){
  const q=getQ(),meta=state.firstMeta[q.id]||{}; meta.completedAt=nowIso(); meta.responseMs=meta.answerShownMs?Date.now()-meta.answerShownMs:null; meta.timeout=!!fromTimeout; state.firstMeta[q.id]=meta;
}
function nextQ(fromTimeout=false){
  if(state.paused) return; clearInterval(state.timerId); state.timerId=null; clearPracticeStartDelay(); cancelPendingPracticePlayback(); finalizeFirstQuestion(fromTimeout); stopAudio({save:false}); logEvent('first_question_end',{timeout:!!fromTimeout,answer:state.firstAnswers[getQ().id]||null});
  if(state.idx<moduleData.questions.length-1){ state.idx++; enterListenPhase(); }
  else { state.idx=0; state.view='analysis'; logEvent('analysis_start'); renderAnalysis(); }
}

function moduleSummaryLine(m){
  const q=m.question_type_counts||{}, mt=m.material_type_counts||{};
  const bits=[`${m.question_count||0} questions`];
  if(q.best_response) bits.push(`${q.best_response} Best Response`);
  if(mt.conversation) bits.push(`${mt.conversation} Conversations`);
  if(mt.announcement) bits.push(`${mt.announcement} Announcements`);
  if(mt.academic_talk) bits.push(`${mt.academic_talk} Academic Talks`);
  return bits.map(x=>`<span>${x}</span>`).join('');
}
const TYPE_TRAINING_CONFIG={
  best_response:{title:'Best Response · 短句回应',desc:'只练短句回应。First Attempt 后保留重听、Function、Key Meaning、二次选择与深度分析路径。'},
  conversation:{title:'Conversation · 对话',desc:'按整篇 Conversation 练习。共享一次材料播放，保留二次选择、Evidence、错因与 Transcript 分析。'},
  announcement:{title:'Announcement · 公告',desc:'只练校园公告。按整篇材料完成题目，重点训练信息定位、Evidence 与文本后恢复。'},
  academic_talk:{title:'Academic Talk · 学术讲座',desc:'只练 Academic Talk。保留 Topic / Main Points、Evidence、Transcript 与结果复盘。'}
};
function typeStatsFromManifest(pack,type){
  const modules=(pack.modules||[]).filter(m=>(m.question_type_counts?.[type]||0)>0);
  return {
    questions:modules.reduce((n,m)=>n+(m.question_type_counts?.[type]||0),0),
    materials:modules.reduce((n,m)=>n+(m.material_type_counts?.[type]||0),0),
    modules:modules.map(m=>m.module_id)
  };
}
function renderTypeTrainingCards(pack){
  return Object.keys(TYPE_TRAINING_CONFIG).map(type=>{
    const st=typeStatsFromManifest(pack,type); if(!st.questions) return '';
    const cfg=TYPE_TRAINING_CONFIG[type];
    return `<section class="card specialty-card"><div class="specialty-top"><span class="specialty-kicker">题型专项训练</span><span class="module-chip">${st.modules.join(' + ')}</span></div><h3>${cfg.title}</h3><p>${cfg.desc}</p><div class="specialty-meta"><span><b>${st.questions}</b> questions</span><span><b>${st.materials}</b> materials</span></div><button class="btn" onclick="startType('${pack.folder}','${type}')">开始专项 →</button></section>`;
  }).join('');
}

function singleTalkCards(){
  const rows=[];
  MODULES.forEach(m=>{
    const mids=[...new Set(m.questions.filter(q=>q.type==='academic_talk').map(q=>q.sourceMaterialId||q.materialId))];
    mids.forEach(mid=>{
      const qs=m.questions.filter(q=>q.type==='academic_talk'&&(q.sourceMaterialId||q.materialId)===mid);
      if(!qs.length) return;
      rows.push({moduleId:m.moduleId,materialId:mid,title:qs[0].title||'Academic Talk',questions:qs.length,transcriptAvailable:!!String(qs[0].transcript||'').trim()});
    });
  });
  return rows;
}
function renderSingleTalkCards(pack){
  return singleTalkCards().map(t=>`<section class="card specialty-card talk-lab-card ${t.transcriptAvailable?'':'talk-unavailable'}"><div class="specialty-top"><span class="specialty-kicker">单篇讲座精练</span><span class="module-chip">${t.moduleId} · ${t.materialId}</span></div><h3>${t.title}</h3><p>一篇讲座单独完成：定位听不懂的词汇 → 检查 Topic / Main Points → 逐题重做与证据定位 → Transcript 后修正。</p><div class="specialty-meta"><span><b>${t.questions}</b> questions</span><span><b>1</b> talk</span><span>${t.transcriptAvailable?'✓ Transcript':'⚠ Transcript 缺失'}</span></div><div class="talk-mode-actions"><button class="btn" ${t.transcriptAvailable?`onclick="startSingleTalk('${pack.folder}','${t.moduleId}','${t.materialId}','assignment')"`:'disabled'}>${t.transcriptAvailable?'作业 / 完整分析 →':'暂不可用'}</button><button class="btn secondary" ${t.transcriptAvailable?`onclick="startSingleTalk('${pack.folder}','${t.moduleId}','${t.materialId}','practice')"`:'disabled'}>自主练习</button></div><div class="talk-mode-hint"><span><b>作业：</b>完成分析后才能看 Transcript</span><span><b>自主练习：</b>需要时可跳过分析直接看文本</span></div></section>`).join('');
}
function formatSetDate(setId){
  const m=String(setId||'').match(/^(\d{4})(\d{2})(\d{2})([A-Za-z].*)?$/);
  if(!m) return {date:String(setId||''),short:String(setId||''),version:''};
  return {date:`${m[1]}-${m[2]}-${m[3]}`,short:`${m[2]}/${m[3]}`,version:(m[4]||'').toUpperCase()};
}
function packQuestionCount(pack){ return (pack.modules||[]).reduce((n,m)=>n+(Number(m.question_count)||0),0); }
function packModuleNames(pack){ return (pack.modules||[]).map(m=>m.module_id).join(' + '); }
function currentPackMeta(){ return PACK_CATALOG.find(x=>x.folder===ACTIVE_PACK_FOLDER||x.set_id===ACTIVE_PACK?.set_id)||null; }
async function openPack(packRef){
  try{
    const loaded=await fetchPack(packRef);
    ACTIVE_PACK=loaded.raw; ACTIVE_PACK_FOLDER=loaded.meta.folder; MODULES=compilePack(ACTIVE_PACK,ACTIVE_PACK_FOLDER);
    moduleData=null; MATERIAL_SEQUENCE=[]; STORAGE_KEY='';
    state=newState(); state.view='library'; writeNavigation('library',ACTIVE_PACK_FOLDER); renderLibrary(); window.scrollTo(0,0);
  }catch(e){ showBootError(e); }
}
function goSets(){
  try{ if(state?.timerId){ clearInterval(state.timerId); state.timerId=null; } clearPracticeStartDelay(); }catch(e){}
  try{ audio.pause(); clearSegment(); }catch(e){}
  try{ removePauseOverlay(); removePracticeReviewOverlay(); }catch(e){}
  state=newState(); state.view='sets'; state.paused=false; writeNavigation('sets',null); renderSetSelection(); window.scrollTo(0,0);
}
async function reloadCatalog(){
  try{
    await fetchCatalog();
    if(state?.view==='library' && currentPackMeta()) renderLibrary(); else { if(state) state.view='sets'; renderSetSelection(); }
  }catch(e){ showBootError(e); }
}
function renderSetSelection(){
  const sorted=[...PACK_CATALOG].sort((a,b)=>String(b.set_id||b.folder).localeCompare(String(a.set_id||a.folder)));
  const cards=sorted.map(pack=>{
    const d=formatSetDate(pack.set_id||pack.folder), qc=packQuestionCount(pack), mods=packModuleNames(pack);
    return `<button class="card set-card" onclick="openPack('${pack.folder}')"><div class="set-date-block"><div class="set-short-date">${d.short}</div><div class="set-year">${d.date.slice(0,4)}</div></div><div class="set-card-main"><div class="set-kicker">Listening Test Set</div><h2>${d.date}${d.version?` · ${d.version}`:''}</h2><p>${mods||'Listening'} · ${qc} questions</p></div><div class="set-arrow">→</div></button>`;
  }).join('');
  const errors=CATALOG_ERRORS.length?`<div class="notice"><b>有题包未载入：</b>${CATALOG_ERRORS.map(x=>`<div>${x.folder||'?'}：${x.error}</div>`).join('')}</div>`:'';
  app.innerHTML=`<div class="topbar"><div class="brand">Listening Lab</div><div class="spacer"></div>${!IS_GITHUB_PAGES?'<a class="btn ghost local-teacher-link" href="/teacher/" target="_blank" rel="noopener">教师端</a>':''}<button class="btn ghost" onclick="reloadCatalog()">↻ 重新扫描题包</button></div><main class="page"><div class="hero set-hero"><div class="set-page-head"><div><div class="eyebrow">Practice Library</div><h1>选择套题</h1><p>先按日期进入一套材料，再选择整套练习、分题型练习或单篇讲座精练。新增题包后只需重新扫描。</p></div><div class="set-count"><b>${PACK_CATALOG.length}</b><span>sets</span></div></div>${errors}<div class="set-grid">${cards||'<div class="card empty-library"><h2>还没有题包</h2><p>把题包文件夹放入 practice_packs 后点击重新扫描。</p></div>'}</div></div></main>`;
}
function renderLibrary(){
  const pack=currentPackMeta();
  if(!pack){ writeNavigation('sets',null); renderSetSelection(); return; }
  writeNavigation('library',pack.folder);
  const d=formatSetDate(pack.set_id||pack.folder);
  const modules=(pack.modules||[]).map(m=>`<section class="card library-card mode-card"><div><div class="module-chip">${m.title||`${pack.set_id} · ${m.module_id}`}</div><h2>${m.module_id}</h2><div class="library-meta">${moduleSummaryLine(m)}</div></div><div><button class="btn" onclick="start('${pack.folder}','${m.module_id}')">开始 ${m.module_id} →</button></div></section>`).join('');
  const pointer=readActiveSessionPointer();
  const samePack=pointer&&(pointer.pack===pack.folder||pointer.pack===pack.set_id);
  const resumeLabel=pointer?.completed||pointer?.view==='results'?'查看上次结果':'继续上次练习';
  const resumeCard=samePack?`<section class="card resume-session-card"><div><div class="eyebrow">Saved Session</div><h2>${resumeLabel}</h2><p>${escapeHtml(pointer.module||'Listening')}${pointer.studentCode?` · 学生 ${escapeHtml(pointer.studentCode)}`:''}</p><p class="muted">退出不会清空进度。点击右侧按钮回到上次保存的位置。</p></div><button class="btn" onclick="resumeSavedSession()">${resumeLabel} →</button></section>`:'';
  const specialty=renderTypeTrainingCards(pack);
  const talks=renderSingleTalkCards(pack);
  app.innerHTML=`<div class="topbar"><div class="brand">Listening Lab</div><button type="button" class="btn ghost" onclick="goSets(); return false;">← 所有套题</button><div class="spacer"></div>${!IS_GITHUB_PAGES?'<a class="btn ghost local-teacher-link" href="/teacher/" target="_blank" rel="noopener">教师端</a>':''}</div><main class="page"><div class="hero pack-detail-hero"><div class="pack-detail-head"><div><div class="eyebrow">${d.date}${d.version?` · ${d.version}`:''}</div><h1>${pack.title||pack.set_id}</h1><p>${pack.description||'选择本套题的练习方式。'}</p></div><span class="module-chip">schema ${pack.schema_version||'?'}</span></div>${resumeCard}<section class="mode-section full-mode-section"><div class="mode-section-title"><span class="mode-number">01</span><div><h2>整套练习分析模式</h2><p>按原考试模块顺序完成 First Attempt → Analysis → Results。</p><p class="mode-start-note">每次进入一段新音频前都有 <b>3 秒准备时间</b>；同一篇材料的后续题不会重复播放音频。</p></div></div>${modules}</section><section class="mode-section type-mode-section"><div class="mode-section-title"><span class="mode-number">02</span><div><h2>分题型练习分析模式</h2><p>从本套题 M1 / M2H / M2S 中自动抽取同一题型，独立完成练习、分析与复盘。</p><p class="mode-start-note">每次进入一段新音频前都有 <b>3 秒准备时间</b>；同一篇材料的后续题不会重复播放音频。</p></div></div><div class="specialty-grid">${specialty}</div></section>${talks?`<section class="mode-section single-talk-section"><div class="mode-section-title"><span class="mode-number">03</span><div><h2>单篇讲座精练与分析</h2><p>每次只练一篇 Academic Talk。重点不是刷正确率，而是定位三类问题：<b>听不懂的词汇</b>、<b>框架理解偏差</b>、<b>题目分析偏差</b>。</p><p class="mode-start-note">第一遍仍按考试方式完整听一遍；进入分析后可自由重听和拖动定位。</p></div></div><div class="specialty-grid">${talks}</div></section>`:''}</div></main>`;
}
function renderPractice(){
  const q=getQ(),selected=state.firstAnswers[q.id];
  const td=state.practicePhase==='answer'?(state.showTime?fmt(state.timer):'--:--'):(state.showTime?fmt(q.timerSec):'--:--');
  const options=q.options.map((o,i)=>`<div class="option ${selected===letters[i]?'selected':''} ${state.practicePhase!=='answer'?'disabled-option':''}" ${state.practicePhase==='answer'?`onclick="chooseFirst('${letters[i]}')"`:''}><span class="radio"></span><span><b>${letters[i]}.</b> ${o}</span></div>`).join('');
  let right='';
  if(q.audioMissing)right='<div class="source-audio-warning"><h2>⚠ 本题缺少真实音频</h2><p>现有片段是静音占位，不计入成绩。</p><button class="btn" onclick="nextQ()">跳过本题 →</button></div>';
  else if(state.practicePhase==='prepare') right=`<div class="prep-question-pane"><div class="prep-count" id="prepareCount">${state.prepareSeconds||3}</div><h2>准备</h2><p>音频将在倒计时结束后自动播放。</p></div>`;
  else if(q.type==='best_response') right=`<h2>Choose the best response.</h2><div class="options">${options}</div>${state.practicePhase==='answer'?`<div class="question-actions"><button class="btn" ${!selected?'disabled':''} onclick="nextQ()">${state.idx===moduleData.questionCount-1?'Finish First Attempt':'Next →'}</button></div>`:''}`;
  else if(state.practicePhase==='listen') right=`<div class="blank-question-pane"></div>`;
  else right=`<div class="stem">${q.stem}</div><div class="options">${options}</div><div class="question-actions"><button class="btn" ${!selected?'disabled':''} onclick="nextQ()">${state.idx===moduleData.questionCount-1?'Finish First Attempt':'Next →'}</button></div>`;
  app.innerHTML=`<div class="practice-shell"><header class="practice-head"><button class="btn secondary type-exit-btn" onclick="confirmExitSession()">← 退出</button><div class="title">${sessionModeLabel()}</div><div>Question ${state.idx+1} of ${moduleData.questionCount}</div><div class="spacer"></div>${isGuidedPracticeMode()?`<button class="btn secondary review-questions-btn" ${state.practicePhase==='prepare'?'disabled':''} onclick="openPracticeReview()">题目回看</button>`:''}<button class="btn pause-btn" ${state.practicePhase==='prepare'?'disabled':''} onclick="pauseSession()">⏸ Pause</button><button class="btn secondary" onclick="toggleTime()">${state.showTime?'Hide Time':'Show Time'}</button><div class="timer"><span>Time</span><strong id="timer">${td}</strong></div><div class="volume-group"><span>Volume</span><input type="range" min="0" max="1" step="0.01" value="${audio.volume}" oninput="setVolume(this.value)"><span class="vol-readout">${Math.round(audio.volume*100)}%</span></div></header><div class="split"><section class="visual-pane"><img src="${q.visual}" alt="speaker visual"><div class="audio-status"><div class="bar"><span class="audio-progress"></span></div><div class="audio-label">${state.practicePhase==='prepare'?`准备时间 · ${state.prepareSeconds||3} 秒后自动播放`:(state.practicePhase==='listen'?'Audio is playing once':'Audio finished · answer now')}</div></div></section><section class="question-pane">${right}</section></div><footer class="progress-strip">${moduleData.questions.map((_,i)=>`<span class="dot ${i<state.idx?'done':i===state.idx?'current':''}"></span>`).join('')}</footer></div>`;
  updatePracticeProgress(); if(state.paused) showPauseOverlay();
}

// ---------- Analysis audio ----------
function materialStart(q){ return q.listenWindow[0]; }
function materialEnd(q){ return q.listenWindow[1]; }
function currentMaterialPosition(q){ const s=state.materialPositions[q.materialId]; return Number.isFinite(s)?Math.min(materialEnd(q),Math.max(materialStart(q),s)):materialStart(q); }
function ensureAnalysisAudio(q){
  const materialChanged=state.loadedMaterialId!==q.materialId;
  if(materialChanged) stopAudio({save:true});
  const src=audioSourceFor(q); if(!audio.src||!audio.src.includes(src)) audio.src=src;
  if(materialChanged){
    state.loadedMaterialId=q.materialId; state.segment=q.listenWindow;
    const apply=()=>{ if(state.loadedMaterialId!==q.materialId)return; try{audio.currentTime=currentMaterialPosition(q);}catch(e){} refreshAnalysisTransport(q); };
    if(audio.readyState>=1) apply(); else audio.addEventListener('loadedmetadata',apply,{once:true});
  }
}
function analysisPos(q){ return state.loadedMaterialId===q.materialId&&Number.isFinite(audio.currentTime)?Math.min(materialEnd(q),Math.max(materialStart(q),audio.currentTime)):currentMaterialPosition(q); }
function attachAnalysisTracking(q){
  clearSegment(); const [a,b]=q.listenWindow, effectiveEnd=Math.min(Number.isFinite(audio.duration)?audio.duration:Infinity,b+MOBILE_AUDIO_TAIL_SEC);
  timeupdateHandler=()=>{ if(state.loadedMaterialId!==q.materialId) return; state.materialPositions[q.materialId]=Math.min(b,audio.currentTime); if(audio.currentTime>=effectiveEnd-.02){ audio.pause(); state.isPlaying=false; state.materialPositions[q.materialId]=b; clearSegment(); } refreshAnalysisTransport(q); };
  audio.addEventListener('timeupdate',timeupdateHandler);
}
function playAnalysis(){
  if(state.paused) return; const q=getQ(); ensureAnalysisAudio(q); const [a,b]=q.listenWindow;
  if(audio.readyState<1){ audio.addEventListener('loadedmetadata',()=>playAnalysis(),{once:true}); return; }
  if(audio.currentTime<a||audio.currentTime>=b-.05) audio.currentTime=currentMaterialPosition(q)>=b-.05?a:currentMaterialPosition(q);
  const firstReplayDecision = !replayStepDone(q.materialId);
  if(!state.reviewMode){
    state.replayDecision[q.materialId]='played';
    state.materialReplayCount[q.materialId]=(state.materialReplayCount[q.materialId]||0)+1;
  }
  state.isPlaying=true; attachAnalysisTracking(q);
  logEvent(state.reviewMode?'review_audio_play':'analysis_audio_play',{position:audio.currentTime});
  audio.play().catch(()=>{}); refreshAnalysisTransport(q);
  // Step 1 is optional and “整篇 / 局部”均可，因此一旦学生主动播放，就视为完成重听步骤。
  // 旧版只改了 state，没有刷新左侧卡片，导致 Step 2 仍显示锁定，直到发生别的点击。
  if(firstReplayDecision && !state.reviewMode) requestAnimationFrame(()=>renderAnalysisPreserveScroll());
}
function pauseAnalysis(){ saveMaterialPosition(); audio.pause(); state.isPlaying=false; logEvent(state.reviewMode?'review_audio_pause':'analysis_audio_pause',{position:audio.currentTime}); refreshAnalysisTransport(); }
function toggleAnalysisPlayback(){ if(audio.paused) playAnalysis(); else pauseAnalysis(); }
function replayFromStart(){
  if(state.paused)return; const q=getQ(); ensureAnalysisAudio(q); const firstReplayDecision=!replayStepDone(q.materialId);
  if(audio.readyState<1){ audio.addEventListener('loadedmetadata',()=>replayFromStart(),{once:true}); return; }
  audio.pause(); clearSegment(); audio.currentTime=q.listenWindow[0]; state.materialPositions[q.materialId]=q.listenWindow[0];
  if(!state.reviewMode){
    state.replayDecision[q.materialId]='played';
    state.materialReplayCount[q.materialId]=(state.materialReplayCount[q.materialId]||0)+1;
  }
  state.isPlaying=true; attachAnalysisTracking(q); logEvent(state.reviewMode?'review_audio_restart':'analysis_audio_restart');
  audio.play().catch(()=>{}); refreshAnalysisTransport(q);
  if(firstReplayDecision && !state.reviewMode) requestAnimationFrame(()=>renderAnalysisPreserveScroll());
}
function setAnalysisSeekValue(v,{log=false}={}){ if(state.paused)return; const q=getQ(); ensureAnalysisAudio(q); if(audio.readyState<1){ audio.addEventListener('loadedmetadata',()=>setAnalysisSeekValue(v,{log}),{once:true}); return; } const old=audio.currentTime; const nv=Math.min(q.listenWindow[1],Math.max(q.listenWindow[0],Number(v))); audio.currentTime=nv; state.materialPositions[q.materialId]=nv; if(log)logEvent(state.reviewMode?'review_audio_seek':'analysis_audio_seek',{from:old,to:nv}); refreshAnalysisTransport(q); }
function previewAnalysisSeek(v){ setAnalysisSeekValue(v,{log:false}); }
function commitAnalysisSeek(v){ setAnalysisSeekValue(v,{log:true}); }
function seekAnalysis(v){ commitAnalysisSeek(v); }
function skipReplay(){ const q=getQ(); state.replayDecision[q.materialId]='skipped'; logEvent('analysis_replay_skip'); renderAnalysisPreserveScroll(); }
function refreshAnalysisTransport(q=getQ()){
  if(state.view!=='analysis') return; const pos=analysisPos(q),[a,b]=q.listenWindow;
  const slider=document.getElementById('analysisSeek'); if(slider){ slider.min=a;slider.max=b;slider.value=pos; }
  const txt=document.getElementById('analysisTime'); if(txt) txt.textContent=`${fmtShort(pos-a)} / ${fmtShort(b-a)}`;
  const p=document.getElementById('analysisPlayBtn'); if(p) p.textContent=audio.paused?'▶ Play':'⏸ Pause';highlightTranscriptWord(pos);
}

// ---------- Analysis requirements ----------
function replayStepDone(mid){ return ['played','skipped'].includes(state.replayDecision[mid]); }
function bestCoreDone(q){ const d=functionInfo(q.id); return !!d.functionTag && !!d.keyMeaning.trim(); }
function mapDone(mid){ const m=mapInfo(mid); const topicOk=m.topicDontKnow||!!m.topic.trim(); const mainOk=m.mainDontKnow||(!!m.main1.trim()&&!!m.main2.trim()); return topicOk&&mainOk; }
function hasEvidence(qid){ const e=state.evidence[qid]; return !!e && (e.type==='point'||(e.type==='range'&&Number.isFinite(e.start)&&Number.isFinite(e.end))); }

// ---------- Single Talk Lab ----------
function talkLabState(){
  state.talkLab=state.talkLab||{};
  state.talkLab.mode=state.talkLab.mode==='practice'?'practice':'assignment';
  state.talkLab.vocab=state.talkLab.vocab||{};
  state.talkLab.frameworkBefore=state.talkLab.frameworkBefore||{};
  state.talkLab.frameworkAfter=state.talkLab.frameworkAfter||{};
  state.talkLab.frameworkIssues=state.talkLab.frameworkIssues||{};
  state.talkLab.questionNotes=state.talkLab.questionNotes||{};
  state.talkLab.directTranscriptSkip=state.talkLab.directTranscriptSkip||{};
  state.talkLab.postUnchanged=state.talkLab.postUnchanged||{};
  return state.talkLab;
}
function talkRunMode(){ return talkLabState().mode; }
function isTalkPracticeMode(){ return talkRunMode()==='practice'; }
function talkDirectSkip(mid=getQ()?.materialId){ return !!(mid&&talkLabState().directTranscriptSkip[mid]); }
function talkPostUnchanged(mid=getQ()?.materialId){ return !!(mid&&talkLabState().postUnchanged[mid]); }
function talkVocab(mid){ const t=talkLabState(); return t.vocab[mid]||(t.vocab[mid]={none:false,markers:[]}); }
function newFrameworkPoint(text='',time=null){ return {id:`mp${Date.now()}${Math.floor(Math.random()*100000)}`,text:String(text||''),time:Number.isFinite(time)?time:null}; }
function normalizeFrameworkPoints(points,fallback=[]){
  let arr=Array.isArray(points)?points.map(x=>({id:x?.id||`mp${Date.now()}${Math.floor(Math.random()*100000)}`,text:String(x?.text??''),time:Number.isFinite(x?.time)?x.time:null})):[];
  if(!arr.length) arr=fallback.filter(x=>String(x||'').trim()).map(x=>newFrameworkPoint(x));
  if(!arr.length) arr=[newFrameworkPoint(),newFrameworkPoint()];
  return arr.slice(0,6);
}
function talkFrameworkBefore(mid){
  const t=talkLabState();
  if(!t.frameworkBefore[mid]){
    const legacy=mapInfo(mid);
    t.frameworkBefore[mid]={topic:legacy.topic||'',topicDontKnow:!!legacy.topicDontKnow,mainDontKnow:!!legacy.mainDontKnow,mainPoints:normalizeFrameworkPoints(null,[legacy.main1,legacy.main2,legacy.main3])};
  }
  const f=t.frameworkBefore[mid];
  f.mainPoints=normalizeFrameworkPoints(f.mainPoints);
  return f;
}
function talkFrameworkAfter(mid){
  const t=talkLabState();
  if(!t.frameworkAfter[mid]){
    const before=talkFrameworkBefore(mid);
    t.frameworkAfter[mid]={topic:'',mainPoints:Array.from({length:Math.max(2,before.mainPoints.length)},()=>newFrameworkPoint())};
  }
  const f=t.frameworkAfter[mid];
  if(!Array.isArray(f.mainPoints)) f.mainPoints=normalizeFrameworkPoints(null,[f.main1,f.main2,f.main3]);
  else f.mainPoints=normalizeFrameworkPoints(f.mainPoints);
  return f;
}
function talkFrameworkIssues(mid){ const t=talkLabState(); return t.frameworkIssues[mid]||(t.frameworkIssues[mid]={accurate:false,selected:[],note:''}); }
function talkQuestionNote(qid){ const t=talkLabState(); return t.questionNotes[qid]||(t.questionNotes[qid]={note:''}); }
function talkFrameworkStage(stage,mid=getQ().materialId){ return stage==='after'?talkFrameworkAfter(mid):talkFrameworkBefore(mid); }
function talkFrameworkBeforeDone(mid){ const f=talkFrameworkBefore(mid); const topicOk=f.topicDontKnow||!!String(f.topic||'').trim(); const mainOk=f.mainDontKnow||f.mainPoints.some(x=>String(x.text||'').trim()); return topicOk&&mainOk; }
function setTalkFrameworkTopic(stage,value){ const f=talkFrameworkStage(stage); if(stage==='before'&&state.transcriptViewed[getQ().materialId])return; f.topic=value; if(stage==='before'&&value)f.topicDontKnow=false; persist(); }
function toggleTalkFrameworkDontKnow(kind){ const mid=getQ().materialId; if(state.transcriptViewed[mid])return; const f=talkFrameworkBefore(mid); if(kind==='topic'){f.topicDontKnow=!f.topicDontKnow;if(f.topicDontKnow)f.topic='';}else{f.mainDontKnow=!f.mainDontKnow;if(f.mainDontKnow)f.mainPoints.forEach(x=>{x.text='';x.time=null;});} logEvent('talk_framework_dont_know',{kind,value:kind==='topic'?f.topicDontKnow:f.mainDontKnow}); renderAnalysisPreserveScroll(); }
function addTalkFrameworkPoint(stage){ const f=talkFrameworkStage(stage); if(stage==='before'&&state.transcriptViewed[getQ().materialId])return; if(f.mainPoints.length>=6)return; f.mainPoints.push(newFrameworkPoint()); logEvent('talk_framework_point_add',{stage,count:f.mainPoints.length}); renderAnalysisPreserveScroll(); }
function removeTalkFrameworkPoint(stage,id){ const f=talkFrameworkStage(stage); if(stage==='before'&&state.transcriptViewed[getQ().materialId])return; if(f.mainPoints.length<=1)return; f.mainPoints=f.mainPoints.filter(x=>x.id!==id); logEvent('talk_framework_point_remove',{stage,id,count:f.mainPoints.length}); renderAnalysisPreserveScroll(); }
function updateTalkFrameworkPoint(stage,id,value){ const f=talkFrameworkStage(stage),pt=f.mainPoints.find(x=>x.id===id); if(!pt)return; if(stage==='before'&&state.transcriptViewed[getQ().materialId])return; pt.text=value; if(stage==='before'&&value)f.mainDontKnow=false; persist(); }
function markTalkFrameworkTime(stage,id){ const q=getQ(),f=talkFrameworkStage(stage),pt=f.mainPoints.find(x=>x.id===id); if(!pt)return; if(stage==='before'&&state.transcriptViewed[q.materialId])return; pt.time=analysisPos(q); logEvent('talk_framework_time_mark',{stage,id,time:pt.time}); renderAnalysisPreserveScroll(); }
function clearTalkFrameworkTime(stage,id){ const f=talkFrameworkStage(stage),pt=f.mainPoints.find(x=>x.id===id); if(!pt)return; if(stage==='before'&&state.transcriptViewed[getQ().materialId])return; pt.time=null; logEvent('talk_framework_time_clear',{stage,id}); renderAnalysisPreserveScroll(); }
function seekTalkFrameworkTime(stage,id){ const q=getQ(),pt=talkFrameworkStage(stage).mainPoints.find(x=>x.id===id); if(!pt||!Number.isFinite(pt.time))return; ensureAnalysisAudio(q); audio.pause(); state.isPlaying=false; setAnalysisSeekValue(pt.time,{log:true}); }
function frameworkPointRows(stage,q,f,disabled=false){
  return f.mainPoints.map((pt,i)=>`<div class="framework-point-row"><div class="framework-point-time">${Number.isFinite(pt.time)?`<button class="tag time-tag" onclick="seekTalkFrameworkTime('${stage}','${pt.id}')">${fmtShort(relTime(q,pt.time))}</button><button class="icon-mini" ${disabled?'disabled':''} onclick="clearTalkFrameworkTime('${stage}','${pt.id}')" title="清除时间点">×</button>`:`<button class="btn secondary mini-btn" ${disabled?'disabled':''} onclick="markTalkFrameworkTime('${stage}','${pt.id}')">＋ 时间点</button>`}</div><input class="text-input" ${disabled?'disabled':''} value="${escapeHtml(pt.text||'')}" placeholder="Main Point ${i+1}" oninput="updateTalkFrameworkPoint('${stage}','${pt.id}',this.value)"><button class="btn secondary mini-btn" ${disabled||f.mainPoints.length<=1?'disabled':''} onclick="removeTalkFrameworkPoint('${stage}','${pt.id}')">删除</button></div>`).join('');
}
function addTalkVocabMarker(){ if(!isSingleTalkMode()||state.transcriptViewed[getQ().materialId])return; const q=getQ(),v=talkVocab(q.materialId); v.none=false; v.markers.push({id:`v${Date.now()}${Math.floor(Math.random()*1000)}`,time:analysisPos(q),heard:'',corrected:'',meaning:'',note:''}); logEvent('talk_vocab_marker_add',{time:analysisPos(q)}); renderAnalysisPreserveScroll(); }
function updateTalkVocabMarker(id,field,value){ const v=talkVocab(getQ().materialId),m=v.markers.find(x=>x.id===id); if(!m)return; m[field]=value; persist(); }
function removeTalkVocabMarker(id){ const v=talkVocab(getQ().materialId); v.markers=v.markers.filter(x=>x.id!==id); logEvent('talk_vocab_marker_remove',{id}); renderAnalysisPreserveScroll(); }
function toggleTalkNoVocab(){ const v=talkVocab(getQ().materialId); v.none=!v.none; if(v.none)v.markers=[]; logEvent('talk_vocab_none',{value:v.none}); renderAnalysisPreserveScroll(); }
function seekTalkMarker(id){ const q=getQ(),m=talkVocab(q.materialId).markers.find(x=>x.id===id); if(!m)return; ensureAnalysisAudio(q); audio.pause(); state.isPlaying=false; setAnalysisSeekValue(m.time,{log:true}); }
function talkVocabPreDone(mid){ const v=talkVocab(mid); return v.none || (v.markers.length>0 && v.markers.every(m=>String(m.heard||'').trim())); }
function talkVocabAfterDone(mid){ const v=talkVocab(mid); return v.none || (v.markers.length>0 && v.markers.every(m=>String(m.corrected||'').trim()&&String(m.meaning||'').trim())); }
function talkQuestionsPreDone(mid){ return materialQuestions(mid).every(q=>!!state.secondAnswers[q.id]&&hasEvidence(q.id)); }
function talkPreDone(mid){ return talkVocabPreDone(mid)&&talkFrameworkBeforeDone(mid)&&talkQuestionsPreDone(mid); }
function talkFrameworkAfterDone(mid){ const f=talkFrameworkAfter(mid),i=talkFrameworkIssues(mid); const structure=String(f.topic||'').trim()&&f.mainPoints.some(x=>String(x.text||'').trim()); const issueDone=i.accurate||i.selected.length>0||String(i.note||'').trim(); return !!(structure&&issueDone); }
function talkPostDone(mid){ return materialQuestions(mid).every(q=>!!state.postTranscriptAnswers[q.id]); }
function talkLabComplete(){ const mid=getQ()?.materialId||MATERIAL_SEQUENCE[0]; if(!mid||talkDirectSkip(mid))return false; return talkPreDone(mid)&&!!state.transcriptViewed[mid]&&talkVocabAfterDone(mid)&&talkFrameworkAfterDone(mid)&&talkPostDone(mid); }
function talkChooseSecond(letter){ if(state.paused||state.transcriptViewed[getQ().materialId])return; state.secondAnswers[getQ().id]=letter; logEvent('talk_second_answer',{answer:letter}); renderAnalysisPreserveScroll(); }
function talkSetPointEvidence(){ const q=getQ(); if(state.transcriptViewed[q.materialId]||!state.secondAnswers[q.id])return; const pos=analysisPos(q); state.evidence[q.id]={type:'point',point:pos}; delete state.evidenceDraft[q.id]; logEvent('talk_evidence_point',{position:pos}); renderAnalysisPreserveScroll(); }
function talkStartRangeEvidence(){ const q=getQ(); if(state.transcriptViewed[q.materialId]||!state.secondAnswers[q.id])return; state.evidenceDraft[q.id]={start:analysisPos(q)}; delete state.evidence[q.id]; logEvent('talk_evidence_range_start',{position:analysisPos(q)}); renderAnalysisPreserveScroll(); }
function talkEndRangeEvidence(){ const q=getQ(),d=state.evidenceDraft[q.id]; if(state.transcriptViewed[q.materialId]||!d||!Number.isFinite(d.start))return; const p=analysisPos(q),a=Math.min(d.start,p),b=Math.max(d.start,p); state.evidence[q.id]={type:'range',start:a,end:b}; delete state.evidenceDraft[q.id]; logEvent('talk_evidence_range_end',{start:a,end:b}); renderAnalysisPreserveScroll(); }
function talkClearEvidence(){ const q=getQ(); if(state.transcriptViewed[q.materialId])return; delete state.evidence[q.id]; delete state.evidenceDraft[q.id]; renderAnalysisPreserveScroll(); }
function openTalkTranscript(){ const mid=getQ().materialId; if(!talkPreDone(mid))return; state.transcriptViewed[mid]=true; state.transcriptShown[mid]=true; logEvent('talk_transcript_open',{materialId:mid}); renderAnalysisPreserveScroll(); }
function setTalkFrameworkAfter(field,value){ setTalkFrameworkTopic('after',value); }
const TALK_FRAMEWORK_ISSUES=[['topic','Topic 判断偏了'],['main_omission','漏掉主要分点'],['detail_as_main','把细节当成了 Main Point'],['main_fragmented','Main Points 分得太碎'],['main_merged','合并了本应分开的 Main Points'],['relation','分点之间关系理解错'],['sequence','顺序 / 发展逻辑理解错']];
function toggleTalkFrameworkIssue(code){ const i=talkFrameworkIssues(getQ().materialId); i.accurate=false; const n=i.selected.indexOf(code); if(n>=0)i.selected.splice(n,1);else i.selected.push(code); renderAnalysisPreserveScroll(); }
function toggleTalkFrameworkAccurate(){ const i=talkFrameworkIssues(getQ().materialId); i.accurate=!i.accurate; if(i.accurate)i.selected=[]; renderAnalysisPreserveScroll(); }
function setTalkFrameworkIssueNote(v){ talkFrameworkIssues(getQ().materialId).note=v; persist(); }
function setTalkQuestionNote(v){ talkQuestionNote(getQ().id).note=v; persist(); }
function talkChoosePost(letter){ const mid=getQ().materialId; if(!state.transcriptViewed[mid]||talkDirectSkip(mid))return; state.postTranscriptAnswers[getQ().id]=letter; talkLabState().postUnchanged[mid]=false; logEvent('talk_post_answer',{answer:letter}); renderAnalysisPreserveScroll(); }
function confirmTalkPostUnchanged(){ const mid=getQ().materialId,qs=materialQuestions(mid); if(!state.transcriptViewed[mid]||talkDirectSkip(mid)||qs.some(q=>!state.secondAnswers[q.id]))return; qs.forEach(q=>state.postTranscriptAnswers[q.id]=state.secondAnswers[q.id]); talkLabState().postUnchanged[mid]=true; logEvent('talk_post_answers_unchanged',{questions:qs.length}); renderAnalysisPreserveScroll(); }
function skipTalkToTranscript(){ const mid=getQ().materialId; if(!isTalkPracticeMode()||state.transcriptViewed[mid])return; talkLabState().directTranscriptSkip[mid]=true; state.transcriptViewed[mid]=true; state.transcriptShown[mid]=true; logEvent('talk_direct_transcript_skip',{materialId:mid}); renderAnalysisPreserveScroll(); }
function talkQuestionDiagnosis(q){ const a=state.firstAnswers[q.id],b=state.secondAnswers[q.id],c=state.postTranscriptAnswers[q.id],ans=q.answer; if(c===ans&&b===ans&&a===ans)return '三次判断一致，题目分析稳定'; if(a===ans&&b!==ans&&c===ans)return '分析过程中曾改错：需要检查证据是否被过度解读'; if(a!==ans&&b===ans)return '重听/证据定位后修正：一遍听时判断不稳'; if(b!==ans&&c===ans)return '看到文本后修正：听力或语言理解仍有偏差'; if(c!==ans)return '文本后仍错：重点检查题干理解、Evidence 与选项比较'; return '答案路径有变化，建议复盘证据与选项比较'; }
function talkEvidenceTargetTime(e,part='point'){
  if(!e)return null;
  if(e.type==='point')return e.point;
  if(e.type==='range')return part==='end'?e.end:e.start;
  return null;
}
function seekTalkQuestionEvidence(qid,part='point'){
  const i=qIndex(qid); if(i<0)return;
  if(getQ()?.id!==qid){ saveMaterialPosition(); audio.pause(); state.isPlaying=false; clearSegment(); state.idx=i; renderAnalysis(); requestAnimationFrame(()=>seekTalkQuestionEvidence(qid,part)); return; }
  const q=getQ(),t=talkEvidenceTargetTime(state.evidence[qid],part); if(!Number.isFinite(t))return;
  ensureAnalysisAudio(q); audio.pause(); state.isPlaying=false; setAnalysisSeekValue(t,{log:true});
}
function talkEvidenceInteractive(q,e){
  if(!e)return '<span class="muted">尚未定位</span>';
  if(e.type==='point')return `<button class="marker-chip" onclick="seekTalkQuestionEvidence('${q.id}','point')">● ${fmtShort(relTime(q,e.point))} · 点击回听</button>`;
  return `<span class="talk-evidence-range"><button class="marker-chip" onclick="seekTalkQuestionEvidence('${q.id}','start')">起点 ${fmtShort(relTime(q,e.start))}</button><span>→</span><button class="marker-chip" onclick="seekTalkQuestionEvidence('${q.id}','end')">终点 ${fmtShort(relTime(q,e.end))}</button></span>`;
}
function talkQuestionOverview(qs){
  return `<section class="talk-question-overview"><div class="talk-overview-head"><div><h3>全部题目回看</h3><p>用于课堂讲解和横向比较。这里不会提前显示正确答案。</p></div></div>${qs.map(x=>{const cur=x.id===getQ().id,e=state.evidence[x.id],note=talkQuestionNote(x.id).note;return `<details class="talk-overview-item ${cur?'current':''}" ${cur?'open':''}><summary><span><b>${questionLabel(x)}</b> · ${escapeHtml(x.stem)}</span><span class="talk-overview-path">${state.firstAnswers[x.id]||'—'} → ${state.secondAnswers[x.id]||'—'} → ${state.postTranscriptAnswers[x.id]||'—'}</span></summary><div class="talk-overview-body"><div class="talk-overview-options">${x.options.map((o,i)=>`<div><b>${letters[i]}.</b> ${escapeHtml(o)}</div>`).join('')}</div><div class="talk-overview-meta"><span><b>Evidence：</b>${talkEvidenceInteractive(x,e)}</span>${note?`<span><b>文本后记录：</b>${escapeHtml(note)}</span>`:''}</div><button class="btn secondary mini-btn" onclick="jump(${qIndex(x.id)})">切换到此题分析</button></div></details>`}).join('')}</section>`;
}
function jumpTalkLabIssue(target,qid=''){
  state.talkAuditOpen=false;
  if(qid){ const i=qIndex(qid); if(i>=0){ saveMaterialPosition(); audio.pause(); state.isPlaying=false; clearSegment(); state.idx=i; } }
  renderAnalysis();
  requestAnimationFrame(()=>{ const el=document.querySelector(`[data-talk-target="${target}"]`); if(!el)return; el.scrollIntoView({behavior:'smooth',block:'center'}); el.classList.add('audit-target-flash'); setTimeout(()=>el.classList.remove('audit-target-flash'),1400); });
}
function startReviewAtTime(qid,time){ startReview(qid); requestAnimationFrame(()=>{ if(Number.isFinite(Number(time)))setAnalysisSeekValue(Number(time),{log:true}); }); }
function startReviewAtEvidence(qid){ const e=state.evidence[qid],t=talkEvidenceTargetTime(e,'start'); startReview(qid); requestAnimationFrame(()=>{ if(Number.isFinite(t))setAnalysisSeekValue(t,{log:true}); }); }
function talkVocabularyCard(q){ const mid=q.materialId,v=talkVocab(mid),viewed=!!state.transcriptViewed[mid],direct=talkDirectSkip(mid); const rows=v.markers.map((m,i)=>`<div class="talk-vocab-row"><div class="talk-vocab-time"><button class="tag" onclick="seekTalkMarker('${m.id}')">${fmtShort(relTime(q,m.time))}</button><span>#${i+1}</span></div><input class="text-input" ${viewed?'disabled':''} placeholder="听到/猜到的声音或词形（拼不出也可以）" value="${escapeHtml(m.heard||'')}" oninput="updateTalkVocabMarker('${m.id}','heard',this.value)">${viewed&&!direct?`<input class="text-input" placeholder="Transcript 中的实际词/短语" value="${escapeHtml(m.corrected||'')}" oninput="updateTalkVocabMarker('${m.id}','corrected',this.value)"><input class="text-input" placeholder="意思 / 为什么当时没反应出来" value="${escapeHtml(m.meaning||'')}" oninput="updateTalkVocabMarker('${m.id}','meaning',this.value)">`:''}<button class="btn secondary mini-btn" ${viewed?'disabled':''} onclick="removeTalkVocabMarker('${m.id}')">删除</button></div>`).join(''); return `<div class="toolcard" data-talk-target="vocab"><div class="step-title"><span class="step-num">1</span><h3>定位听不懂的词汇 / 短语</h3>${talkVocabPreDone(mid)?'<span class="done-badge">✓ 文本前定位完成</span>':''}</div><p class="muted small">重听时拖动到听不懂的位置，点击“标记当前时间”。先记录你听到/猜到的声音，不要急着看文本。时间点用于回听，输入内容才是诊断记录。</p><div class="step-actions"><button class="btn secondary" ${viewed?'disabled':''} onclick="addTalkVocabMarker()">＋ 标记当前时间</button><button class="btn ${v.none?'':'secondary'}" ${viewed?'disabled':''} onclick="toggleTalkNoVocab()">${v.none?'✓ 本篇没有明显词汇盲点':'本篇没有明显词汇盲点'}</button></div>${rows||'<div class="empty-mini">尚未标记词汇点。</div>'}${viewed&&!v.none&&!direct?'<div class="require-note">看过 Transcript 后，请补上每个标记点的实际词/短语和意思。</div>':''}${direct?'<div class="free-review-note">自主练习已直接查看文本：本次不要求补齐词汇诊断字段。</div>':''}</div>`; }
function talkFrameworkBeforeCard(q){
  const mid=q.materialId,f=talkFrameworkBefore(mid),frozen=!!state.transcriptViewed[mid],done=talkFrameworkBeforeDone(mid);
  const rows=frameworkPointRows('before',q,f,frozen||f.mainDontKnow);
  return `<div class="toolcard" data-talk-target="framework-before"><div class="step-title"><span class="step-num">2</span><h3>框架理解 · 文本前</h3>${done?'<span class="done-badge">✓ 已记录</span>':''}</div><p class="muted small">先用自己的话写 Topic 和 Main Points。Main Points 不限定为 3 个：默认 2 个，可自由增删（最多 6 个）。<b>时间点是可选项</b>，建议标记每个 Main Point 开始或发生转折的位置，方便之后检查框架从哪里开始理解偏了。</p><label class="field-label">Topic</label><div class="field-with-action"><input class="text-input" ${f.topicDontKnow||frozen?'disabled':''} value="${escapeHtml(f.topic||'')}" placeholder="这篇讲座主要讲什么？" oninput="setTalkFrameworkTopic('before',this.value)"><button class="btn ${f.topicDontKnow?'':'secondary'}" ${frozen?'disabled':''} onclick="toggleTalkFrameworkDontKnow('topic')">${f.topicDontKnow?'✓ 我不知道':'我不知道'}</button></div><label class="field-label">Main Points</label><div class="framework-points">${rows}</div><div class="step-actions"><button class="btn secondary" ${frozen||f.mainDontKnow||f.mainPoints.length>=6?'disabled':''} onclick="addTalkFrameworkPoint('before')">＋ 增加 Main Point</button><button class="btn ${f.mainDontKnow?'':'secondary'}" ${frozen?'disabled':''} onclick="toggleTalkFrameworkDontKnow('main')">${f.mainDontKnow?'✓ Main Points 我不知道':'Main Points 我不知道'}</button></div><div class="require-note">至少写 1 个 Main Point，或明确选择“我不知道”。时间点不影响完成状态。</div></div>`;
}
function talkQuestionCard(q){ const frozen=!!state.transcriptViewed[q.materialId],second=state.secondAnswers[q.id]||'',e=state.evidence[q.id],draft=state.evidenceDraft[q.id]; return `<div class="toolcard talk-question-card" data-talk-target="question-${q.id}"><div class="step-title"><span class="step-num">3</span><h3>题目分析 · ${questionLabel(q)}</h3>${second&&e?'<span class="done-badge">✓ 已完成</span>':''}</div><div class="mini-stem talk-question-stem">${q.stem}</div><div class="talk-first-answer">第一遍答案 <b>${state.firstAnswers[q.id]||'—'}</b></div><div class="options compact-options talk-analysis-options">${q.options.map((o,i)=>`<div class="option ${second===letters[i]?'selected':''} ${frozen?'disabled-option':''}" ${frozen?'':`onclick="talkChooseSecond('${letters[i]}')"`}><span class="radio"></span><span class="talk-option-text"><b>${letters[i]}.</b> ${o}</span></div>`).join('')}</div><div class="substep ${second?'':'locked-substep'}"><h4>Evidence · 答案依据</h4>${second?`<div class="step-actions"><button class="btn secondary" onclick="talkSetPointEvidence()">标记当前点</button><button class="btn secondary" onclick="talkStartRangeEvidence()">区间开始</button><button class="btn secondary" ${!draft?'disabled':''} onclick="talkEndRangeEvidence()">区间结束</button><button class="btn secondary" ${!e?'disabled':''} onclick="talkClearEvidence()">清除</button></div><div class="evidence-readout">${e?talkEvidenceInteractive(q,e):draft?`区间开始：<button class="marker-chip" onclick="setAnalysisSeekValue(${draft.start},{log:true})">${fmtShort(relTime(q,draft.start))}</button>`:'尚未定位'}</div>`:'<div class="lock-note">🔒 先完成第二次选择。</div>'}</div>${frozen&&!talkDirectSkip(q.materialId)?`<div class="substep"><h4>看文本后 · 题目分析卡点</h4><textarea class="note-input" placeholder="例如：证据位置找错 / 题干理解偏了 / 两个选项比较不清楚…" oninput="setTalkQuestionNote(this.value)">${escapeHtml(talkQuestionNote(q.id).note||'')}</textarea></div>`:''}</div>`; }
function talkTranscriptCard(q){ const mid=q.materialId,ready=talkPreDone(mid),viewed=!!state.transcriptViewed[mid],shown=!!state.transcriptShown[mid],practice=isTalkPracticeMode(),direct=talkDirectSkip(mid); return `<div class="toolcard ${ready||practice?'':'locked-card'}" data-talk-target="transcript"><div class="step-title"><span class="step-num">4</span><h3>Transcript · 对照检查</h3>${viewed?`<span class="done-badge">${direct?'✓ 自由查看':'✓ 已解锁'}</span>`:''}</div>${!viewed?(ready?'<button class="btn" onclick="openTalkTranscript()">解锁 Transcript</button>':practice?'<div class="practice-skip-box"><p>自主练习模式允许你不完成诊断流程，直接查看文本。</p><button class="btn secondary" onclick="skipTalkToTranscript()">跳过分析 · 直接看 Transcript</button><span>不生成完整诊断报告，但可以单独核对答案。</span></div>':'<div class="lock-note">🔒 先完成词汇定位、文本前框架和全部题目的二次选择 + Evidence。</div>'):`<button class="btn secondary" onclick="toggleTranscriptVisibility()">${shown?'收起 Transcript':'再次查看 Transcript'}</button>${shown?`<div class="transcript">${transcriptWordHtml(q)}</div>`:''}${direct?'<div class="free-review-note"><b>自主练习 · 自由查看</b>：你跳过了完整分析，本次可核对答案、查文本和回听；如需完整诊断结果，请退出后选择“作业 / 完整分析”。</div>':''}`}</div>`; }
function talkFrameworkAfterCard(q){
  if(!state.transcriptViewed[q.materialId]||talkDirectSkip(q.materialId))return '';
  const mid=q.materialId,f=talkFrameworkAfter(mid),i=talkFrameworkIssues(mid),rows=frameworkPointRows('after',q,f,false);
  return `<div class="toolcard" data-talk-target="framework-after"><div class="step-title"><span class="step-num">5</span><h3>框架修正 · 看文本后</h3>${talkFrameworkAfterDone(mid)?'<span class="done-badge">✓ 已完成</span>':''}</div><p class="muted small">重新写一次框架。Main Points 可自由增删；时间点仍然是<b>可选</b>，用于把“文本前理解的结构”与“校正后的结构”直接对照。</p><input class="text-input" placeholder="修正后的 Topic" value="${escapeHtml(f.topic||'')}" oninput="setTalkFrameworkTopic('after',this.value)"><label class="field-label">修正后的 Main Points</label><div class="framework-points">${rows}</div><div class="step-actions"><button class="btn secondary" ${f.mainPoints.length>=6?'disabled':''} onclick="addTalkFrameworkPoint('after')">＋ 增加 Main Point</button></div><div class="tag-row talk-framework-tags"><button class="tag ${i.accurate?'active':''}" onclick="toggleTalkFrameworkAccurate()">原框架基本准确</button>${TALK_FRAMEWORK_ISSUES.map(([c,l])=>`<button class="tag ${i.selected.includes(c)?'active':''}" onclick="toggleTalkFrameworkIssue('${c}')">${l}</button>`).join('')}</div><textarea class="note-input" placeholder="可补充：具体在哪个时间点 / 哪一句开始理解偏了？" oninput="setTalkFrameworkIssueNote(this.value)">${escapeHtml(i.note||'')}</textarea></div>`;
}
function talkPostCard(q){ if(!state.transcriptViewed[q.materialId]||talkDirectSkip(q.materialId))return ''; const mid=q.materialId,post=state.postTranscriptAnswers[q.id]||'',qs=materialQuestions(mid),canAll=qs.every(x=>!!state.secondAnswers[x.id]),allConfirmed=talkPostUnchanged(mid); return `<div class="toolcard" data-talk-target="post-${q.id}"><div class="step-title"><span class="step-num">6</span><h3>文本后再次作答 · ${questionLabel(q)}</h3>${post?'<span class="done-badge">✓ 已完成</span>':''}</div>${canAll?`<div class="post-unchanged-box"><button class="btn ${allConfirmed?'':'secondary'}" onclick="confirmTalkPostUnchanged()">${allConfirmed?'✓ 已确认：全部理解，答案无需修改':'✓ 全部理解，所有题目答案都不用改'}</button><span>一键沿用全部 Second Answer，避免重复点击。</span></div>`:''}<div class="options compact-options">${q.options.map((o,i)=>`<div class="option ${post===letters[i]?'selected':''}" onclick="talkChoosePost('${letters[i]}')"><span class="radio"></span><span><b>${letters[i]}.</b> ${o}</span></div>`).join('')}</div></div>`; }
function renderSingleTalkAnalysis(){ const q=getQ(); ensureAnalysisAudio(q); const mid=q.materialId,pos=analysisPos(q),[a,b]=q.listenWindow,all=talkLabComplete(),direct=talkDirectSkip(mid),mode=talkRunMode(); const qs=materialQuestions(mid); app.innerHTML=`<div class="analysis-shell talk-lab-shell"><header class="analysis-head"><button class="btn secondary" onclick="confirmExitSession()">← Exit</button><b>单篇讲座精练 · ${materialLabel(q)}</b><span class="talk-mode-chip ${mode}">${mode==='assignment'?'作业 / 完整分析':'自主练习'}</span><div class="analysis-transport"><button id="analysisPlayBtn" class="btn secondary transport-play-btn" onclick="toggleAnalysisPlayback()">${audio.paused?'▶ Play':'⏸ Pause'}</button><button class="btn secondary transport-restart-btn" onclick="replayFromStart()">↺ From start</button><input id="analysisSeek" class="seek-slider" type="range" min="${a}" max="${b}" step="0.01" value="${pos}" oninput="previewAnalysisSeek(this.value)" onchange="commitAnalysisSeek(this.value)"><span id="analysisTime" class="seek-time">${fmtShort(pos-a)} / ${fmtShort(b-a)}</span></div><div class="volume-group compact"><span>Volume</span><input type="range" min="0" max="1" step="0.01" value="${audio.volume}" oninput="setVolume(this.value)"></div><button class="btn pause-btn" onclick="pauseSession()">⏸ Pause Session</button>${mode==='practice'?`<button class="btn" onclick="showTalkPracticeAnswers()">${state.practiceAnswersVisible?'✓ 已显示答案':'核对答案'}</button>`:direct?'<button class="btn secondary" disabled>自由查看 · 无完整 Results</button>':`<button class="btn ${all?'':'locked-results-btn'}" onclick="${all?'revealResults()':'showTalkLabAudit()'}">${all?'Reveal Results':'Results Locked · 查看缺项'}</button>`}</header><div class="analysis-grid"><section class="analysis-tools">${mode==='practice'?talkPracticeAnswerPanel(qs):''}${talkVocabularyCard(q)}${talkFrameworkBeforeCard(q)}${talkQuestionCard(q)}${talkTranscriptCard(q)}${talkFrameworkAfterCard(q)}${talkPostCard(q)}${all?'<div class="material-complete"><b>✓ 单篇讲座分析完成</b><p>词汇、框架和题目三个维度都已完成，可以揭晓答案。</p><button class="btn" onclick="revealResults()">Reveal Results</button></div>':''}</section><section class="analysis-question"><div class="talk-focus-banner"><b>${mode==='assignment'?'完整分析':'自主练习'}</b><span>① 听不懂的词汇</span><span>② 框架理解偏差</span><span>③ 题目分析偏差</span></div><h2>${q.title}</h2><div class="stem">${q.stem}</div><div class="question-recall-card"><div class="recall-label">当前题回顾</div><div class="recall-options">${q.options.map((o,i)=>`<div class="recall-option ${state.firstAnswers[q.id]===letters[i]?'first-selected':''}"><span class="recall-letter">${letters[i]}.</span><span>${o}</span>${state.firstAnswers[q.id]===letters[i]?'<span class="first-tag">第一遍选择</span>':''}</div>`).join('')}</div></div><div class="answer-summary"><div><span>First</span><b>${state.firstAnswers[q.id]||'—'}</b></div><div><span>Second</span><b>${state.secondAnswers[q.id]||'—'}</b></div><div><span>After Transcript</span><b>${state.postTranscriptAnswers[q.id]||'—'}</b></div></div>${talkQuestionOverview(qs)}</section><aside class="qnav">${qs.map((x,i)=>`<button class="${x.id===q.id?'current':''} ${(state.secondAnswers[x.id]&&hasEvidence(x.id))?'predone':''} ${state.postTranscriptAnswers[x.id]?'done':''}" onclick="jump(${qIndex(x.id)})">${questionLabel(x)}${state.postTranscriptAnswers[x.id]?' ✓':(state.secondAnswers[x.id]&&hasEvidence(x.id))?' ◐':''}</button>`).join('')}</aside></div></div>`; if(state.talkAuditOpen&&!direct)renderTalkLabAudit(); if(state.paused)showPauseOverlay(); restoreAnalysisScroll(state.uiScroll); }
function talkLabIssueItems(){ const mid=getQ().materialId,issues=[]; if(talkDirectSkip(mid))return issues; if(!talkVocabPreDone(mid))issues.push({label:'词汇盲点：至少标记 1 个并写下听到/猜到的声音，或选择“没有明显词汇盲点”',target:'vocab'}); if(!talkFrameworkBeforeDone(mid))issues.push({label:'文本前框架：Topic + 至少 1 个 Main Point（或选择“我不知道”）',target:'framework-before'}); materialQuestions(mid).forEach(q=>{if(!state.secondAnswers[q.id])issues.push({label:`${questionLabel(q)}：第二次选择`,target:`question-${q.id}`,qid:q.id}); if(!hasEvidence(q.id))issues.push({label:`${questionLabel(q)}：Evidence`,target:`question-${q.id}`,qid:q.id});}); if(talkPreDone(mid)&&!state.transcriptViewed[mid])issues.push({label:'解锁并查看 Transcript',target:'transcript'}); if(state.transcriptViewed[mid]&&!talkVocabAfterDone(mid))issues.push({label:'词汇：补充实际词/短语和意思',target:'vocab'}); if(state.transcriptViewed[mid]&&!talkFrameworkAfterDone(mid))issues.push({label:'框架：完成文本后修正并标记偏差',target:'framework-after'}); if(state.transcriptViewed[mid])materialQuestions(mid).forEach(q=>{if(!state.postTranscriptAnswers[q.id])issues.push({label:`${questionLabel(q)}：文本后答案`,target:`post-${q.id}`,qid:q.id});}); return issues; }
function talkLabIssues(){ return talkLabIssueItems().map(x=>x.label); }
function showTalkLabAudit(){ if(talkDirectSkip(getQ().materialId))return; state.talkAuditOpen=true; renderAnalysisPreserveScroll(); }
function closeTalkLabAudit(){ state.talkAuditOpen=false; renderAnalysisPreserveScroll(); }
function renderTalkLabAudit(){ document.querySelector('.audit-overlay')?.remove(); const rows=talkLabIssueItems().map(x=>`<div class="audit-row actionable"><div><b>${x.label}</b></div><button class="btn secondary mini-btn" onclick="jumpTalkLabIssue('${x.target}','${x.qid||''}')">去完成 →</button></div>`).join(''); document.querySelector('.analysis-shell')?.insertAdjacentHTML('beforeend',`<div class="audit-overlay"><div class="audit-modal"><div class="audit-head"><div><h2>单篇讲座精练还没完成</h2><p>点击“去完成”可直接定位到缺失步骤。</p></div><button class="btn secondary" onclick="closeTalkLabAudit()">关闭</button></div><div class="audit-list">${rows||'<div class="audit-empty">没有发现缺项。</div>'}</div></div></div>`); }
function buildSingleTalkSummary(){
  const mid=MATERIAL_SEQUENCE[0],qs=moduleData.questions,v=talkVocab(mid),before=talkFrameworkBefore(mid),after=talkFrameworkAfter(mid),fi=talkFrameworkIssues(mid);
  const first=qs.filter(q=>state.firstAnswers[q.id]===q.answer).length,final=qs.filter(q=>state.postTranscriptAnswers[q.id]===q.answer).length,persistent=qs.filter(q=>state.postTranscriptAnswers[q.id]!==q.answer).length;
  const parts=[];
  parts.push(`这篇讲座第一遍答对 ${first}/${qs.length}，完成词汇、框架和题目分析后答对 ${final}/${qs.length}。${persistent?`仍有 ${persistent} 题需要继续复盘。`:'所有题目最终均已解决。'}`);
  parts.push(v.none?'词汇层面：你没有标记明显的听力词汇盲点。':`词汇层面：共定位 ${v.markers.length} 个听不懂/不确定的词汇点。重点回看这些位置，检查问题属于声音辨认、词义陌生还是音义反应慢。`);
  const beforeText=before.topicDontKnow?'Topic：不知道':`Topic：${before.topic||'—'}`, issueText=fi.accurate?'原框架基本准确':(fi.selected.map(c=>TALK_FRAMEWORK_ISSUES.find(x=>x[0]===c)?.[1]||c).join('、')||'已做框架修正');
  const beforeCount=before.mainDontKnow?0:before.mainPoints.filter(x=>String(x.text||'').trim()).length, afterCount=after.mainPoints.filter(x=>String(x.text||'').trim()).length, markedBefore=before.mainPoints.filter(x=>Number.isFinite(x.time)).length;
  parts.push(`框架层面：文本前 ${beforeText}，记录 ${beforeCount} 个 Main Point${markedBefore?`，其中 ${markedBefore} 个标记了时间点`:''}；看文本后整理为 ${afterCount} 个 Main Point。框架检查结果：${issueText}。`);
  const bad=qs.filter(q=>state.postTranscriptAnswers[q.id]!==q.answer||state.firstAnswers[q.id]!==q.answer);
  if(bad.length)parts.push(`题目层面：重点复盘 ${bad.map(q=>questionLabel(q)).join('、')}。不要只记正确选项，要确认题干要求、答案 Evidence 和错误选项为什么不成立。`); else parts.push('题目层面：本篇各题最终判断稳定，可以把练习重点转向一遍听时的速度与框架保持。');
  return parts;
}
function frameworkResultRows(q,f,{dontKnow=false}={}){
  if(dontKnow)return '<p><b>Main Points：</b>我不知道</p>';
  const pts=f.mainPoints.filter(x=>String(x.text||'').trim());
  if(!pts.length)return '<p><b>Main Points：</b>—</p>';
  return `<div class="framework-result-points">${pts.map((pt,i)=>`<div class="framework-result-point"><b>Main ${i+1}</b>${Number.isFinite(pt.time)?`<button class="time-badge time-link" onclick="startReviewAtTime('${q.id}',${pt.time})">${fmtShort(relTime(q,pt.time))}</button>`:'<span></span>'}<span>${escapeHtml(pt.text)}</span></div>`).join('')}</div>`;
}
function renderSingleTalkResults(){
  stopAudio({save:true}); state.paused=false; removePauseOverlay(); if(!state.resultsRevealed){state.view='analysis';renderAnalysis();return;}
  const mid=MATERIAL_SEQUENCE[0],qs=moduleData.questions,q0=qs[0],v=talkVocab(mid),before=talkFrameworkBefore(mid),after=talkFrameworkAfter(mid),fi=talkFrameworkIssues(mid),first=qs.filter(q=>state.firstAnswers[q.id]===q.answer).length,final=qs.filter(q=>state.postTranscriptAnswers[q.id]===q.answer).length;
  const vocabRows=v.none?'<p>本篇记录为：没有明显词汇盲点。</p>':v.markers.map((m,i)=>`<div class="talk-result-vocab"><button class="result-time-link" onclick="startReviewAtTime('${q0.id}',${m.time})"><b>${i+1}. ${fmtShort(relTime(q0,m.time))}</b></button><span>听到/猜到：${escapeHtml(m.heard||'—')}</span><span>实际：${escapeHtml(m.corrected||'—')}</span><span>意思/原因：${escapeHtml(m.meaning||'—')}</span></div>`).join('');
  const issues=fi.accurate?'原框架基本准确':fi.selected.map(c=>TALK_FRAMEWORK_ISSUES.find(x=>x[0]===c)?.[1]||c).join('、')||fi.note||'未标记';
  app.innerHTML=`<div class="topbar"><div class="brand">Listening Lab</div><div class="spacer"></div><button class="btn ghost" onclick="confirmExitSession()">返回本套题</button></div><main class="page"><div class="results talk-results"><h1>${moduleData.title}</h1><p class="muted">单篇讲座三维分析：词汇盲点 · 框架理解 · 题目分析。</p><div class="metric-grid"><div class="card metric"><div>First-pass</div><div class="value">${first}/${qs.length}</div></div><div class="card metric"><div>Final</div><div class="value">${final}/${qs.length}</div></div><div class="card metric"><div>词汇盲点</div><div class="value">${v.none?0:v.markers.length}</div></div><div class="card metric"><div>框架修正</div><div class="value">${fi.accurate?'稳定':'已检查'}</div></div></div><section class="card student-summary-card"><div class="summary-head"><div><h2>本篇总结</h2><p class="muted">把结果转化成下一次听讲座时可以执行的改进点。</p></div><div class="summary-actions"><button class="btn secondary" onclick="copyStudentSummary()">复制总结</button><button class="btn secondary" onclick="downloadSummaryTxt()">下载 TXT</button></div></div>${buildSingleTalkSummary().map(p=>`<p>${p}</p>`).join('')}</section><section class="card talk-result-section"><h2>1. 词汇盲点</h2>${vocabRows}</section><section class="card talk-result-section"><h2>2. 框架理解</h2><div class="framework-compare"><div><h3>文本前</h3><p><b>Topic：</b>${escapeHtml(before.topicDontKnow?'我不知道':before.topic||'—')}</p>${frameworkResultRows(q0,before,{dontKnow:before.mainDontKnow})}</div><div><h3>文本后</h3><p><b>Topic：</b>${escapeHtml(after.topic||'—')}</p>${frameworkResultRows(q0,after)}<p><b>偏差：</b>${escapeHtml(issues)}</p>${fi.note?`<p><b>补充：</b>${escapeHtml(fi.note)}</p>`:''}</div></div></section><section class="card result-list"><h2>3. 题目分析</h2>${qs.map(q=>{const ok=state.postTranscriptAnswers[q.id]===q.answer;return `<details class="result-item ${ok?'':'incorrect'}" data-qid="${q.id}"><summary><span><b>${questionLabel(q)}</b> · ${q.stem}</span><span class="result-answers">${state.firstAnswers[q.id]||'—'} → ${state.secondAnswers[q.id]||'—'} → ${state.postTranscriptAnswers[q.id]||'—'} · <b class="${ok?'ok':'bad'}">${q.answer}</b></span></summary><div class="result-detail"><p><b>诊断：</b>${talkQuestionDiagnosis(q)}</p><p><b>Evidence：</b>${state.evidence[q.id]?`<button class="result-time-link inline" onclick="startReviewAtEvidence('${q.id}')">${formatEvidenceForReview(q,state.evidence[q.id])} · 点击回听</button>`:'未记录'}</p>${talkQuestionNote(q.id).note?`<p><b>学生记录：</b>${escapeHtml(talkQuestionNote(q.id).note)}</p>`:''}<button class="btn ${ok?'secondary':''}" onclick="startReview('${q.id}')">进入 Post-result Review →</button></div></details>`}).join('')}</section><div class="result-actions"><button class="btn" onclick="downloadJSON()">Export Full Diagnostic JSON</button></div></div></main>`;
  if(state.restoreResultsUiOnRender){ state.restoreResultsUiOnRender=false; requestAnimationFrame(()=>{restoreResultsUi();persist();}); }
}
function errorDone(qid){ return ['confirmed','skipped'].includes(errorInfo(qid).status); }
function deepPreDone(q){
  if(!quickCheckReady(q) || !questionDeepPath(q)) return false;
  if(q.type==='best_response') return errorDone(q.id);
  return hasEvidence(q.id)&&errorDone(q.id);
}
function preDone(q){
  if(questionSkipped(q) || questionUnderstood(q)) return true;
  return deepPreDone(q);
}
function materialAllQuickResolved(mid){ const qs=materialQuestions(mid); return qs.length>0 && qs.every(q=>questionSkipped(q)||questionUnderstood(q)); }
function materialPreDone(mid){ const qs=materialQuestions(mid); if(materialAllQuickResolved(mid)) return true; if(qs[0].type==='academic_talk'&&!mapDone(mid)) return false; return qs.every(preDone); }
function materialTranscriptViewed(mid){ return materialAllQuickResolved(mid) || !!state.transcriptViewed[mid]; }
function questionComplete(q){
  if(q.audioMissing||questionSkipped(q) || questionUnderstood(q)) return true;
  if(!deepPreDone(q)) return false;
  if(!state.transcriptViewed[q.materialId]) return false;
  if(!state.postTranscriptAnswers[q.id]) return false;
  return true;
}
function materialPostDone(mid){ return materialQuestions(mid).every(questionComplete); }
function materialComplete(mid){ return materialQuestions(mid).every(questionComplete); }
function allAnalysisComplete(){ return isSingleTalkMode()?talkLabComplete():moduleData.questions.every(questionComplete); }
function firstIncompleteMaterialIndex(){ const i=MATERIAL_SEQUENCE.findIndex(mid=>!materialComplete(mid)); return i<0?MATERIAL_SEQUENCE.length:i; }
function completionIssuesForQuestion(q){
  if(q.audioMissing||questionSkipped(q)||questionUnderstood(q)) return [];
  const issues=[];
  if(!replayStepDone(q.materialId)) issues.push('重听/跳过重听');
  if(q.type==='best_response'&&!bestCoreDone(q)) issues.push('Function / Key Meaning');
  if(q.type==='academic_talk'&&!mapDone(q.materialId)) issues.push('Topic / Main Points');
  if(!state.secondAnswers[q.id]) issues.push('第二次选择');
  if(quickCheckReady(q)&&!questionDeepPath(q)) issues.push('选择“我已经理解”或继续深度分析');
  if(questionDeepPath(q)&&q.type!=='best_response'&&!hasEvidence(q.id)) issues.push('Evidence 定位');
  if(questionDeepPath(q)&&!errorDone(q.id)) issues.push('错因选择或跳过');
  if(questionDeepPath(q)&&!state.transcriptViewed[q.materialId]) issues.push('查看 Transcript');
  if(questionDeepPath(q)&&state.transcriptViewed[q.materialId]&&!state.postTranscriptAnswers[q.id]) issues.push('文本后答案');
  return [...new Set(issues)];
}
function completionAudit(){
  return moduleData.questions.map(q=>({q,issues:completionIssuesForQuestion(q)})).filter(x=>x.issues.length>0);
}
function showCompletionAudit(){ state.completionAuditOpen=true; renderAnalysisPreserveScroll(); }
function closeCompletionAudit(){ state.completionAuditOpen=false; renderAnalysisPreserveScroll(); }
function jumpFromAudit(qid){ state.completionAuditOpen=false; const i=qIndex(qid); if(i>=0)switchAnalysisIndex(i); }
function qWithinMaterialOrdinal(q){ return materialQuestions(q.materialId).findIndex(x=>x.id===q.id); }
function previousQPreDone(q){ const qs=materialQuestions(q.materialId),i=qWithinMaterialOrdinal(q); return i===0||preDone(qs[i-1]); }
function questionUnlocked(q){ return true; }

function setFunctionTag(v){ const q=getQ(); if(state.transcriptViewed[q.materialId])return; functionInfo(q.id).functionTag=v; logEvent('function_select',{value:v}); persist(); renderAnalysisPreserveScroll(); }
function setKeyMeaning(v){ const q=getQ(); if(state.transcriptViewed[q.materialId])return; functionInfo(q.id).keyMeaning=v; persist(); refreshRequirementHints(); }
function setMapField(k,v){ const q=getQ(); if(state.transcriptViewed[q.materialId])return; mapInfo(q.materialId)[k]=v; persist(); refreshRequirementHints(); }
function toggleDontKnow(kind){ const q=getQ(); if(state.transcriptViewed[q.materialId])return; const m=mapInfo(q.materialId); if(kind==='topic'){m.topicDontKnow=!m.topicDontKnow;if(m.topicDontKnow)m.topic='';}else{m.mainDontKnow=!m.mainDontKnow;if(m.mainDontKnow){m.main1='';m.main2='';m.main3='';}} logEvent('map_dont_know',{kind,value:kind==='topic'?m.topicDontKnow:m.mainDontKnow}); renderAnalysisPreserveScroll(); }
function chooseSecond(letter){ if(state.paused)return; const q=getQ(); if(state.transcriptViewed[q.materialId])return; state.secondAnswers[q.id]=letter; logEvent('second_answer',{answer:letter}); renderAnalysisPreserveScroll(); }
function choosePost(letter){ if(state.paused)return; const q=getQ(); state.postTranscriptAnswers[q.id]=letter; logEvent('post_transcript_answer',{answer:letter}); renderAnalysisPreserveScroll(); }

function setPointEvidence(){ const q=getQ(); if(state.transcriptViewed[q.materialId]||!state.secondAnswers[q.id]||!questionDeepPath(q))return; const pos=analysisPos(q); state.evidence[q.id]={type:'point',point:pos}; delete state.evidenceDraft[q.id]; logEvent('evidence_point',{position:pos,relative:relTime(q,pos)}); renderAnalysisPreserveScroll(); }
function startRangeEvidence(){ const q=getQ(); if(state.transcriptViewed[q.materialId]||!state.secondAnswers[q.id]||!questionDeepPath(q))return; const pos=analysisPos(q); state.evidenceDraft[q.id]={start:pos}; delete state.evidence[q.id]; logEvent('evidence_range_start',{position:pos,relative:relTime(q,pos)}); renderAnalysisPreserveScroll(); }
function endRangeEvidence(){ const q=getQ(); if(state.transcriptViewed[q.materialId]||!state.secondAnswers[q.id]||!questionDeepPath(q))return; const draft=state.evidenceDraft[q.id]; if(!draft||!Number.isFinite(draft.start)) return; const pos=analysisPos(q); const start=Math.min(draft.start,pos),end=Math.max(draft.start,pos); state.evidence[q.id]={type:'range',start,end}; delete state.evidenceDraft[q.id]; logEvent('evidence_range_end',{start,end}); renderAnalysisPreserveScroll(); }
function clearEvidence(){ const q=getQ(); if(state.transcriptViewed[q.materialId])return; delete state.evidence[q.id]; delete state.evidenceDraft[q.id]; logEvent('evidence_clear'); renderAnalysisPreserveScroll(); }

function toggleErrorReason(code){
  const q=getQ(); if(state.transcriptViewed[q.materialId]||!questionDeepPath(q))return; if(q.type!=='best_response'&&!hasEvidence(q.id))return; if(!state.secondAnswers[q.id])return; const e=errorInfo(q.id); if(e.status!=='pending') e.status='pending'; const i=e.selected.indexOf(code);
  if(i>=0)e.selected.splice(i,1); else if(e.selected.length<2)e.selected.push(code); else return;
  logEvent('error_reason_toggle',{code,selected:e.selected.slice()}); renderAnalysisPreserveScroll();
}
function setOtherReason(v){ const q=getQ(); if(state.transcriptViewed[q.materialId])return; errorInfo(q.id).otherText=v; persist(); }
function confirmErrorReasons(){ const q=getQ(); if(state.transcriptViewed[q.materialId]||!questionDeepPath(q))return; if(q.type!=='best_response'&&!hasEvidence(q.id))return; const e=errorInfo(q.id); if(e.selected.includes('other')&&!e.otherText.trim()) return; e.status='confirmed'; logEvent('error_reason_confirm',{selected:e.selected,other:e.otherText||null}); renderAnalysisPreserveScroll(); }
function skipErrorReasons(){ const q=getQ(); if(state.transcriptViewed[q.materialId]||!questionDeepPath(q))return; if(q.type!=='best_response'&&!hasEvidence(q.id))return; const e=errorInfo(q.id); e.status='skipped'; e.selected=[]; e.otherText=''; logEvent('error_reason_skip'); renderAnalysisPreserveScroll(); }

function openTranscript(){
  const q=getQ(),mid=q.materialId; if(!materialPreDone(mid))return; state.transcriptShown[mid]=true; state.transcriptViewed[mid]=true; logEvent('transcript_open',{materialId:mid}); renderAnalysisPreserveScroll();
}
function toggleTranscriptVisibility(){ const mid=getQ().materialId; if(!state.transcriptViewed[mid])return; state.transcriptShown[mid]=!state.transcriptShown[mid]; renderAnalysisPreserveScroll(); }

function advanceAnalysis(){
  const q=getQ(),mid=q.materialId,qs=materialQuestions(mid),ord=qWithinMaterialOrdinal(q);
  if(!preDone(q)) return;
  if(ord<qs.length-1){ switchAnalysisIndex(qIndex(qs[ord+1].id)); return; }
  if(!materialPreDone(mid)){ renderAnalysis(); return; }
  if(!state.transcriptViewed[mid]){ renderAnalysis(); return; }
  if(!materialPostDone(mid)){ renderAnalysis(); return; }
  const mi=materialIndex(mid); if(mi<MATERIAL_SEQUENCE.length-1){ const nextMid=MATERIAL_SEQUENCE[mi+1]; switchAnalysisIndex(qIndex(materialQuestions(nextMid)[0].id)); }
  else renderAnalysis();
}
function goNextMaterial(){
  if(state.paused) return;
  const q=getQ(), mi=materialIndex(q.materialId);
  if(mi<0 || mi>=MATERIAL_SEQUENCE.length-1) return;
  const nextMid=MATERIAL_SEQUENCE[mi+1], first=materialQuestions(nextMid)[0];
  if(!first) return;
  switchAnalysisIndex(qIndex(first.id));
}
function switchAnalysisIndex(i){ if(state.paused)return; const q=moduleData.questions[i]; if(!questionUnlocked(q))return; saveMaterialPosition(); audio.pause(); state.isPlaying=false; clearSegment(); state.idx=i; renderAnalysis(); }
function jump(i){ switchAnalysisIndex(i); }
function goNextAnalysis(){ if(state.idx<moduleData.questions.length-1)switchAnalysisIndex(state.idx+1); }
function goFirstIncomplete(){ const i=moduleData.questions.findIndex(q=>!materialComplete(q.materialId)||(!questionSkipped(q)&&!materialComplete(q.materialId))); if(i>=0)switchAnalysisIndex(i); }
function revealResults(){ if(!allAnalysisComplete())return; state.resultsRevealed=true; logEvent('results_revealed'); finishCloudSession('completed'); go('results'); }

function seekToEvidencePart(part){
  const q=getQ(),e=state.evidence[q.id]; if(!e)return; let t=null;
  if(part==='point'&&e.type==='point')t=e.point; if(part==='start'&&e.type==='range')t=e.start; if(part==='end'&&e.type==='range')t=e.end;
  if(!Number.isFinite(t))return; ensureAnalysisAudio(q); audio.pause(); state.isPlaying=false; setAnalysisSeekValue(t,{log:true}); refreshAnalysisTransport(q);
}
function updateEvidencePart(part){
  const q=getQ(),e=state.evidence[q.id]; if(!e||state.transcriptViewed[q.materialId])return; const pos=analysisPos(q);
  if(part==='point'&&e.type==='point')e.point=pos;
  if(part==='start'&&e.type==='range'){e.start=Math.min(pos,e.end);}
  if(part==='end'&&e.type==='range'){e.end=Math.max(pos,e.start);}
  logEvent('evidence_edit',{part,position:pos}); renderAnalysisPreserveScroll();
}
function evidenceHtml(q){
  const e=state.evidence[q.id],d=state.evidenceDraft[q.id];
  let marker='';
  if(e?.type==='point') marker=`<div class="editable-evidence"><button class="marker-chip" onclick="seekToEvidencePart('point')">● ${fmtShort(relTime(q,e.point))}</button><button class="btn secondary mini-btn" onclick="updateEvidencePart('point')">用当前时间更新</button></div>`;
  if(e?.type==='range') marker=`<div class="editable-evidence"><span>区间：</span><button class="marker-chip" onclick="seekToEvidencePart('start')">起点 ${fmtShort(relTime(q,e.start))}</button><span>→</span><button class="marker-chip" onclick="seekToEvidencePart('end')">终点 ${fmtShort(relTime(q,e.end))}</button><button class="btn secondary mini-btn" onclick="updateEvidencePart('start')">更新起点</button><button class="btn secondary mini-btn" onclick="updateEvidencePart('end')">更新终点</button></div>`;
  if(d?.start) marker=`<div class="editable-evidence"><button class="marker-chip" onclick="setAnalysisSeekValue(${d.start},{log:true})">区间起点 ${fmtShort(relTime(q,d.start))}</button><span class="muted">拖动/播放到终点后点击“结束区间”</span></div>`;
  if(!marker)marker='<span class="muted">尚未标记</span>';
  return `<div class="evidence-box"><div class="evidence-actions"><button class="btn secondary" onclick="setPointEvidence()">标记一个点</button><button class="btn secondary" onclick="startRangeEvidence()">开始区间</button><button class="btn secondary" ${!d?.start?'disabled':''} onclick="endRangeEvidence()">结束区间</button>${(e||d)?'<button class="btn textbtn" onclick="clearEvidence()">清除</button>':''}</div><div class="evidence-readout ${hasEvidence(q.id)?'done':''}">${hasEvidence(q.id)?'✓ ':''}${marker}</div></div>`;
}

function errorHtml(q){
  const e=errorInfo(q.id); if(e.status==='confirmed') return `<div class="step-done">✓ 错因已记录${e.selected.length?'：'+e.selected.map(c=>ERROR_REASONS.find(x=>x[0]===c)?.[1]).filter(Boolean).join('；'):''}</div>`;
  if(e.status==='skipped') return `<div class="step-done muted">✓ 已跳过错因选择</div>`;
  return `<div class="reason-grid">${ERROR_REASONS.map(([c,l])=>`<button class="reason-btn ${e.selected.includes(c)?'active':''}" onclick="toggleErrorReason('${c}')">${l}</button>`).join('')}</div>${e.selected.includes('other')?`<input class="text-input" placeholder="请简单写一下其他原因" value="${e.otherText||''}" oninput="setOtherReason(this.value)">`:''}<div class="step-actions"><button class="btn" ${e.selected.length===0||(e.selected.includes('other')&&!e.otherText.trim())?'disabled':''} onclick="confirmErrorReasons()">确认错因</button><button class="btn secondary" onclick="skipErrorReasons()">跳过</button><span class="muted small">可多选，最多 2 项。</span></div>`;
}
function replayCard(q){
  const done=replayStepDone(q.materialId); return `<div class="toolcard"><div class="step-title"><span class="step-num">1</span><h3>重听整篇 / 局部</h3>${done?'<span class="done-badge">✓ 已完成</span>':''}</div><p class="muted small">可使用顶部播放器播放、暂停、拖动到任意位置。本步骤可以跳过。</p>${!done?`<button class="btn secondary" onclick="skipReplay()">跳过重听</button>`:`<div class="step-done">${state.replayDecision[q.materialId]==='played'?'✓ 已进行重听':'✓ 已选择跳过'}</div>`}</div>`;
}
function bestCoreCard(q){
  const enabled=replayStepDone(q.materialId),frozen=!!state.transcriptViewed[q.materialId],d=functionInfo(q.id),tags=['Request','Suggestion','Opinion','Clarification','Problem','Other'];
  return `<div class="toolcard ${enabled?'':'locked-card'}" id="bestCoreCard"><div class="step-title"><span class="step-num">2</span><h3>Function & Key Meaning</h3><span id="bestCoreStatus">${bestCoreDone(q)?'<span class="done-badge">✓ 已完成</span>':''}</span></div>${enabled?`${frozen?'<div class="freeze-note">🔒 Transcript 已查看，Function / Key Meaning 已冻结。</div>':''}<div class="tag-row">${tags.map(t=>`<button class="tag ${d.functionTag===t?'active':''} ${frozen?'disabled-tag':''}" ${frozen?'disabled':`onclick="setFunctionTag('${t}')"`}>${t}</button>`).join('')}</div><textarea class="note-input" ${frozen?'disabled':''} placeholder="用自己的话写出这句话的核心意思…" oninput="setKeyMeaning(this.value)">${d.keyMeaning||''}</textarea><div class="require-note">Function 和 Key Meaning 都必须完成。</div>`:`<div class="lock-note">🔒 请先完成或跳过重听步骤。</div>`}</div>`;
}
function mapCard(q){
  const enabled=replayStepDone(q.materialId),frozen=!!state.transcriptViewed[q.materialId],m=mapInfo(q.materialId);
  return `<div class="toolcard ${enabled?'':'locked-card'}" id="mapCard"><div class="step-title"><span class="step-num">2</span><h3>Topic & Main Points</h3><span id="mapStatus">${mapDone(q.materialId)?'<span class="done-badge">✓ 已完成</span>':''}</span></div>${enabled?`${frozen?'<div class="freeze-note">🔒 Transcript 已查看，Topic / Main Points 已冻结。</div>':''}<label class="field-label">Topic</label><div class="field-with-action"><input class="text-input" ${m.topicDontKnow||frozen?'disabled':''} placeholder="这篇讲座主要讲什么？" value="${m.topic||''}" oninput="setMapField('topic',this.value)"><button class="btn ${m.topicDontKnow?'':'secondary'}" ${frozen?'disabled':''} onclick="toggleDontKnow('topic')">${m.topicDontKnow?'✓ 我不知道':'我不知道'}</button></div><label class="field-label">Main Points</label><div class="field-with-action vertical"><input class="text-input" ${m.mainDontKnow||frozen?'disabled':''} placeholder="Main Point 1" value="${m.main1||''}" oninput="setMapField('main1',this.value)"><input class="text-input" ${m.mainDontKnow||frozen?'disabled':''} placeholder="Main Point 2" value="${m.main2||''}" oninput="setMapField('main2',this.value)"><input class="text-input" ${m.mainDontKnow||frozen?'disabled':''} placeholder="Main Point 3（可选）" value="${m.main3||''}" oninput="setMapField('main3',this.value)"><button class="btn ${m.mainDontKnow?'':'secondary'}" ${frozen?'disabled':''} onclick="toggleDontKnow('main')">${m.mainDontKnow?'✓ 我不知道':'Main Points 我不知道'}</button></div><div class="require-note">Topic 必须填写或选择“我不知道”；Main Points 至少填写前两项，或选择“我不知道”。</div>`:`<div class="lock-note">🔒 请先完成或跳过重听步骤。</div>`}</div>`;
}
function questionStepCard(q){
  if(questionSkipped(q)) return `<div class="toolcard confidence-skip-card" id="questionStepCard"><div class="step-title"><span class="step-num">★</span><h3>高信心跳过分析</h3><span class="done-badge">✓ 已记录</span></div><p>你选择“非常有把握”，本题不再要求后续分析。最终揭晓答案时会记录为“高信心正确”或“高信心错误”。</p><div class="step-actions"><button class="btn secondary" onclick="undoHighConfidenceSkip()">取消跳过，开始分析</button></div></div>`;
  if(questionUnderstood(q)) return `<div class="toolcard understood-card" id="questionStepCard"><div class="step-title"><span class="step-num">✓</span><h3>重听后：我已经理解</h3><span class="done-badge">✓ 快速完成</span></div><p>已记录本题在重听/第二次判断后自认为理解。无需继续 Evidence、错因、Transcript 和文本后答案。答案揭晓后会验证为“理解判断正确”或“理解判断错误”。</p><div class="step-actions"><button class="btn secondary" onclick="undoUnderstandingChoice()">改为继续深度分析</button></div></div>`;
  const coreReady=replayStepDone(q.materialId)&&(q.type!=='academic_talk'||mapDone(q.materialId))&&(q.type!=='best_response'||bestCoreDone(q));
  const frozen=!!state.transcriptViewed[q.materialId];
  const second=state.secondAnswers[q.id]||'';
  const quickReady=quickCheckReady(q);
  const deep=questionDeepPath(q);
  const evidenceReady=deep&&q.type!=='best_response'&&!!second;
  const reasonReady=deep&&(q.type==='best_response'?!!second:(!!second&&hasEvidence(q.id)));
  const qs=materialQuestions(q.materialId),ord=qWithinMaterialOrdinal(q);
  return `<div class="toolcard ${coreReady?'':'locked-card'}" id="questionStepCard"><div class="step-title"><span class="step-num">3</span><h3>${q.type==='best_response'?'第二次选择':'当前题：第二次选择'}</h3>${deepPreDone(q)?'<span class="done-badge">✓ 深度预分析完成</span>':''}</div>${frozen?'<div class="freeze-note">🔒 Transcript 已解锁，文本前的诊断数据已冻结，不再修改。</div>':''}${coreReady?`<div class="mini-question">${q.type!=='best_response'?`<div class="mini-stem">${q.stem}</div>`:''}<div class="muted small">第一遍答案：<b>${state.firstAnswers[q.id]||'—'}</b></div><div class="options compact-options">${q.options.map((o,i)=>`<div class="option ${second===letters[i]?'selected':''} ${frozen?'disabled-option':''}" ${frozen?'':`onclick="chooseSecond('${letters[i]}')"`}><span class="radio"></span><span><b>${letters[i]}.</b> ${o}</span></div>`).join('')}</div></div>${quickReady&&!deep?`<div class="resolution-choice"><h4>现在你觉得自己已经理解了吗？</h4><p class="muted small">如果重听后已经清楚，可以快速结束本题；如果仍不确定，再进入 Evidence / 错因 / Transcript 深度分析。</p><div class="step-actions"><button class="btn understood-btn" onclick="markUnderstood()">✓ 我已经理解</button><button class="btn secondary" onclick="chooseDeepAnalysis()">继续深度分析 →</button></div></div>`:''}${deep?`${q.type!=='best_response'?`<div class="substep ${evidenceReady?'':'locked-substep'}"><h4>定位证据</h4>${evidenceReady?evidenceHtml(q):'<div class="lock-note">🔒 先完成第二次选择。</div>'}</div>`:''}<div class="substep ${reasonReady?'':'locked-substep'}"><h4>第一遍错因（可跳过）</h4>${reasonReady?errorHtml(q):`<div class="lock-note">🔒 ${q.type==='best_response'?'先完成第二次选择。':'先完成证据定位。'}</div>`}</div>${deepPreDone(q)&&ord<qs.length-1?`<div class="question-actions"><button class="btn" onclick="advanceAnalysis()">下一题 →</button></div>`:''}`:''}`:`<div class="lock-note">🔒 请先完成前面的必做步骤。</div>`}</div>`;
}

function transcriptCard(q){
  const ready=materialPreDone(q.materialId),shown=!!state.transcriptShown[q.materialId],viewed=!!state.transcriptViewed[q.materialId],allQuick=materialAllQuickResolved(q.materialId);
  if(allQuick) return `<div class="toolcard quick-resolved-card"><div class="step-title"><span class="step-num">4</span><h3>Transcript</h3><span class="done-badge">本篇无需深度文本分析</span></div><p>本篇所有题目均通过“高信心跳过”或“重听后我已经理解”完成。最终答案揭晓后，系统会验证这些自我判断是否准确。</p></div>`;
  return `<div class="toolcard ${ready?'':'locked-card'}"><div class="step-title"><span class="step-num">4</span><h3>Transcript</h3>${viewed?'<span class="done-badge">✓ 已查看</span>':''}</div>${ready?`${!viewed?`<button class="btn" onclick="openTranscript()">解锁并查看 Transcript</button>`:`<button class="btn secondary" onclick="toggleTranscriptVisibility()">${shown?'收起 Transcript':'再次查看 Transcript'}</button>`}${shown?`<div class="transcript">${transcriptWordHtml(q)}</div>`:''}`:`<div class="lock-note">🔒 完成本篇所有需要深度分析的题目后解锁。</div>`}</div>`;
}

function postCard(q){
  if(questionSkipped(q)||questionUnderstood(q)) return '';
  const ready=!!state.transcriptViewed[q.materialId],post=state.postTranscriptAnswers[q.id]||'';
  return `<div class="toolcard ${ready?'':'locked-card'}"><div class="step-title"><span class="step-num">5</span><h3>看文本后的答案</h3>${post?'<span class="done-badge">✓ 已完成</span>':''}</div>${ready?`<div class="muted small" style="margin-bottom:10px">看完文本后，请再独立判断一次。此时仍不显示正确答案。</div><div class="options compact-options">${q.options.map((o,i)=>`<div class="option ${post===letters[i]?'selected':''}" onclick="choosePost('${letters[i]}')"><span class="radio"></span><span><b>${letters[i]}.</b> ${o}</span></div>`).join('')}</div>${post&&qWithinMaterialOrdinal(q)<materialQuestions(q.materialId).length-1?`<div class="question-actions"><button class="btn" onclick="jump(${qIndex(materialQuestions(q.materialId)[qWithinMaterialOrdinal(q)+1].id)})">下一题 →</button></div>`:''}`:`<div class="lock-note">🔒 必须先查看 Transcript。</div>`}</div>`;
}

function materialProgressHtml(q){
  const qs=materialQuestions(q.materialId); return `<div class="material-question-progress">${qs.map(x=>{
    const full=questionComplete(x), pre=preDone(x);
    const mark=questionSkipped(x)?' ★':questionUnderstood(x)?' ✓':full?' ✓':pre?' ◐':'';
    const cls=full?'done':pre?'predone':'';
    const title=questionSkipped(x)?'高信心跳过':questionUnderstood(x)?'重听后已理解':full?'分析完成':pre?'预分析完成，仍需 Transcript/文本后答案':'未完成';
    return `<button title="${title}" class="mat-q ${x.id===q.id?'current':''} ${cls} ${questionSkipped(x)?'confidence':''}" onclick="jump(${qIndex(x.id)})">${questionLabel(x)}${mark}</button>`;
  }).join('')}</div>`;
}
function analysisProgressCount(){ return MATERIAL_SEQUENCE.filter(materialComplete).length; }
function renderAnalysis(){
  const q=getQ();if(q.audioMissing&&!state.reviewMode)return renderMissingAudioAnalysis(); ensureAnalysisAudio(q);
  if(state.reviewMode) return renderReview(q);
  if(isSingleTalkMode()) return renderSingleTalkAnalysis();
  const pos=analysisPos(q),[a,b]=q.listenWindow,mid=q.materialId;
  const allDone=allAnalysisComplete();
  app.innerHTML=`<div class="analysis-shell"><header class="analysis-head"><button class="btn secondary" onclick="confirmExitSession()">← Exit</button><b>${moduleData.trainingMode==='question_type'?`${typeLabel(moduleData.questionType)} 专项 · `:''}${materialLabel(q)}</b><div class="analysis-transport"><button id="analysisPlayBtn" class="btn secondary transport-play-btn" onclick="toggleAnalysisPlayback()">${audio.paused?'▶ Play':'⏸ Pause'}</button><button class="btn secondary transport-restart-btn" onclick="replayFromStart()">↺ From start</button><input id="analysisSeek" class="seek-slider" type="range" min="${a}" max="${b}" step="0.01" value="${pos}" oninput="previewAnalysisSeek(this.value)" onchange="commitAnalysisSeek(this.value)"><span id="analysisTime" class="seek-time">${fmtShort(pos-a)} / ${fmtShort(b-a)}</span></div><div class="volume-group compact"><span>Volume</span><input type="range" min="0" max="1" step="0.01" value="${audio.volume}" oninput="setVolume(this.value)"></div><button class="btn pause-btn" onclick="pauseSession()">⏸ Pause Session</button><button class="btn ${allDone?'':'locked-results-btn'}" onclick="${allDone?'revealResults()':'showCompletionAudit()'}">${allDone?'Reveal Results':'Results Locked · 查看缺项'}</button></header><div class="analysis-grid"><section class="analysis-tools">${materialProgressHtml(q)}${replayCard(q)}${q.type==='best_response'?bestCoreCard(q):''}${q.type==='academic_talk'?mapCard(q):''}${questionStepCard(q)}${transcriptCard(q)}${postCard(q)}${materialComplete(mid)?`<div class="material-complete"><b>✓ 本篇分析完成</b><p>${allDone?'所有材料分析均已完成，可以统一揭晓答案。':'可以进入下一篇材料。'}</p><button class="btn" onclick="${allDone?'revealResults()':'goNextMaterial()'}">${allDone?'Reveal Results':'下一篇材料 →'}</button></div>`:''}</section><section class="analysis-question"><div class="analysis-statusbar"><span>Analysis progress</span><b>${MATERIAL_SEQUENCE.filter(materialComplete).length}/${MATERIAL_SEQUENCE.length} materials</b></div><h2>${q.type==='best_response'?'Choose the best response.':q.title}</h2>${q.type!=='best_response'?`<div class="stem">${q.stem}</div>`:''}<div class="question-recall-card"><div class="recall-label">题目回顾</div>${q.type==='best_response'?'<div class="muted small">回忆刚才听到的句子，再判断是否需要继续分析。</div>':''}<div class="recall-options">${q.options.map((o,i)=>`<div class="recall-option ${state.firstAnswers[q.id]===letters[i]?'first-selected':''}"><span class="recall-letter">${letters[i]}.</span><span>${o}</span>${state.firstAnswers[q.id]===letters[i]?'<span class="first-tag">第一遍选择</span>':''}</div>`).join('')}</div></div><div class="answer-summary"><div><span>First</span><b>${state.firstAnswers[q.id]||'—'}</b></div><div><span>Second</span><b>${state.secondAnswers[q.id]||'—'}</b></div><div><span>After Transcript</span><b>${state.postTranscriptAnswers[q.id]||'—'}</b></div></div><div class="analysis-guide">${questionSkipped(q)?'★ 已记录：非常有把握，跳过本题分析。':questionUnderstood(q)?'✓ 已记录：重听/第二次判断后自认为已经理解。':questionComplete(q)?'✓ 当前题完整分析已完成。':preDone(q)?'◐ 当前题只完成了预分析。':'按左侧步骤完成当前题。'}${state.transcriptViewed[mid]&&!questionSkipped(q)&&!state.postTranscriptAnswers[q.id]?' Transcript 已查看，还需要完成文本后答案。':''}</div><div class="analysis-nav-actions">${canHighConfidenceSkip(q)?`<button class="btn confidence-btn" onclick="skipHighConfidence()">★ 非常有把握，跳过本题分析</button>`:''}${state.idx<moduleData.questions.length-1?`<button class="btn secondary" onclick="goNextAnalysis()">下一题 →</button>`:`<button class="btn secondary" onclick="goFirstIncomplete()">查看未完成题目</button>`}</div></section><aside class="qnav">${moduleData.questions.map((x,i)=>`<button class="${i===state.idx?'current':''} ${questionComplete(x)?'done':preDone(x)?'predone':''} ${questionSkipped(x)?'confidence':''}" onclick="jump(${i})">${questionLabel(x)}${questionSkipped(x)?' ★':questionUnderstood(x)?' ✓':questionComplete(x)?' ✓':preDone(x)?' ◐':''}</button>`).join('')}</aside></div></div>`;
  if(state.completionAuditOpen){
    const audit=completionAudit();
    const rows=audit.map(({q,issues})=>`<button class="audit-row" onclick="jumpFromAudit('${q.id}')"><span><b>${questionLabel(q)}</b> · ${q.stem||'Choose the best response.'}</span><span>${issues.join('、')}</span></button>`).join('');
    document.querySelector('.analysis-shell').insertAdjacentHTML('beforeend',`<div class="audit-overlay"><div class="audit-modal"><div class="audit-head"><div><h2>Results 还不能解锁</h2><p>只有真正完成全部分析，或明确选择“非常有把握，跳过分析”的题目才算完成。</p></div><button class="btn secondary" onclick="closeCompletionAudit()">关闭</button></div><div class="audit-legend"><span>✓ = 完整分析完成</span><span>◐ = 只完成预分析，还缺 Transcript / 文本后答案</span><span>★ = 高信心跳过</span><span>✓ 快速完成 = 重听后我已经理解</span></div><div class="audit-list">${rows||'<div class="audit-empty">没有发现缺项。请关闭后重试。</div>'}</div></div></div>`);
  }
  refreshAnalysisTransport(q); refreshRequirementHints(); if(state.paused)showPauseOverlay();
}
function refreshRequirementHints(){
  persist();
  if(state.view!=='analysis' || state.reviewMode) return;
  const q=getQ();
  // 输入框使用 oninput 保存状态，但不重绘输入框本身，避免打字时失焦/滚动跳动。
  // 只实时刷新状态徽标和后续 Step 3 卡片。
  const bestStatus=document.getElementById('bestCoreStatus');
  if(bestStatus) bestStatus.innerHTML=bestCoreDone(q)?'<span class="done-badge">✓ 已完成</span>':'';
  const mapStatus=document.getElementById('mapStatus');
  if(mapStatus) mapStatus.innerHTML=mapDone(q.materialId)?'<span class="done-badge">✓ 已完成</span>':'';
  const step=document.getElementById('questionStepCard');
  if(step){
    const holder=document.createElement('div');
    holder.innerHTML=questionStepCard(q).trim();
    const fresh=holder.firstElementChild;
    if(fresh) step.replaceWith(fresh);
  }
}

function captureResultsUi(){
  const page=document.querySelector('main.page');
  const openQids=[...document.querySelectorAll('details.result-item[open]')].map(el=>el.dataset.qid).filter(Boolean);
  state.resultsUi={scrollTop:page?page.scrollTop:(window.scrollY||0),openQids};
  persist();
}
function restoreResultsUi(){
  const ui=state.resultsUi||{};
  (ui.openQids||[]).forEach(qid=>{ const el=document.querySelector(`details.result-item[data-qid="${qid}"]`); if(el) el.open=true; });
  const page=document.querySelector('main.page');
  if(page) page.scrollTop=Number(ui.scrollTop)||0; else window.scrollTo(0,Number(ui.scrollTop)||0);
}

// ---------- Review after answer reveal ----------
function startReview(qid){
  if(state.view==='results' && !state.reviewMode) captureResultsUi();
  state.reviewMode=true; state.reviewQuestionId=qid; state.idx=qIndex(qid); const q=getQ(),r=reviewInfo(qid); r.visits++;
  if(!r.questionSnapshot){
    r.questionSnapshot={questionId:q.id,displayId:questionLabel(q),materialId:q.materialId,sourceQuestionId:q.sourceQuestionId||q.id,sourceMaterialId:q.sourceMaterialId||q.materialId,sourceModuleId:q.sourceModuleId||moduleData.moduleId,type:q.type,stem:q.stem,options:q.options.slice(),firstAnswer:state.firstAnswers[q.id]||null,secondAnswer:state.secondAnswers[q.id]||null,postTranscriptAnswer:state.postTranscriptAnswers[q.id]||null,correctAnswer:q.answer,resolution:questionSkipped(q)?'high_confidence':questionUnderstood(q)?'understood_after_replay':'deep_analysis',preRevealEvidence:state.evidence[q.id]||null,errorReasons:(state.errorData[q.id]?.selected||[]).slice()};
  }
  logEvent('post_reveal_review_open',{qid}); state.view='analysis'; renderAnalysis();
}
function exitReview(){ stopAudio({save:true}); state.reviewMode=false; state.reviewQuestionId=null; state.restoreResultsUiOnRender=true; logEvent('post_reveal_review_close'); state.view='results'; renderResults(); }
function setReviewPoint(){ const q=getQ(),pos=analysisPos(q); reviewInfo(q.id).evidence={type:'point',point:pos}; logEvent('review_evidence_point',{position:pos}); renderReview(q); }
function setReviewNote(v){ reviewInfo(getQ().id).note=v; persist(); }
function reviewWrongIds(){ return moduleData.questions.filter(q=>finalAnswerFor(q)!==q.answer).map(q=>q.id); }
function nextWrongId(current){ const ids=reviewWrongIds(),i=ids.indexOf(current); return i>=0&&i<ids.length-1?ids[i+1]:null; }
function renderReview(q){
  ensureAnalysisAudio(q); state.transcriptShown[q.materialId]=true; const r=reviewInfo(q.id),pos=analysisPos(q),[a,b]=q.listenWindow,nextWrong=nextWrongId(q.id);
  const preE=state.evidence[q.id]; const reasonLabels=(state.errorData[q.id]?.selected||[]).map(c=>ERROR_REASONS.find(x=>x[0]===c)?.[1]).filter(Boolean);
  const optionsHtml=q.options.map((o,i)=>`<div class="review-option ${letters[i]===q.answer?'correct-review-option':''}"><b>${letters[i]}.</b> ${o}${letters[i]===q.answer?' <span>✓ 正确答案</span>':''}</div>`).join('');
  app.innerHTML=`<div class="analysis-shell"><header class="analysis-head"><button class="btn secondary" onclick="exitReview()">← Back to Results</button><b>Post-result Review · ${questionLabel(q)}</b><div class="analysis-transport"><button id="analysisPlayBtn" class="btn secondary transport-play-btn" onclick="toggleAnalysisPlayback()">${audio.paused?'▶ Play':'⏸ Pause'}</button><button class="btn secondary transport-restart-btn" onclick="replayFromStart()">↺ From start</button><input id="analysisSeek" class="seek-slider" type="range" min="${a}" max="${b}" step="0.01" value="${pos}" oninput="previewAnalysisSeek(this.value)" onchange="commitAnalysisSeek(this.value)"><span id="analysisTime" class="seek-time">${fmtShort(pos-a)} / ${fmtShort(b-a)}</span></div><button class="btn pause-btn" onclick="pauseSession()">⏸ Pause Session</button></header><div class="review-layout"><section class="review-main"><div class="review-banner">正确答案已经公布。这里的操作单独记录为 <b>post_reveal_review</b>，不会覆盖原始诊断数据。</div><div class="toolcard"><h3>题目</h3><div class="mini-stem">${q.stem||'Choose the best response.'}</div><div class="review-options">${optionsHtml}</div></div><div class="answer-summary"><div><span>First</span><b>${state.firstAnswers[q.id]||'—'}</b></div><div><span>Second</span><b>${state.secondAnswers[q.id]||'—'}</b></div><div><span>After Transcript</span><b>${state.postTranscriptAnswers[q.id]||'—'}</b></div><div class="correct-box"><span>Correct</span><b>${q.answer}</b></div></div><div class="toolcard"><h3>原诊断记录</h3><p><b>完成路径：</b>${resolutionLabel(q)}</p><p><b>第一遍错因：</b>${reasonLabels.length?reasonLabels.join('；'):'未记录/已跳过'}</p><p><b>原 Evidence：</b>${formatEvidenceForReview(q,preE)}</p></div><div class="toolcard"><h3>继续定位答案依据</h3><button class="btn secondary" onclick="setReviewPoint()">标记当前播放位置</button><span class="evidence-readout">${r.evidence?`✓ ${fmtShort(relTime(q,r.evidence.point))}`:'尚未标记'}</span></div><div class="toolcard"><h3>Transcript</h3><div class="transcript">${transcriptWordHtml(q)}</div></div><div class="toolcard"><h3>复盘笔记</h3><textarea class="note-input" placeholder="现在我看懂/听懂了什么？" oninput="setReviewNote(this.value)">${r.note||''}</textarea></div><div class="review-actions"><button class="btn secondary" onclick="exitReview()">返回结果</button>${nextWrong?`<button class="btn" onclick="startReview('${nextWrong}')">下一道错题 →</button>`:''}</div></section></div></div>`;
  refreshAnalysisTransport(q); if(state.paused)showPauseOverlay();
}


// ---------- Results ----------
function displayExplanation(q){ return q.explanation?.trim()?q.explanation:'教师解析暂未录入；当前版本先显示正确答案，并保留后续录入解析的字段。'; }
function finalAnswerFor(q){ if(questionSkipped(q)) return state.firstAnswers[q.id]||null; if(questionUnderstood(q)) return state.secondAnswers[q.id]||null; return state.postTranscriptAnswers[q.id]||state.secondAnswers[q.id]||state.firstAnswers[q.id]||null; }
function resolutionLabel(q){ if(questionSkipped(q))return '高信心跳过'; if(questionUnderstood(q))return '重听后“我已经理解”'; return '深度分析'; }
function formatEvidenceForReview(q,e){ if(!e)return '未记录'; if(e.type==='point')return fmtShort(relTime(q,e.point)); if(e.type==='range')return `${fmtShort(relTime(q,e.start))} → ${fmtShort(relTime(q,e.end))}`; return '未记录'; }
function typeLabel(t){ return ({best_response:'短句回应',conversation:'Conversation',announcement:'Announcement',academic_talk:'Academic Talk'})[t]||t; }
function summaryStats(){
  const qs=moduleData.questions.filter(q=>!q.audioMissing&&q.answerVerified&&q.answer), total=qs.length;
  const firstCorrect=qs.filter(q=>state.firstAnswers[q.id]===q.answer).length;
  const finalCorrect=qs.filter(q=>finalAnswerFor(q)===q.answer).length;
  const firstWrong=qs.filter(q=>state.firstAnswers[q.id]!==q.answer);
  const replayRecovered=firstWrong.filter(q=>state.secondAnswers[q.id]===q.answer).length;
  const transcriptRecovered=firstWrong.filter(q=>state.secondAnswers[q.id]!==q.answer&&state.postTranscriptAnswers[q.id]===q.answer).length;
  const persistent=qs.filter(q=>finalAnswerFor(q)!==q.answer).length;
  const understood=qs.filter(questionUnderstood), understoodCorrect=understood.filter(q=>state.secondAnswers[q.id]===q.answer).length;
  const high=qs.filter(questionSkipped), highCorrect=high.filter(q=>state.firstAnswers[q.id]===q.answer).length;
  const types=[...new Set(qs.map(q=>q.type))].map(t=>{const arr=qs.filter(q=>q.type===t);return {type:t,total:arr.length,first:arr.filter(q=>state.firstAnswers[q.id]===q.answer).length,final:arr.filter(q=>finalAnswerFor(q)===q.answer).length};});
  const reasons={}; Object.values(state.errorData).forEach(e=>{if(e?.status==='confirmed')(e.selected||[]).forEach(c=>reasons[c]=(reasons[c]||0)+1);});
  const topReasons=Object.entries(reasons).sort((a,b)=>b[1]-a[1]).slice(0,3).map(([c,n])=>({code:c,n,label:ERROR_REASONS.find(x=>x[0]===c)?.[1]||c}));
  return {qs,total,firstCorrect,finalCorrect,firstWrong: firstWrong.length,replayRecovered,transcriptRecovered,persistent,understood:understood.length,understoodCorrect,understoodWrong:understood.length-understoodCorrect,high:high.length,highCorrect,highWrong:high.length-highCorrect,types,topReasons};
}
function buildStudentSummary(){
  if(isSingleTalkMode()) return buildSingleTalkSummary();
  const s=summaryStats(), parts=[];
  parts.push(`这次第一遍答对 ${s.firstCorrect}/${s.total}，最终完成分析后答对 ${s.finalCorrect}/${s.total}。第一遍错误共 ${s.firstWrong} 题，其中 ${s.replayRecovered} 题在重听/第二次判断后已经改对，${s.transcriptRecovered} 题需要看到文本后才恢复，最终仍有 ${s.persistent} 题没有解决。`);
  if(s.firstWrong>0 && s.replayRecovered/s.firstWrong>=0.5) parts.push('多数第一遍错误可以靠重听自行修正，这种形态更像“一遍输入时的即时处理不稳定”，而不是材料普遍理解不了。练习重点应放在声音辨认、音义反应速度和一遍听时的信息保持。');
  if(s.transcriptRecovered>0) parts.push(`有 ${s.transcriptRecovered} 题需要 Transcript 才修正，建议结合错因区分“没听清”“听到了但没马上反应意思”和词汇问题。`);
  if(s.persistent>0) parts.push(`最终仍错的 ${s.persistent} 题最值得进入 Post-result Review：这类题通常已经不只是声音问题，还需要检查证据定位、题目理解或选项比较。`);
  if(s.understood>0) parts.push(`有 ${s.understood} 题在重听后选择“我已经理解”，其中 ${s.understoodCorrect} 题判断正确、${s.understoodWrong} 题判断错误。后者属于“自认为理解但仍答错”，可以帮助检查自己的理解监控是否准确。`);
  if(s.high>0) parts.push(`另有 ${s.high} 题选择“非常有把握”跳过分析，其中 ${s.highCorrect} 题正确、${s.highWrong} 题错误。高信心错误应优先复盘。`);
  const typeText=s.types.map(x=>`${typeLabel(x.type)} ${x.first}/${x.total}`).join('；'); if(typeText) parts.push(`第一遍分题型表现：${typeText}。这能帮助你判断问题是集中在某一种材料，还是主要出现在“一遍听”的处理速度上。`);
  if(s.topReasons.length) parts.push(`你主动记录最多的错因是：${s.topReasons.map(x=>`${x.label}（${x.n}次）`).join('、')}。`);
  return parts;
}
async function copyStudentSummary(){ const txt=buildStudentSummary().join('\n\n'); try{await navigator.clipboard.writeText(txt); alert('文字总结已复制。');}catch(e){window.prompt('复制下面的文字总结：',txt);} }
function downloadSummaryTxt(){ const txt=buildStudentSummary().join('\n\n'),blob=new Blob([txt],{type:'text/plain;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${moduleData.id}_学生总结.txt`;a.click();setTimeout(()=>URL.revokeObjectURL(url),500); }
function renderResults(){
  stopAudio({save:true}); state.paused=false; removePauseOverlay();
  if(isSingleTalkMode()) return renderSingleTalkResults();
  if(!state.resultsRevealed){ state.view='analysis'; renderAnalysis(); return; }
  const s=summaryStats(),qs=s.qs;
  app.innerHTML=`<div class="topbar"><div class="brand">Listening Lab</div><div class="spacer"></div><button class="btn ghost" onclick="confirmExitSession()">返回本套题</button></div><main class="page"><div class="results"><h1>${moduleData.title}</h1><p class="muted">所有题目的最少分析路径已完成后统一揭晓答案。</p><div class="metric-grid"><div class="card metric"><div>First-pass Accuracy</div><div class="value">${s.firstCorrect}/${s.total}</div></div><div class="card metric"><div>Final Accuracy</div><div class="value">${s.finalCorrect}/${s.total}</div></div><div class="card metric"><div>重听后自认理解</div><div class="value">${s.understood}</div><div class="metric-note">正确 ${s.understoodCorrect} · 错误 ${s.understoodWrong}</div></div><div class="card metric"><div>最终仍错</div><div class="value">${s.persistent}</div></div></div><div class="metric-grid small"><div class="card metric"><div>高信心正确</div><div class="value">${s.highCorrect}</div></div><div class="card metric"><div>高信心错误</div><div class="value">${s.highWrong}</div></div></div><section class="card student-summary-card"><div class="summary-head"><div><h2>给学生的文字总结</h2><p class="muted">根据本次 First → Replay → Deep Analysis 的真实记录自动生成。</p></div><div class="summary-actions"><button class="btn secondary" onclick="copyStudentSummary()">复制总结</button><button class="btn secondary" onclick="downloadSummaryTxt()">下载 TXT</button></div></div>${buildStudentSummary().map(p=>`<p>${p}</p>`).join('')}</section><section class="card result-list">${qs.map(q=>{const skipped=questionSkipped(q),understood=questionUnderstood(q),final=finalAnswerFor(q)||'—',ok=final===q.answer;return `<details class="result-item ${ok?'':'incorrect'}" data-qid="${q.id}"><summary><span><b>${questionLabel(q)}</b> · ${q.stem||'Choose the best response.'}${skipped?` <span class="confidence-label">★ 高信心${ok?'正确':'错误'}</span>`:understood?` <span class="understood-label">✓ 自认理解${ok?'正确':'错误'}</span>`:''}</span><span class="result-answers">${state.firstAnswers[q.id]||'—'} → ${skipped?'高信心跳过':(state.secondAnswers[q.id]||'—')} → ${understood?'快速结束':(state.postTranscriptAnswers[q.id]||'—')} · <b class="${ok?'ok':'bad'}">${q.answer}</b></span></summary><div class="result-detail"><div><b>完成路径：${resolutionLabel(q)}</b></div><div><b>正确答案：${q.answer}</b></div><p>${displayExplanation(q)}</p><button class="btn ${ok?'secondary':''}" onclick="startReview('${q.id}')">进入 Post-result Review →</button></div></details>`}).join('')}</section><div class="result-actions"><button class="btn" onclick="downloadJSON()">Export Full Diagnostic JSON</button></div></div></main>`;
  if(state.restoreResultsUiOnRender){
    state.restoreResultsUiOnRender=false;
    requestAnimationFrame(()=>{ restoreResultsUi(); persist(); });
  }
}
function downloadJSON(){
  const payload={schema_version:'1.9.2',content_schema_version:ACTIVE_PACK?.schema_version||null,session:{id:state.sessionId,set_id:ACTIVE_PACK?.set_id||ACTIVE_PACK_FOLDER,module:moduleData.id,module_id:moduleData.moduleId||null,training_mode:moduleData.trainingMode||'full_module',question_type:moduleData.questionType||null,source_modules:moduleData.sourceModules||[],started_at:state.startedAt,exported_at:nowIso(),autosave_at:state.autosaveAt},question_map:moduleData.questions.map(q=>({session_question_id:q.id,display_id:questionLabel(q),source_module_id:q.sourceModuleId||moduleData.moduleId,source_question_id:q.sourceQuestionId||q.id,source_material_id:q.sourceMaterialId||q.materialId,type:q.type})),first_attempt:{answers:state.firstAnswers,meta:state.firstMeta},analysis:{second_answers:state.secondAnswers,function_key_meaning:state.functionData,material_maps:state.materialMaps,evidence:state.evidence,error_reasons:state.errorData,transcript_viewed:state.transcriptViewed,post_transcript_answers:state.postTranscriptAnswers,confidence:state.confidenceData,understanding:state.understandingData,replay_decision:state.replayDecision,replay_count:state.materialReplayCount,material_positions:state.materialPositions},results:{revealed:state.resultsRevealed},post_reveal_review:state.reviewData,talk_lab:isSingleTalkMode()?state.talkLab:null,student_summary:buildStudentSummary(),event_log:state.eventLog};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${moduleData.id}_diagnostic_v1.9.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),500); logEvent('json_export');
}

function render(){ if(!state||state.view==='sets')renderSetSelection(); else if(state.view==='library')renderLibrary(); else if(state.view==='practice')renderPractice(); else if(state.view==='analysis')renderAnalysis(); else if(state.view==='results')renderResults(); }

Object.assign(window,{seekTranscriptWord,showTalkPracticeAnswers,start,startType,startSingleTalk,reloadCatalog,openPack,goSets,go,confirmExitSession,resumeSavedSession,exitTypePractice,openPracticeReview,closePracticeReview,toggleTime,chooseFirst,nextQ,setVolume,pauseSession,resumeSession,playAnalysis,pauseAnalysis,toggleAnalysisPlayback,replayFromStart,seekAnalysis,previewAnalysisSeek,commitAnalysisSeek,skipReplay,setFunctionTag,setKeyMeaning,setMapField,toggleDontKnow,chooseSecond,choosePost,setPointEvidence,startRangeEvidence,endRangeEvidence,clearEvidence,seekToEvidencePart,updateEvidencePart,toggleErrorReason,setOtherReason,confirmErrorReasons,skipErrorReasons,openTranscript,toggleTranscriptVisibility,advanceAnalysis,goNextMaterial,jump,goNextAnalysis,goFirstIncomplete,skipHighConfidence,undoHighConfidenceSkip,markUnderstood,chooseDeepAnalysis,undoUnderstandingChoice,showCompletionAudit,closeCompletionAudit,jumpFromAudit,revealResults,startReview,exitReview,setReviewPoint,setReviewNote,addTalkVocabMarker,updateTalkVocabMarker,removeTalkVocabMarker,toggleTalkNoVocab,seekTalkMarker,talkChooseSecond,talkSetPointEvidence,talkStartRangeEvidence,talkEndRangeEvidence,talkClearEvidence,openTalkTranscript,setTalkFrameworkAfter,toggleTalkFrameworkIssue,toggleTalkFrameworkAccurate,setTalkFrameworkIssueNote,setTalkQuestionNote,talkChoosePost,confirmTalkPostUnchanged,skipTalkToTranscript,seekTalkQuestionEvidence,jumpTalkLabIssue,startReviewAtTime,startReviewAtEvidence,showTalkLabAudit,closeTalkLabAudit,copyStudentSummary,downloadSummaryTxt,downloadJSON});

function showBootError(err){
  console.error(err);
  app.innerHTML=`<main class="page"><div class="hero"><div class="card boot-error"><h2>Listening Lab 无法启动</h2><p>${String(err?.message||err)}</p><p>请使用根目录的 <b>start_mac.command</b> / <b>start_windows.bat</b> / <code>python3 start_local.py</code> 启动，不要直接双击 app/index.html。</p></div></div></main>`;
}
async function bootstrap(){
  try{
    await fetchCatalog();
    if(!PACK_CATALOG.length){ state=newState(); state.view='sets'; writeNavigation('sets',null); renderSetSelection(); return; }
    const nav=readNavigation();
    if(nav?.view==='library'){
      const meta=PACK_CATALOG.find(x=>x.folder===nav.pack||x.set_id===nav.pack);
      if(meta){
        const loaded=await fetchPack(meta.folder);
        ACTIVE_PACK=loaded.raw; ACTIVE_PACK_FOLDER=loaded.meta.folder; MODULES=compilePack(ACTIVE_PACK,ACTIVE_PACK_FOLDER);
        moduleData=null; MATERIAL_SEQUENCE=[]; STORAGE_KEY=''; state=newState(); state.view='library'; renderLibrary(); return;
      }
    }
    if(!nav || nav.view==='sets'){
      state=newState(); state.view='sets'; writeNavigation('sets',null); renderSetSelection(); return;
    }
    const saved=readActiveSelection();
    const chosen=PACK_CATALOG.find(x=>x.folder===(nav?.pack||saved?.pack)||x.set_id===(nav?.pack||saved?.pack))||PACK_CATALOG[0];
    await selectModuleGlobals(chosen.folder,saved?.module||chosen.modules?.[0]?.module_id);
    state=newState();
    const restoredSession=restorePersistedState();
    const resumable=restoredSession && ['practice','analysis','results'].includes(state.view);
    if(!resumable){ state.view='library'; writeNavigation('library',ACTIVE_PACK_FOLDER); }
    render();
    if(resumable){
      if(state.view==='practice') prepareRestoredPracticeAudio();
      if(state.view==='analysis' && state.uiScroll) restoreAnalysisScroll(state.uiScroll);
      requestAnimationFrame(()=>{ if(Number.isFinite(state.pageScrollY)) window.scrollTo(0,state.pageScrollY); });
      if(state.paused) showPauseOverlay();
    }
  }catch(e){ showBootError(e); }
}
bootstrap();
window.addEventListener('pagehide',()=>{ if(state) saveRuntimeSnapshot(); });
window.addEventListener('beforeunload',()=>{ if(state) saveRuntimeSnapshot(); });
