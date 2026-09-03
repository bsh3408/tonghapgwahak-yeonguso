/* ===================== 챕터 데이터 로딩/변수 생성/템플릿 치환 엔진 =====================
   각 챕터 HTML은 다음처럼만 쓰면 된다:
     loadChapterData('data/ch10.json').then(({ROUNDS, META}) => startSession(ROUNDS, META));
   교사용 관리 페이지가 같은 JSON 파일을 읽고 고쳐서 서버에 저장하면,
   학생이 보는 챕터 화면도 다음 접속부터 바로 그 내용으로 바뀐다.
*/

function evalFormula(formula, vars){
  // vars의 key를 지역변수로 노출한 뒤 formula를 계산한다(교사가 직접 쓰는 로컬 콘텐츠용, 반올림/사칙연산 정도만 지원)
  const names=Object.keys(vars);
  const args=names.map(n=>vars[n]);
  const fn=new Function(...names, 'round', 'min', 'max', `return (${formula});`);
  return fn(...args, Math.round, Math.min, Math.max);
}

function pickOne(rng, arr){ return arr[Math.floor(rng()*arr.length)]; }

function generateVars(varDefs, rng){
  const vars={};
  // 선언 순서대로 생성(뒤에 나온 var가 앞의 var를 참조할 수 있게)
  for(const key of Object.keys(varDefs||{})){
    const def=varDefs[key];
    if(def.type==='randint'){
      let min=def.min, max=def.max;
      if(def.ref!==undefined) min = vars[def.ref] + (def.offset||0);
      if(def.refMax!==undefined) max = vars[def.refMax] + (def.offsetMax||0);
      vars[key]=min+Math.floor(rng()*(max-min+1));
    } else if(def.type==='computed'){
      vars[key]=evalFormula(def.formula, vars);
    } else if(def.type==='scenario'){
      vars[key]=pickOne(rng, def.pool);
    } else if(def.type==='pick'){
      vars[key]=pickOne(rng, def.pool);
    } else if(def.type==='pickNPerGroup'){
      const groups={};
      def.pool.forEach(it=>{ (groups[it.group]=groups[it.group]||[]).push(it); });
      let out=[];
      Object.keys(def.perGroup).forEach(g=>{
        const n=def.perGroup[g];
        out=out.concat(shuffleWith(rng, groups[g]||[]).slice(0,n));
      });
      vars[key]=shuffleWith(rng, out);
    }
  }
  return vars;
}

function substituteStr(str, vars){
  if(typeof str!=='string') return str;
  return str.replace(/\{\{([\w.]+)\}\}/g, (m, path)=>{
    const parts=path.split('.');
    let v=vars;
    for(const p of parts){ if(v==null) return m; v=v[p]; }
    return (v===undefined||v===null) ? m : String(v);
  });
}
function deepSubstitute(obj, vars){
  if(typeof obj==='string') return substituteStr(obj, vars);
  if(Array.isArray(obj)) return obj.map(x=>deepSubstitute(x, vars));
  if(obj && typeof obj==='object'){
    const out={};
    for(const k in obj) out[k]=deepSubstitute(obj[k], vars);
    return out;
  }
  return obj;
}

