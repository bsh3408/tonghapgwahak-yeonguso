/* ===================== 공통 멀티라운드 세션 엔진 =====================
   챕터별 HTML은 ROUNDS(라운드 배열)와 META(제목·통과기준 등)를 정의하고
   startSession(ROUNDS, META)를 호출하면 된다.
   라운드 kind: classify | matchpairs | ordering | quiz | graphread | combo | opinion
*/

/* ===== 수파베이스 연동 설정 =====
   실제 SUPABASE_URL/SUPABASE_ANON_KEY와 isSupabaseConfigured()는 supabase-config.js에 있다 —
   이 파일을 쓰는 모든 HTML은 roundengine.js보다 먼저 <script src="supabase-config.js"></script>를 불러와야 한다.
   그 값이 비어 있으면(로컬 테스트용) 수파베이스 대신 로컬 서버(serve.js)의 "모의 저장소"로 보낸다.
   → 확인용 화면: 제출기록_미리보기.html
*/
const DEMO_MOCK_ENDPOINT = '/api/mock-submissions'; // 로컬 서버(serve.js)가 제공하는 모의 저장 API

function getStudentInfo(){
  const raw = sessionStorage.getItem('studentInfo');
  try{ return raw ? JSON.parse(raw) : null; }catch(e){ return null; }
}
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);
 t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}

/* 시드를 localStorage(탭을 닫아도 유지)에 저장해서, 풀다 만 상태로 창을 닫았다가 다시 들어와도
   같은 문제(같은 무작위 조합)로 이어서 풀 수 있게 한다. 제출을 마치면 submitSession()이 이 시드를
   지워서, 다음에 새로 도전할 때는 다시 새로운 무작위 조합이 나온다. */
