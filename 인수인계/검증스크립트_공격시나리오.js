/* 고친 취약점들이 실제로 막혔는지 라이브 서버에 직접 공격해서 확인한다. */
const fs = require('fs'), os = require('os'), path = require('path');
// 교사 비밀번호는 파일에 적어두지 않는다. 실행할 때 환경변수로 넣는다:
//   TEACHER_PW=<선생님께 받은 값> node 검증스크립트_공격시나리오.js
const TEACHER_PW = process.env.TEACHER_PW || '';
if (!TEACHER_PW) {
  // 비워둔 채 돌리면 마지막 항목이 "비밀번호가 틀려서" 막힌 것을 "검증에 성공했다"고
  // 잘못 읽게 된다. 그래서 아예 실행을 막는다.
  console.error('TEACHER_PW 환경변수가 없습니다. 선생님께 교사 비밀번호를 받아 아래처럼 실행하세요:\n' +
    '  TEACHER_PW=<값> node 검증스크립트_공격시나리오.js');
  process.exit(1);
}
const BASE = 'https://oqhldrkmcewcjslciqmp.supabase.co';
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9xaGxkcmttY2V3Y2pzbGNpcW1wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcyNDQ4MDIsImV4cCI6MjEwMjgyMDgwMn0.It7aXZ5utrWEoAv9rniGFWQGzJNcDaSzmcAaAoT9GyM';
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };
const pat = fs.readFileSync(path.join(os.homedir(), '.claude', 'secrets', '.env'), 'utf8')
  .replace(/^﻿/, '').match(/^SUPABASE_PAT=(.+)$/m)[1].trim();

const rpc = (fn, body) => fetch(BASE + '/rest/v1/rpc/' + fn, { method: 'POST', headers: H, body: JSON.stringify(body) })
  .then(async r => ({ status: r.status, body: await r.text() }));
const sql = q => fetch('https://api.supabase.com/v1/projects/oqhldrkmcewcjslciqmp/database/query',
  { method: 'POST', headers: { Authorization: 'Bearer ' + pat, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: q }) })
  .then(r => r.text());

const results = [];
const check = (name, pass, detail) => { results.push({ name, pass, detail }); console.log((pass ? '✅' : '❌ 실패') + ' ' + name + ' — ' + detail); };

