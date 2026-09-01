/* ===== 수파베이스 공용 설정 + 작은 헬퍼 =====
   모든 페이지(shinjang_science.html, teacher.html, 학생관리.html, 제출기록_미리보기.html,
   roundengine.js 등)가 이 파일을 <script src="supabase-config.js"></script>로 먼저 불러온 뒤 쓴다.
   SUPABASE_URL을 비워두면 로컬 서버(serve.js)의 /api/* 로 요청하는 옛 방식으로 자동 전환된다
   (로컬에서 npm 없이 serve.js만 띄워 테스트할 때 편하게 쓰려고 남겨둔 안전장치). */
const SUPABASE_URL = 'https://oqhldrkmcewcjslciqmp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9xaGxkcmttY2V3Y2pzbGNpcW1wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcyNDQ4MDIsImV4cCI6MjEwMjgyMDgwMn0.It7aXZ5utrWEoAv9rniGFWQGzJNcDaSzmcAaAoT9GyM';
function isSupabaseConfigured(){ return !!(SUPABASE_URL && SUPABASE_ANON_KEY); }

const SUPA_HEADERS = { 'Content-Type':'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer '+SUPABASE_ANON_KEY };

/* Postgres 함수(RPC) 호출 — 이름 앞에 lab_이 붙은 함수들(로그인, 게시판 답변 등)을 이걸로 부른다.
   반환값은 함수가 jsonb_build_object로 만든 {ok, ...} 형태이거나, setof 함수면 행 배열이다. */
async function supaRpc(fnName, params){
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fnName}`, {
    method:'POST', headers: SUPA_HEADERS, body: JSON.stringify(params||{})
  });
  if(!res.ok){ const t = await res.text().catch(()=>String(res.status)); throw new Error('supabase rpc 실패: '+t); }
  return res.json();
}
/* 테이블을 RLS가 허용하는 범위에서 직접 조회 — queryString은 PostgREST 문법(예: 'student_name=eq.홍길동&order=created_at.desc') */
async function supaSelect(table, queryString){
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}${queryString?'?'+queryString:''}`, { headers: SUPA_HEADERS });
  if(!res.ok) return [];
  return res.json();
}
/* 테이블에 행 하나 추가(insert 정책이 허용된 테이블만) */
async function supaInsert(table, row){
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method:'POST', headers: Object.assign({'Prefer':'return=minimal'}, SUPA_HEADERS), body: JSON.stringify(row)
  });
  return res.ok;
}
