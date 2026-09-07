/* 재개방 직전 실제 서버로 정상 플레이 한 바퀴를 돌려본다: 로그인 → 상태 동기화 → 하트비트
   → 테마 적용 → 정답 제출로 통과 → 서술형 저장. 끝나면 테스트 계정 흔적을 지운다. */
const fs=require('fs'),os=require('os'),path=require('path');
const BASE='https://oqhldrkmcewcjslciqmp.supabase.co';
const KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9xaGxkcmttY2V3Y2pzbGNpcW1wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcyNDQ4MDIsImV4cCI6MjEwMjgyMDgwMn0.It7aXZ5utrWEoAv9rniGFWQGzJNcDaSzmcAaAoT9GyM';
const H={apikey:KEY,Authorization:'Bearer '+KEY,'Content-Type':'application/json'};
const pat=fs.readFileSync(path.join(os.homedir(),'.claude','secrets','.env'),'utf8').replace(/^\uFEFF/,'').match(/^SUPABASE_PAT=(.+)$/m)[1].trim();
const rpc=(f,b)=>fetch(BASE+'/rest/v1/rpc/'+f,{method:'POST',headers:H,body:JSON.stringify(b)}).then(async r=>{const t=await r.text();try{return JSON.parse(t);}catch(e){return {ok:false,raw:t,status:r.status};}});
const sql=q=>fetch('https://api.supabase.com/v1/projects/oqhldrkmcewcjslciqmp/database/query',{method:'POST',headers:{Authorization:'Bearer '+pat,'Content-Type':'application/json'},body:JSON.stringify({query:q})}).then(r=>r.text());
const N='zz_공격테스트';
const ok=(n,c,d)=>console.log((c?'✅':'❌ 실패')+' '+n+' — '+(typeof d==='string'?d:JSON.stringify(d)).slice(0,220));

(async()=>{
  await sql(`update lab_students set session_token=null, session_at=null where name='${N}';`);
  const login=await rpc('lab_login',{p_name:N,p_password:'8888'});
  ok('로그인',login.ok,login);
  if(!login.ok) return;
  const T=login.sessionToken;

  const st=await rpc('lab_state_sync',{p_name:N,p_token:T,p_class_no:'8888',p_data:{rc:5000}});
  ok('상태 동기화',st&&st.ok!==false,st&&st.data?{rc:st.data.rc}:st);

  {const hb=await rpc('lab_session_heartbeat',{p_name:N,p_token:T}); ok('하트비트', hb && hb.kicked!==true, hb);}

  const th=await rpc('lab_buy_theme',{p_name:N,p_token:T,p_key:'bright'});
  ok('보유 테마 적용',th.ok===true,th);

  // 실제 단원 하나를 서버에서 읽어 정답을 그대로 제출해 본다.
  const chRaw=JSON.parse(await sql("select data from lab_chapters where id='ch17';"));
  const ch=chRaw[0].data;
  const all=[...(ch.rounds||[]),...(ch.gradablePool||[])];
  const answers={}, ids=[];
  for(const r of all){
    ids.push(r.id);
    if(r.kind==='quiz'||r.kind==='graphread') answers[r.id]=r.correctIndex;
    else if(r.kind==='combo') answers[r.id]=r.correctComboIndex;
    else if(r.kind==='classify'){ answers[r.id]={}; (r.items||[]).forEach(it=>answers[r.id][it.id]=it.correct); }
    else if(r.kind==='matchpairs') answers[r.id]={pairs:r.correct};
    else if(r.kind==='ordering') answers[r.id]={placed:(r.items||[]).slice().sort((a,b)=>a.rank-b.rank).map(i=>i.id)};
    else if(r.kind==='opinion') answers[r.id]='서버 점검 후 정상 동작을 확인하기 위해 작성한 충분히 긴 예시 답안입니다.';
  }
  const sub=await rpc('lab_submit_chapter',{p_name:N,p_token:T,p_chapter_id:'ch17',p_mode:'obj',p_round_ids:ids,p_answers:answers,p_total_sec:600,p_leave_count:0,p_away_ms:0});
  ok('정답 전부 제출 시 통과', sub.ok===true && sub.passed===true, sub);
  ok('라운드별 결과 반환', Array.isArray(sub.roundResults) && sub.roundResults.length>0, 'roundResults '+(sub.roundResults||[]).length+'개');

  const op=all.find(r=>r.kind==='opinion');
  if(op){
    const j=await rpc('lab_journal_save',{p_student_name:N,p_token:T,p_class_no:'8888',p_chapter_id:'ch17',p_chapter_title:'전기에너지',p_round_id:op.id,p_round_title:op.title||'',p_text:'서술형 저장 검증용 답안입니다. 충분한 길이로 작성했습니다.'});
    ok('서술형 답안 저장',j.ok===true,j);
    const saved=JSON.parse(await sql(`select opinion_answers from lab_submissions where student_name='${N}' order by id desc limit 1;`));
    ok('제출기록에 서술형 반영', !!(saved[0]&&saved[0].opinion_answers&&Object.keys(saved[0].opinion_answers).length>0), JSON.stringify(saved[0]&&saved[0].opinion_answers));
  }

  await sql(`delete from lab_game_state where name='${N}'; delete from lab_scores where name='${N}'; delete from lab_points where name='${N}'; delete from lab_submissions where student_name='${N}'; delete from lab_journal_answers where student_name='${N}';`);
  await sql(`update lab_students set session_token=null, session_at=null where name='${N}';`);
  console.log('\n테스트 계정 흔적 정리 완료');
})();