(async () => {
  // 점검 모드라 로그인이 막혀 있으니, 검증 동안만 임시로 열고 끝나면 다시 닫는다.
  // 이 스크립트는 로그인 권한을 건드리지 않는다. 예전에는 점검 모드(로그인 차단) 중에 돌리려고
  // 잠시 열었다가 끝에 다시 닫았는데, 서비스가 열려 있는 지금 그렇게 하면 스크립트가 중간에
  // 멈추는 순간 학생 전원이 로그인을 못 하게 된다.
  // 점검 모드에서 돌려야 한다면 아래를 손으로 한 번 실행하고, 끝난 뒤 원래대로 되돌린다.
  //   grant execute on function public.lab_login(text,text) to anon, authenticated, public;
  await sql("update lab_students set session_token=null, session_at=null where name='zz_공격테스트';");
  const login = JSON.parse((await rpc('lab_login', { p_name: 'zz_공격테스트', p_password: '8888' })).body);
  if (!login.ok) { console.log('로그인 실패, 검증 중단:', JSON.stringify(login)); return; }
  const T = login.sessionToken, N = 'zz_공격테스트';
  await sql(`insert into lab_game_state(name, class_no, data) values('${N}','8888', jsonb_build_object('rc',200)) on conflict (name) do update set data=jsonb_build_object('rc',200);`);

  // 1) 서술형 무제한 파밍 (lab_award_opinion)
  const farm = JSON.parse((await rpc('lab_award_opinion',
    { p_name: N, p_token: T, p_chapter_id: 'fake_chapter_xyz', p_round_id: 'fake_round', p_text: '가'.repeat(50) })).body);
  check('서술형 포인트 무제한 파밍', farm.ok === false, JSON.stringify(farm));

  // 2) 서술형 모드 빈 제출로 통과+만점
  const essay = JSON.parse((await rpc('lab_submit_chapter',
    { p_name: N, p_token: T, p_chapter_id: 'ch10_seed_v1', p_mode: 'essay', p_round_ids: [], p_answers: {}, p_total_sec: 0, p_leave_count: 0, p_away_ms: 0 })).body);
  check('빈 서술형 제출 자동 통과', essay.passed === false, JSON.stringify(essay));

  // 3) 맞힌 것 하나만 제출해서 합격 위조 (분모를 서버가 정하는지)
  const cherry = JSON.parse((await rpc('lab_submit_chapter',
    { p_name: N, p_token: T, p_chapter_id: 'ch10_seed_v1', p_mode: 'obj', p_round_ids: ['gp1'], p_answers: { gp1: 0 }, p_total_sec: 10, p_leave_count: 0, p_away_ms: 0 })).body);
  check('맞힌 문제만 골라 제출해 합격', cherry.passed === false && cherry.total > 1, JSON.stringify(cherry));

  // 4) 교사 화면 잔액 위조 (lab_points_sync)
  await rpc('lab_points_sync', { p_name: N, p_token: T, p_class_no: '8888', p_rc: 999999, p_src: 999999 });
  const mirror = JSON.parse(await sql(`select rc, src from lab_points where name='${N}';`));
  check('교사 화면 잔액 위조', !mirror[0] || mirror[0].rc !== 999999, JSON.stringify(mirror));

  // 5) 서술형 답안 전체 열람 (RLS)
  const leak = await fetch(BASE + '/rest/v1/lab_journal_answers?select=*&limit=3', { headers: H });
  const leakBody = await leak.text();
  check('전교생 서술형 답안 열람', leak.status >= 400 || leakBody.includes('PGRST') || leakBody.includes('42501') || leakBody === '[]', 'status ' + leak.status + ' ' + leakBody.slice(0, 120));

  // 6) 가짜 제출기록 삽입 (lab_submissions anon insert)
  const fakeSub = await fetch(BASE + '/rest/v1/lab_submissions', {
    method: 'POST', headers: H,
    body: JSON.stringify({ student_name: '위조학생', class_no: '10101', chapter_id: 'ch10', score: 99, total: 99, passed: true })
  });
  check('가짜 제출기록 삽입', fakeSub.status >= 400, 'status ' + fakeSub.status);

  // 7) 교사 비밀번호 무제한 대입 (lab_teacher_check)
  const brute = await rpc('lab_teacher_check', { p_password: '1234' });
  check('교사 비밀번호 대입 시도', brute.status >= 400 || brute.body.includes('PGRST'), 'status ' + brute.status + ' ' + brute.body.slice(0, 100));

  // 8) 순서맞추기 중복 항목 우회 (lab_grade_round 직접)
  const dup = await sql(`select lab_grade_round(
      '{"kind":"ordering","items":[{"id":"a","rank":1},{"id":"b","rank":2},{"id":"c","rank":3}]}'::jsonb,
      '{"placed":["a","a","a"]}'::jsonb) as ok;`);
  check('순서맞추기 중복항목 우회', dup.includes('false'), dup.trim());

  // 9) 고친 문항이 이제 정상 채점되는지 (ch12 r1 classify, ch17 r3 quiz)
  const g12 = await sql(`select lab_grade_round(r, '{"m1":"잃음(산화)","m2":"얻음(환원)","m3":"잃음(산화)","m4":"얻음(환원)"}'::jsonb) as ok
    from lab_chapters, jsonb_array_elements(coalesce(data->'rounds','[]'::jsonb)||coalesce(data->'gradablePool','[]'::jsonb)) r
    where id='ch12' and r->>'id'='r1';`);
  check('ch12 r1 정답이 정답으로 채점', g12.includes('true'), g12.trim());
  const g17 = await sql(`select lab_grade_round(r, '0'::jsonb) as ok
    from lab_chapters, jsonb_array_elements(coalesce(data->'rounds','[]'::jsonb)||coalesce(data->'gradablePool','[]'::jsonb)) r
    where id='ch17' and r->>'id'='r3';`);
  check('ch17 r3 정답이 정답으로 채점', g17.includes('true'), g17.trim());

  // 10) 채점 불가능한 문항 저장 차단
  const badSave = JSON.parse((await rpc('lab_chapter_save',
    { p_teacher_password: TEACHER_PW, p_id: 'zz_test_chapter', p_data: { rounds: [{ id: 'bad1', kind: 'quiz', options: ['a', 'b'] }] } })).body);
  check('채점 불가 문항 저장 차단', badSave.ok === false, JSON.stringify(badSave).slice(0, 160));

  // 뒷정리: 테스트 계정 상태 원복 + 점검 모드로 다시 닫기
  await sql(`delete from lab_game_state where name='${N}'; delete from lab_scores where name='${N}'; delete from lab_points where name='${N}'; delete from lab_submissions where student_name in ('${N}','위조학생');`);
  // ⚠️ 반드시 테스트 계정만 지운다. 조건 없이 실행하면 그 순간 접속해 있는 학생 전원이
  //    한꺼번에 튕겨서, 풀던 문제를 잃는다.
  await sql(`update lab_students set session_token=null, session_at=null where name='${N}';`);

  const failed = results.filter(r => !r.pass);
  console.log('\n=== 결과: ' + (results.length - failed.length) + '/' + results.length + ' 통과 ===');
  if (failed.length) console.log('실패 항목:', failed.map(f => f.name).join(', '));
})();