function makeSeed(key){
  let seed=localStorage.getItem(key);
  if(!seed){seed=(Date.now()^(Math.random()*1e9|0))>>>0; localStorage.setItem(key,seed);}
  return +seed;
}
function clearSeed(key){ try{ localStorage.removeItem(key); }catch(e){} }
function shuffleWith(rng,a){a=a.slice();for(let i=a.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;}

let ENGINE_STATE=null;

/* ---------- 중간 저장(이어서 풀기) ----------
   답을 고를 때마다·라운드를 넘길 때마다 지금까지의 진행 상황(현재 라운드, 답안, 창 이탈 기록)을
   localStorage에 남긴다. 창을 닫았다가 다시 들어와도(같은 학생·같은 단원이면) 이어서 풀 수 있고,
   제출을 마치면 clearProgress()가 이 기록을 지워서 다음 도전은 처음부터 새로 시작한다. */
function progressKey(){
  const S=ENGINE_STATE;
  const info=getStudentInfo();
  const name=info && info.name ? info.name : 'guest';
  return 'chprogress_'+(S.meta.seedKey||S.meta.title)+'__'+name;
}
function saveProgress(){
  const S=ENGINE_STATE; if(!S || S.submitted) return;
  try{
    localStorage.setItem(progressKey(), JSON.stringify({
      cur:S.cur, answers:S.answers, leaveCount:S.leaveCount, totalAwayMs:S.totalAwayMs, startTime:S.startTime
    }));
  }catch(e){}
}
function clearProgress(){
  const S=ENGINE_STATE;
  try{ localStorage.removeItem(progressKey()); }catch(e){}
  if(S && S.meta && S.meta.storageSeedKey) clearSeed(S.meta.storageSeedKey);
}
function restoreProgressIfAny(){
  const S=ENGINE_STATE;
  let raw; try{ raw=localStorage.getItem(progressKey()); }catch(e){ raw=null; }
  if(!raw) return;
  let saved; try{ saved=JSON.parse(raw); }catch(e){ return; }
  if(!saved || (!saved.cur && !Object.keys(saved.answers||{}).length)) return; // 저장된 진행이 없으면 그냥 무시
  S.cur = Math.min(saved.cur||0, S.rounds.length-1);
  S.answers = saved.answers||{};
  S.leaveCount = saved.leaveCount||0;
  S.totalAwayMs = saved.totalAwayMs||0;
  if(saved.startTime) S.startTime = saved.startTime;
  showResumeNotice();
}
function showResumeNotice(){
  const el=document.createElement('div');
  el.textContent='↩️ 저장된 진행 상황을 불러왔어요. 이어서 풀 수 있어요';
  el.style.cssText='position:fixed;top:8px;left:50%;transform:translateX(-50%);z-index:999;'+
    'background:#eef7f4;color:#3fae95;border:1.5px solid #bce3d8;border-radius:20px;padding:8px 16px;'+
    'font-size:12.5px;font-weight:800;box-shadow:0 3px 10px rgba(90,70,50,.12)';
  document.body.appendChild(el);
  setTimeout(()=>el.remove(), 3200);
}
function beginRounds(){ restoreProgressIfAny(); renderRound(); }

function startSession(ROUNDS, META){
  ENGINE_STATE={
    rounds: ROUNDS,
    meta: META,
    cur: 0,
    answers: {},
    submitted: false,
    leaveCount: 0, awayStart: null, totalAwayMs: 0, lastEventTime: 0,
    stageStart: performance.now(),
    startTime: Date.now()
  };
  installLeaveDetection();
  renderTop();
  if(getStudentInfo()){ beginRounds(); }
  else { renderStudentGate(); }
}

/* ---------- 학생 정보 입력 게이트 (세션당 1회) ---------- */
function renderStudentGate(){
  app().innerHTML=`
    <div class="notice">▶ 시작하기 전에 이름과 반·번호를 입력해 주세요. 이 정보는 결과 저장에 쓰입니다.</div>
    <div class="card">
      <input class="gateinput" id="gateName" placeholder="이름 (예: 홍길동)" autocomplete="off">
      <input class="gateinput" id="gateClass" placeholder="반-번호 (예: 3-15)" autocomplete="off">
      <div class="gateerr" id="gateErr">이름과 반-번호를 모두 입력해 주세요.</div>
      <button class="navbtn" id="gateStart">시작하기</button>
    </div>`;
  const submit=()=>{
    const name=document.getElementById('gateName').value.trim();
    const classNo=document.getElementById('gateClass').value.trim();
    const err=document.getElementById('gateErr');
    if(!name || !classNo){ err.classList.add('show'); return; }
    err.classList.remove('show');
    sessionStorage.setItem('studentInfo', JSON.stringify({name, classNo}));
    ENGINE_STATE.stageStart=performance.now();
    ENGINE_STATE.startTime=Date.now();
    beginRounds();
  };
  document.getElementById('gateStart').addEventListener('click', submit);
  document.getElementById('gateClass').addEventListener('keydown', e=>{ if(e.key==='Enter') submit(); });
}

function installLeaveDetection(){
  window.addEventListener('blur', engineRegisterLeave);
  window.addEventListener('focus', engineRegisterReturn);
  document.addEventListener('visibilitychange', ()=>{ if(document.hidden) engineRegisterLeave(); else engineRegisterReturn(); });
}
/* 이 파일은 각 챕터 페이지에 단독으로 로드되므로(05_프로토타입.html과 별개 페이지) 그 앱의 sheet/modal을
   그대로 쓸 수 없다 — 여기서만 쓰는 아주 가벼운 모달을 자체적으로 그린다. */
function engModal(html){
  let host=document.getElementById('engModalHost');
  if(!host){ host=document.createElement('div'); host.id='engModalHost'; document.body.appendChild(host); }
  host.innerHTML=`<div class="engmodal"><div class="card">${html}</div></div>`;
}
function closeEngModal(){ const host=document.getElementById('engModalHost'); if(host) host.innerHTML=''; }
const LEAVE_AUTO_RETURN_LIMIT=5;
function engineRegisterLeave(){
  const S=ENGINE_STATE; if(!S||S.submitted) return;
  const now=Date.now(); if(now-S.lastEventTime<400) return; S.lastEventTime=now;
  S.leaveCount++; S.awayStart=now;
  saveProgress(); // 창을 벗어나는 순간(탭 전환·닫기 등) 진행 상황을 확실히 저장해둔다
  const b=document.getElementById('leaveBadge');
  if(b){ b.textContent=`⏱️ 창 이탈 ${S.leaveCount}회`; b.classList.add('warn');
    setTimeout(()=>b.classList.remove('warn'),900); }
  if(S.leaveCount>=LEAVE_AUTO_RETURN_LIMIT && !S.autoReturning){
    S.autoReturning=true;
    engModal(`<h2 style="margin:0 0 8px">⚠️ 창 이탈이 너무 많아요</h2>
     <div style="font-size:13.5px;color:#4b4037;line-height:1.6">창을 ${LEAVE_AUTO_RETURN_LIMIT}회 이상 벗어나서 연구동으로 자동으로 돌아갑니다.<br>집중해서 다시 도전해 주세요!</div>
     <button class="navbtn" style="margin-top:14px" onclick="location.href='05_프로토타입.html'">확인</button>`);
    setTimeout(()=>{ location.href='05_프로토타입.html'; }, 2200);
  }
}
function engineRegisterReturn(){
  const S=ENGINE_STATE; if(!S) return;
  if(S.awayStart){ S.totalAwayMs += Date.now()-S.awayStart; S.awayStart=null; }
}
function blockPaste(el){
  el.addEventListener('paste', e=>{ e.preventDefault();
    const S=ENGINE_STATE;
    const b=document.getElementById('leaveBadge');
    if(b){ const old=b.textContent; b.textContent='📋 붙여넣기 차단됨'; b.classList.add('warn');
      setTimeout(()=>{ b.textContent=`⏱️ 창 이탈 ${S.leaveCount}회`; b.classList.remove('warn'); },1200); }
  });
  el.addEventListener('contextmenu', e=>e.preventDefault());
}
function fmtTime(sec){const m=Math.floor(sec/60),s=Math.floor(sec%60);return `${m}:${String(s).padStart(2,'0')}`;}

function renderTop(){
  const S=ENGINE_STATE;
  const top=document.getElementById('top');
  top.innerHTML=`
    <div class="title">${S.meta.title}</div>
    <button class="topback" onclick="confirmBackToDept()">🔙 연구동으로 돌아가기</button>
    <div class="leavebadge" id="leaveBadge">⏱️ 창 이탈 0회</div>
    <div class="steps" id="steps"></div>
    <div class="stepcap"><span id="stepCapL"></span><span id="stepCapR"></span></div>`;
}
function confirmBackToDept(){
  const S=ENGINE_STATE;
  if(S && S.submitted){ location.href='05_프로토타입.html'; return; }
  engModal(`<h2 style="margin:0 0 8px">연구동으로 돌아갈까요?</h2>
   <div style="font-size:13px;color:var(--dim);line-height:1.6">지금까지 푼 답은 자동으로 저장돼요. 나중에 이 단원을 다시 열면 이어서 풀 수 있어요.</div>
   <div style="display:flex;gap:8px;margin-top:14px">
    <button class="navbtn" style="flex:1;background:#fff;color:var(--txt);border:2px solid var(--line)" onclick="closeEngModal()">취소</button>
    <button class="navbtn" style="flex:1" onclick="location.href='05_프로토타입.html'">돌아가기</button>
   </div>`);
}
function renderSteps(){
  const S=ENGINE_STATE;
  const n=S.rounds.length;
  const el=document.getElementById('steps');
  el.innerHTML=Array.from({length:n},(_,i)=>`<div class="step ${S.submitted||i<S.cur?'done':i===S.cur?'now':''}"></div>`).join('');
  document.getElementById('stepCapL').textContent = S.submitted?'제출 완료':`${S.cur+1}/${n} · ${S.rounds[S.cur].title}`;
  document.getElementById('stepCapR').textContent = S.submitted?'':'';
}

function app(){return document.getElementById('app');}

function goNext(){
  const S=ENGINE_STATE;
  if(S.cur < S.rounds.length-1){ S.cur++; S.stageStart=performance.now(); renderSteps(); renderRound(); window.scrollTo(0,0); saveProgress(); }
  else { submitSession(); }
}
function goPrev(){
  const S=ENGINE_STATE;
  if(S.cur > 0){ S.cur--; S.stageStart=performance.now(); renderSteps(); renderRound(); window.scrollTo(0,0); saveProgress(); }
}

function renderRound(){
  const S=ENGINE_STATE; renderSteps();
  const r=S.rounds[S.cur];
  const fns={classify:renderClassify, matchpairs:renderMatchpairs, ordering:renderOrdering,
    quiz:renderQuiz, graphread:renderQuiz, combo:renderCombo, opinion:renderOpinion};
  fns[r.kind](r);
}

function navBtn(label, enabled){
  return `<button class="navbtn" id="nextBtn" onclick="goNext()" ${enabled?'':'disabled'}>${label}</button>`;
}
function navRow(label, enabled){
  const S=ENGINE_STATE;
  return `<div class="btnrow">
    <button class="prevbtn" onclick="goPrev()" ${S.cur===0?'disabled':''}>← 이전</button>
    ${navBtn(label, enabled)}
  </div>`;
}
function isLast(){ return ENGINE_STATE.cur === ENGINE_STATE.rounds.length-1; }
function nextLabel(){ return isLast() ? '제출하기' : '다음 라운드 →'; }

/* ---------- classify: 항목을 공유 카테고리 중 하나로 분류 ---------- */
function renderClassify(r){
  const S=ENGINE_STATE;
  const ans = S.answers[r.id] || (S.answers[r.id]={});
  app().innerHTML=`
    <div class="notice">${r.prompt}</div>
    <div class="card">${r.items.map(it=>`
      <div class="clsrow">
        <div class="clsitem">${it.content}</div>
        <div class="clsbtns">${r.categories.map(c=>`<button class="clsbtn ${ans[it.id]===c?'picked':''}" data-item="${it.id}" data-cat="${c}">${c}</button>`).join('')}</div>
      </div>`).join('')}</div>
    ${navRow(nextLabel(), Object.keys(ans).length===r.items.length)}`;
  document.querySelectorAll('.clsbtn').forEach(b=>{
    b.addEventListener('click',()=>{
      ans[b.dataset.item]=b.dataset.cat;
      renderClassify(r); saveProgress();
    });
  });
}

/* ---------- matchpairs: 좌-우 1:1 연결 (색상+연결선으로 표시) ---------- */
const MATCH_COLORS=['#3fae95','#c99622','#c1544c','#5a8fc2','#8a6bb8','#4a9d63','#c25f96','#7a7255'];
function matchColor(r, leftId){
  if(!r._colorMap){ r._colorMap={}; r.left.forEach((l,i)=>{ r._colorMap[l.id]=MATCH_COLORS[i%MATCH_COLORS.length]; }); }
  return r._colorMap[leftId];
}
function renderMatchpairs(r){
  const S=ENGINE_STATE;
  const st = S.answers[r.id] || (S.answers[r.id]={pairs:{}, pickedLeft:null});
  app().innerHTML=`
    <div class="notice">${r.prompt}</div>
    <div class="card">
      <div class="matchwrap" id="matchwrap">
        <svg class="matchsvg" id="matchsvg"></svg>
        <div class="pairgrid">
          <div class="paircol">${r.left.map(l=>{
            const paired=!!st.pairs[l.id]; const col=paired||st.pickedLeft===l.id? matchColor(r,l.id) : null;
            return `<button class="pairbtn ${st.pickedLeft===l.id?'active':''} ${paired?'done':''}" data-side="L" data-id="${l.id}"
              style="${col?`border-color:${col};background:${col}18;color:${col}`:''}">${l.content}${paired?' ●':''}</button>`;
          }).join('')}</div>
          <div class="paircol">${r.right.map(rt=>{
            const leftId=Object.keys(st.pairs).find(k=>st.pairs[k]===rt.id);
            const col=leftId? matchColor(r,leftId) : null;
            return `<button class="pairbtn ${leftId?'done':''}" data-side="R" data-id="${rt.id}"
              style="${col?`border-color:${col};background:${col}18;color:${col}`:''}">${rt.content}${leftId?' ●':''}</button>`;
          }).join('')}</div>
        </div>
      </div>
      <div class="hint">왼쪽 항목을 먼저 누르고, 짝이 되는 오른쪽 항목을 누른다. 연결된 쌍은 같은 색 선으로 이어진다. 다시 누르면 연결이 풀린다. (${Object.keys(st.pairs).length}/${r.left.length}쌍 연결)</div>
    </div>
    ${navRow(nextLabel(), Object.keys(st.pairs).length===r.left.length)}`;
  document.querySelectorAll('.pairbtn').forEach(b=>{
    b.addEventListener('click',()=>{
      if(b.dataset.side==='L'){
        if(st.pairs[b.dataset.id]){ delete st.pairs[b.dataset.id]; st.pickedLeft=null; }
        else { st.pickedLeft = st.pickedLeft===b.dataset.id? null : b.dataset.id; }
      } else if(st.pickedLeft){
        for(const k in st.pairs){ if(st.pairs[k]===b.dataset.id) delete st.pairs[k]; }
        st.pairs[st.pickedLeft]=b.dataset.id; st.pickedLeft=null;
      } else {
        // 우측 항목만 다시 클릭해 연결 해제
        const leftId=Object.keys(st.pairs).find(k=>st.pairs[k]===b.dataset.id);
        if(leftId) delete st.pairs[leftId];
      }
      renderMatchpairs(r); saveProgress();
    });
  });
  drawMatchLines(r, st);
}
function drawMatchLines(r, st){
  const wrap=document.getElementById('matchwrap'), svg=document.getElementById('matchsvg');
  if(!wrap||!svg) return;
  const wrapRect=wrap.getBoundingClientRect();
  svg.setAttribute('width', wrapRect.width);
  svg.setAttribute('height', wrapRect.height);
  svg.setAttribute('viewBox', `0 0 ${wrapRect.width} ${wrapRect.height}`);
  let html='';
  Object.keys(st.pairs).forEach(leftId=>{
    const rightId=st.pairs[leftId];
    const lBtn=document.querySelector(`.pairbtn[data-side="L"][data-id="${leftId}"]`);
    const rBtn=document.querySelector(`.pairbtn[data-side="R"][data-id="${rightId}"]`);
    if(!lBtn||!rBtn) return;
    const lr=lBtn.getBoundingClientRect(), rr=rBtn.getBoundingClientRect();
    const x1=lr.right-wrapRect.left, y1=lr.top+lr.height/2-wrapRect.top;
    const x2=rr.left-wrapRect.left, y2=rr.top+rr.height/2-wrapRect.top;
    const col=matchColor(r,leftId);
    html+=`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="2.5" stroke-linecap="round"/>`;
  });
  svg.innerHTML=html;
}
window.addEventListener('resize', ()=>{
  const S=ENGINE_STATE; if(!S||S.submitted) return;
  const r=S.rounds[S.cur]; if(r && r.kind==='matchpairs') drawMatchLines(r, S.answers[r.id]);
});

/* ---------- ordering: 클릭 순서대로 배열 ---------- */
function renderOrdering(r){
  const S=ENGINE_STATE;
  const st = S.answers[r.id] || (S.answers[r.id]={placed:[]});
  app().innerHTML=`
    <div class="notice">${r.prompt}</div>
    <div class="pool">${r.items.map(it=>`<button class="card ${st.placed.includes(it.id)?'disabled':''}" data-id="${it.id}">${it.content}</button>`).join('')}</div>
    <div class="seqwrap">
      <h3>나의 순서</h3>
      ${st.placed.length? st.placed.map((id,i)=>{
        const it=r.items.find(x=>x.id===id);
        return `<div class="seqrow"><span class="num">${i+1}</span><span class="lbl">${it.content}</span><button class="rmbtn" data-id="${id}">↩</button></div>`;
      }).join('') : `<div class="seqempty">위에서 순서대로 클릭한다</div>`}
    </div>
    <div class="btnrow">
      <button class="prevbtn" onclick="goPrev()" ${S.cur===0?'disabled':''}>← 이전</button>
      <button class="resetbtn" onclick="ENGINE_STATE.answers['${r.id}']={placed:[]};renderOrdering(ENGINE_STATE.rounds[ENGINE_STATE.cur]);saveProgress();">초기화</button>
      ${navBtn(nextLabel(), st.placed.length===r.items.length)}
    </div>`;
  document.querySelectorAll('.pool .card').forEach(b=>{
    if(!b.classList.contains('disabled')) b.addEventListener('click',()=>{ st.placed.push(b.dataset.id); renderOrdering(r); saveProgress(); });
  });
  document.querySelectorAll('.rmbtn').forEach(b=>{
    b.addEventListener('click',()=>{ st.placed=st.placed.filter(id=>id!==b.dataset.id); renderOrdering(r); saveProgress(); });
  });
}

/* ---------- quiz / graphread: 객관식 (그래프 있으면 svg 표시) ---------- */
function renderQuiz(r){
  const S=ENGINE_STATE;
  app().innerHTML=`
    <div class="notice">${r.prompt}</div>
    ${r.chartSvg? `<div class="card">${r.chartSvg}</div>` : ''}
    <div class="card">
      <h3 class="qtext">${r.question}</h3>
      ${r.options.map((o,i)=>`<button class="opt ${S.answers[r.id]===i?'picked':''}" data-i="${i}">${o}</button>`).join('')}
    </div>
    ${navRow(nextLabel(), S.answers[r.id]!==undefined)}`;
  document.querySelectorAll('.opt').forEach(b=>{
    b.addEventListener('click',()=>{ S.answers[r.id]=+b.dataset.i; renderQuiz(r); saveProgress(); });
  });
}

/* ---------- combo: ㄱㄴㄷ 보기조합형 ---------- */
function renderCombo(r){
  const S=ENGINE_STATE;
  app().innerHTML=`
    <div class="notice">${r.prompt}</div>
    <div class="card">
      <div class="statementbox">${r.statements.map((s,i)=>`<div class="stmt"><b>${['ㄱ','ㄴ','ㄷ','ㄹ'][i]}.</b> ${s}</div>`).join('')}</div>
      <h3 class="qtext" style="margin-top:12px">옳은 것만을 있는 대로 고른 것은?</h3>
      ${r.comboOptions.map((combo,i)=>`<button class="opt ${S.answers[r.id]===i?'picked':''}" data-i="${i}">${combo.map(idx=>['ㄱ','ㄴ','ㄷ','ㄹ'][idx]).join(', ')}</button>`).join('')}
    </div>
    ${navRow(nextLabel(), S.answers[r.id]!==undefined)}`;
  document.querySelectorAll('.opt').forEach(b=>{
    b.addEventListener('click',()=>{ S.answers[r.id]=+b.dataset.i; renderCombo(r); saveProgress(); });
  });
}

/* ---------- opinion: 자유 서술 (정답 없음) ---------- */
/* 지시문 뒤에 "제시문(인용문)"이 \n\n"..." 형태로 딸려오면 두 상자로 나눠 보여준다 */
function splitPromptPassage(prompt){
  const m = prompt.match(/^([\s\S]*?)\n\n"([\s\S]*)"\s*$/);
  if(m) return { instruction: m[1].trim(), passage: m[2].trim() };
  return { instruction: prompt, passage: null };
}

/* 의견형 답안은 세션(퀴즈 진행)과 별개로 학생별 로컬 저장소에 계속 남겨서,
   나중에 05_프로토타입.html의 "내 생각 다시 쓰기"에서도 같은 답을 이어서 고칠 수 있게 한다. */
function opinionStorageKey(r){
  const S=ENGINE_STATE;
  const chapterId=S.meta.seedKey || S.meta.title;
  const info=getStudentInfo();
  const studentName=info && info.name ? info.name : 'guest';
  return 'opinion_'+chapterId+'_'+r.id+'__'+studentName;
}
function loadPersistedOpinion(r){
  try{ return localStorage.getItem(opinionStorageKey(r)) || ''; }catch(e){ return ''; }
}
function savePersistedOpinion(r, text){
  try{ localStorage.setItem(opinionStorageKey(r), text); }catch(e){}
}

function renderOpinion(r){
  const S=ENGINE_STATE;
  if(S.answers[r.id]===undefined) S.answers[r.id]=loadPersistedOpinion(r);
  const val = S.answers[r.id] || '';
  const {instruction, passage} = splitPromptPassage(r.prompt);
  app().innerHTML=`
    <div class="notice">${instruction}</div>
    ${passage ? `<div class="passagebox">${passage}</div>` : ''}
    <div class="card">
      <textarea id="opText" placeholder="${r.placeholder||''}">${val}</textarea>
      <div class="counter" id="opCnt"></div>
    </div>
    ${navRow(nextLabel(), (val.trim().length>=(r.minLen||20)))}`;
  const ta=document.getElementById('opText'); blockPaste(ta);
  ta.addEventListener('input',()=>{
    S.answers[r.id]=ta.value;
    savePersistedOpinion(r, ta.value);
    const len=ta.value.trim().length, need=r.minLen||20;
    document.getElementById('opCnt').textContent=`${len}/${need}자 이상`;
    document.getElementById('opCnt').className='counter'+(len>=need?' ok':'');
    document.getElementById('nextBtn').disabled = len<need;
    clearTimeout(S._opSaveTmr); S._opSaveTmr=setTimeout(saveProgress, 500); // 타이핑 중엔 살짝 디바운스해서 저장
  });
  // 초기 카운터 표시
  const len=val.trim().length, need=r.minLen||20;
  setTimeout(()=>{ const c=document.getElementById('opCnt'); if(c){c.textContent=`${len}/${need}자 이상`;c.className='counter'+(len>=need?' ok':'');} },0);
}

/* ---------- 채점 ---------- */
function gradeRound(r){
  const S=ENGINE_STATE, ans=S.answers[r.id];
  if(r.kind==='opinion') return null; // 채점 대상 아님
  if(r.kind==='classify'){
    if(!ans) return false;
    const correctN = r.items.filter(it=>ans[it.id]===it.correct).length;
    return (correctN/r.items.length) >= (r.passRatio||0.8);
  }
  if(r.kind==='matchpairs'){
    if(!ans) return false;
    const correctN = r.left.filter(l=>ans.pairs[l.id]===r.correct[l.id]).length;
    return correctN===r.left.length;
  }
  if(r.kind==='ordering'){
    if(!ans) return false;
    const ranks = ans.placed.map(id=>r.items.find(it=>it.id===id).rank);
    for(let i=0;i<ranks.length-1;i++) if(ranks[i]>ranks[i+1]) return false;
    return true;
  }
  if(r.kind==='quiz'||r.kind==='graphread') return ans===r.correctIndex;
  if(r.kind==='combo') return ans===r.correctComboIndex;
  return false;
}

function submitSession(){
  const S=ENGINE_STATE;
  engineRegisterReturn();
  S.submitted=true;
  clearProgress(); // 제출 완료 — 이어풀기 기록·시드를 지워서 다음 도전은 새 무작위 조합으로 시작
  S.totalSec=Math.round((Date.now()-S.startTime)/1000);
  renderSteps();
  renderResult();
  window.scrollTo(0,0);
  syncToSupabase();
  saveLabProgress();
}

/* ---------- 통합과학연구소 로비(05_프로토타입.html)로 결과 전달 ----------
   같은 브라우저의 localStorage에 "이 단원을 언제, 몇 점으로 통과했는지"를 남겨서
   로비 화면이 새로고침 없이도(혹은 새로고침해도) 최신 결과를 반영할 수 있게 한다. */
function saveLabProgress(){
  const S=ENGINE_STATE;
  const gradable=S.rounds.filter(r=>r.kind!=='opinion');
  const roundResults=gradable.map(r=>({id:r.id, ok:gradeRound(r)}));
  const correctN=roundResults.filter(x=>x.ok).length;
  const passThreshold=S.meta.passCount || Math.ceil(gradable.length*0.75);
  const opinionRounds=S.rounds.filter(r=>r.kind==='opinion');
  const allOpinionsFilled = opinionRounds.every(r=>(S.answers[r.id]||'').trim().length >= (r.minLen||20));
  const passed = correctN >= passThreshold;
  const perfectClear = passed && allOpinionsFilled;
  const chapterId=S.meta.seedKey || S.meta.title;
  const info=getStudentInfo();
  const studentName=info && info.name ? info.name : 'guest'; // 05_프로토타입.html의 sKey()와 동일한 규칙
  // 안전망: 'input' 이벤트로 이미 저장돼 있겠지만, 제출 시점 답안을 다시 한번 확실히 opinion_* 키에 남긴다.
  opinionRounds.forEach(r=>savePersistedOpinion(r, S.answers[r.id]||''));
  try{
    localStorage.setItem('lab_result_'+chapterId+'__'+studentName, JSON.stringify({
      score: correctN, total: gradable.length,
      passed,
      roundResults, perfectClear,
      at: Date.now()
    }));
  }catch(e){ /* localStorage 사용 불가 환경이면 조용히 무시 */ }
}

/* ---------- 수파베이스로 결과 자동 전송 ---------- */
function setSyncBadge(text, cls){
  const b=document.getElementById('syncBadge');
  if(b){ b.textContent=text; b.className='syncbadge'+(cls?(' '+cls):''); }
}
async function syncToSupabase(){
  const S=ENGINE_STATE;
  const info=getStudentInfo() || {name:'미상', classNo:'미상'};
  const gradable=S.rounds.filter(r=>r.kind!=='opinion');
  const results=gradable.map(r=>({id:r.id, title:r.title, kind:r.kind, ok:gradeRound(r)}));
  const correctN=results.filter(x=>x.ok).length;
  const passThreshold=S.meta.passCount || Math.ceil(gradable.length*0.75);
  const opinionRounds=S.rounds.filter(r=>r.kind==='opinion');
  const opinionAnswers={};
  opinionRounds.forEach(r=>{ opinionAnswers[r.id]=(S.answers[r.id]||'').trim(); });
  const allOpinionsFilled = opinionRounds.every(r=>(S.answers[r.id]||'').trim().length >= (r.minLen||20));
  const passed = correctN >= passThreshold;
  // "만점"이 아니라 "통과 + 서술답안 전부 작성"이면 +1점 보너스 대상(평가계획서 반영은 선생님이 최종 확인)
  const perfectClear = passed && allOpinionsFilled;

  const payload={
    student_name: info.name,
    class_no: info.classNo,
    chapter_id: S.meta.seedKey || S.meta.title,
    chapter_title: S.meta.title,
    score: correctN,
    total: gradable.length,
    passed,
    perfect_clear: perfectClear,
    total_sec: S.totalSec,
    leave_count: S.leaveCount,
    away_ms: S.totalAwayMs,
    round_results: results,
    opinion_answers: opinionAnswers
  };

  const useReal = isSupabaseConfigured();
  const endpoint = useReal ? SUPABASE_URL.replace(/\/$/,'')+'/rest/v1/lab_submissions' : DEMO_MOCK_ENDPOINT;
  const headers = useReal
    ? { 'Content-Type':'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization':'Bearer '+SUPABASE_ANON_KEY, 'Prefer':'return=minimal' }
    : { 'Content-Type':'application/json' };

  setSyncBadge(useReal ? '☁️ 결과 저장 중...' : '🧪 (미리보기) 결과 저장 중...', '');
  try{
    const res=await fetch(endpoint, { method:'POST', headers, body: JSON.stringify(payload) });
    if(res.ok) setSyncBadge(useReal ? '☁️ 결과 저장 완료' : '🧪 (미리보기) 결과 저장 완료: 제출기록_미리보기.html에서 확인', 'ok');
    else setSyncBadge('⚠️ 저장에 실패했어요. 선생님께 화면을 보여주세요', 'err');
  }catch(e){
    setSyncBadge('⚠️ 저장에 실패했어요(인터넷 연결을 확인해 주세요). 선생님께 알려주세요', 'err');
  }
  syncOpinionAnswersToJournal(opinionRounds, opinionAnswers, payload);
}

// 제출 시점의 서술형 답을 "최신 답안" 저장소에도 남긴다 — 나중에 학생이 "내 생각 다시 쓰기"로 고치면
// 여기가 계속 최신본으로 덮어써지고, 교사가 건 "다시 써주세요" 요청도 이걸 저장하는 순간 자동 해제된다.
function syncOpinionAnswersToJournal(opinionRounds, opinionAnswers, payload){
  const useReal = isSupabaseConfigured();
  opinionRounds.forEach(r=>{
    const body = {
      student_name: payload.student_name, class_no: payload.class_no,
      chapter_id: payload.chapter_id, chapter_title: payload.chapter_title,
      round_id: r.id, round_title: r.title, text: opinionAnswers[r.id] || ''
    };
    if(useReal){
      supaRpc('lab_journal_save', {
        p_student_name: body.student_name, p_class_no: body.class_no,
        p_chapter_id: body.chapter_id, p_chapter_title: body.chapter_title,
        p_round_id: body.round_id, p_round_title: body.round_title, p_text: body.text
      }).catch(()=>{});
    } else {
      fetch('/api/journal-answers', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) }).catch(()=>{});
    }
  });
}