function resolvePath(vars, path){
  const parts=path.split('.');
  let v=vars;
  for(const p of parts){ if(v==null) return undefined; v=v[p]; }
  return v;
}
function hydrateRounds(roundsTpl, vars, rng){
  return roundsTpl.map(rTpl=>{
    let r=deepSubstitute(rTpl, vars);
    if(rTpl.itemsVar){ r.items = resolvePath(vars, rTpl.itemsVar); delete r.itemsVar; }
    if(rTpl.leftVar){ r.left = resolvePath(vars, rTpl.leftVar); delete r.leftVar; }
    if(rTpl.rightVar){ r.right = resolvePath(vars, rTpl.rightVar); delete r.rightVar; }
    // classify/matchpairs/ordering 항목은 화면 표시 순서를 매번 섞는다(정답 위치가 항상 같은 자리에 있지 않도록)
    if(r.kind==='classify' && Array.isArray(r.items)) r.items=shuffleWith(rng, r.items);
    if(r.kind==='ordering' && Array.isArray(r.items)) r.items=shuffleWith(rng, r.items);
    if(r.kind==='matchpairs'){
      if(Array.isArray(r.left)) r.left=shuffleWith(rng, r.left);
      if(Array.isArray(r.right)) r.right=shuffleWith(rng, r.right);
    }
    // quiz: correctValue로 정답을 지정한 경우, 보기를 섞은 뒤 일치하는 인덱스를 찾는다
    if((r.kind==='quiz'||r.kind==='graphread') && r.correctValue!==undefined){
      const shuffled=shuffleWith(rng, r.options);
      r.correctIndex = shuffled.indexOf(r.correctValue);
      r.options = shuffled;
      delete r.correctValue;
    }
    return r;
  });
}

/* 더블클릭으로 파일을 직접 열면(file://) 브라우저 보안 정책상 data/chN.json을 fetch로
   불러올 수 없다. 이 경우 HTML 안에 함께 저장해 둔 스냅샷(embeddedChapterData)을 대신 쓴다.
   서버(교사용 관리 페이지 저장 API)가 data/chN.json을 저장할 때마다 이 스냅샷도 자동으로 갱신하므로,
   내용은 항상 최신이다 — 다만 fetch가 되는 환경(로컬 서버로 열었을 때)에서는 그쪽이 우선한다. */
async function loadChapterJson(url){
  try{
    const res=await fetch(url, {cache:'no-store'});
    if(!res.ok) throw new Error('http '+res.status);
    return await res.json();
  }catch(e){
    const embed=document.getElementById('embeddedChapterData');
    if(embed) return JSON.parse(embed.textContent);
    throw e;
  }
}

async function loadChapterData(url){
  const data=await loadChapterJson(url);
  const seedKey=data.seedKey || (url.replace(/\W/g,'_')+'_seed');
  const info = typeof getStudentInfo==='function' ? getStudentInfo() : null;
  const studentPart = info && info.name ? info.name : 'guest';
  const storageSeedKey = 'chseed_'+seedKey+'__'+studentPart; // 학생별로 시드를 따로 저장(다른 학생 진행에 안 섞이게)
  const seed=makeSeed(storageSeedKey);
  const rng=mulberry32(seed);
  const vars=generateVars(data.vars, rng);

  /* 문제 풀(gradablePool)이 있으면 그중 gradablePoolCount개(기본 6개)를 학생별로 무작위로 뽑아
     data.rounds(의견형 등 항상 고정으로 나오는 라운드) 앞에 붙인다. 풀 안의 문제 자체는(11·12단원과
     달리) {{변수}}나 itemsVar 같은 무작위 요소 없이 항상 같은 내용 — "어떤 6개가 뽑히는지"만 학생마다 다르다. */
  let roundsTpl = data.rounds;
  if(Array.isArray(data.gradablePool) && data.gradablePool.length){
    const n = data.gradablePoolCount || 6;
    const picked = shuffleWith(rng, data.gradablePool).slice(0, n);
    roundsTpl = picked.concat(data.rounds);
  }

  // 재도전권(rerollRemaining, roundengine.js)이 "지금 안 쓰인 다른 문제"를 다시 뽑을 수 있게
  // 원본 문제풀·변수를 전역에 남겨둔다(이 챕터를 새로 열 때마다 갱신됨).
  window.__CHAPTER_POOL = Array.isArray(data.gradablePool) ? data.gradablePool : [];
  window.__CHAPTER_VARS = vars;

  const ROUNDS=hydrateRounds(roundsTpl, vars, rng);
  const META=deepSubstitute(data.meta, vars);
  META.seedKey = seedKey; // 수파베이스 결과 저장 시 chapter_id로 사용
  META.storageSeedKey = storageSeedKey; // 제출 완료 시 이 시드를 지워서 다음 도전은 새 무작위 조합이 나오게 함
  return {ROUNDS, META, vars, rawData:data};
}