function renderResult(){
  const S=ENGINE_STATE;
  const gradable = S.rounds.filter(r=>r.kind!=='opinion');
  const results = gradable.map(r=>({round:r, ok:gradeRound(r)}));
  const correctN = results.filter(x=>x.ok).length;
  const passThreshold = S.meta.passCount || Math.ceil(gradable.length*0.75);
  const passed = correctN >= passThreshold;
  const opinionRounds = S.rounds.filter(r=>r.kind==='opinion');

  app().innerHTML=`
    <div class="resulthead">
      <div style="font-size:34px">${passed?'🎉':'🪨'}</div>
      <div class="big">${passed? '목표 달성' : '아쉬워요, 다시 도전할 수 있어요'}</div>
      <div class="score">${correctN} / ${gradable.length}</div>
      <div style="font-size:12px;color:var(--dim)">통과 기준: ${passThreshold}/${gradable.length}</div>
      <div><span class="syncbadge" id="syncBadge">${isSupabaseConfigured() ? '☁️ 결과 저장 중...' : '🧪 (미리보기) 결과 저장 중...'}</span></div>
    </div>
    <div class="metricgrid">
      <div class="metric"><div class="k">총 소요시간</div><div class="v">${fmtTime(S.totalSec)}</div></div>
      <div class="metric"><div class="k">목표시간</div><div class="v">${S.meta.targetMin||20}분 이상</div></div>
      <div class="metric"><div class="k">창 이탈 횟수</div><div class="v ${S.leaveCount>0?'warn':''}">${S.leaveCount}회</div></div>
      <div class="metric"><div class="k">창 이탈 누적시간</div><div class="v ${S.totalAwayMs>15000?'warn':''}">${Math.round(S.totalAwayMs/1000)}초</div></div>
    </div>
    <div class="card"><h3>라운드별 결과</h3>
      ${results.map(x=>`<div class="resultrow ${x.ok?'ok':'bad'}"><span>${x.ok?'✅':'❌'}</span><span class="lbl">${x.round.title}</span></div>`).join('')}
    </div>
    ${opinionRounds.map(r=>`<div class="answerblock"><h4>${r.title}</h4><p>${(S.answers[r.id]||'').trim()}</p></div>`).join('')}
    <div class="finalnotice">${S.meta.scoreNotice || '이 화면의 정답률·소요시간·창 이탈 지표는 채점을 돕는 참고 자료일 뿐입니다. 실제 수행평가 점수는 선생님이 최종 확정합니다.'}</div>
    <div class="btnrow" style="margin-top:14px"><button class="navbtn" onclick="location.reload()">다시 도전하기</button></div>
    <a class="backlink" href="05_프로토타입.html">🔙 연구동으로 돌아가기</a>`;
}
