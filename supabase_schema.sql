-- ============================================================
-- 통합과학연구소 — Supabase 스키마 (전체)
-- 기존 프로젝트를 같이 쓰기 때문에, 모든 테이블·함수 이름 앞에 lab_ 을 붙여서
-- 다른 프로젝트 테이블과 절대 안 겹치게 했다.
-- Supabase 대시보드 > SQL Editor 에서 이 파일 전체를 붙여넣고 실행하세요.
-- ============================================================

create extension if not exists pgcrypto;

-- ============================================================
-- 0) 교사 비밀번호 — 학생 명단 등록/초기화, 게시판 답변, 문제 수정 등
--    "교사만" 할 수 있어야 하는 동작을 보호하는 공용 비밀번호 하나.
--    학생 계정과는 완전히 별개(학생 이름/학번과 무관).
-- ============================================================
create table if not exists public.lab_teacher (
  id int primary key default 1,
  salt text not null,
  password_hash text not null,
  check (id = 1)
);
alter table public.lab_teacher enable row level security;
-- anon에게 테이블 직접 접근 정책을 아예 안 줌 → 아래 함수로만 확인/변경 가능.

create or replace function public.lab_teacher_check(p_password text)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
declare t lab_teacher%rowtype;
begin
  select * into t from lab_teacher where id = 1;
  if not found then return false; end if;
  return encode(digest(p_password || t.salt, 'sha256'), 'hex') = t.password_hash;
end; $$;

-- 최초 설정 시(테이블이 비어 있을 때)는 이전 비밀번호 없이 새로 설정할 수 있다.
create or replace function public.lab_teacher_set_password(p_old text, p_new text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare exists_row boolean; newsalt text;
begin
  select true into exists_row from lab_teacher where id = 1;
  if exists_row and not lab_teacher_check(coalesce(p_old,'')) then
    return jsonb_build_object('ok', false, 'error', '기존 교사 비밀번호가 올바르지 않습니다.');
  end if;
  if length(p_new) < 4 then
    return jsonb_build_object('ok', false, 'error', '비밀번호는 4자 이상이어야 합니다.');
  end if;
  newsalt := encode(gen_random_bytes(16), 'hex');
  insert into lab_teacher(id, salt, password_hash)
    values (1, newsalt, encode(digest(p_new || newsalt, 'sha256'), 'hex'))
    on conflict (id) do update set salt = excluded.salt, password_hash = excluded.password_hash;
  return jsonb_build_object('ok', true);
end; $$;

-- ============================================================
-- 1) 학생 로그인 (아이디=이름, 최초 비밀번호=학번, 최초 로그인 후 변경 필수)
-- ============================================================
create table if not exists public.lab_students (
  name text primary key,
  student_id text not null,
  salt text not null,
  password_hash text not null,
  must_change boolean not null default true,
  logged_in_at timestamptz,
  -- 동시 로그인 방지용: 마지막으로 로그인 성공한 기기의 세션 토큰과, 그 기기가 마지막으로
  -- "저 아직 쓰고 있어요"라고 알려온 시각. session_at이 SESSION_TIMEOUT_MINUTES보다 오래되면
  -- 그 기기는 이미 닫혔다고 보고 다른 기기의 새 로그인을 허용한다.
  session_token text,
  session_at timestamptz
);
-- 기존에 이미 만들어져 있던 테이블이라면 위 컬럼이 없을 수 있어 아래 alter를 한 번 더 보장한다.
alter table public.lab_students add column if not exists session_token text;
alter table public.lab_students add column if not exists session_at timestamptz;
alter table public.lab_students enable row level security;
-- anon에게 테이블 직접 접근 정책 없음 → 아래 함수로만.

-- 이 시간(분) 동안 lab_session_heartbeat가 안 오면 그 기기의 세션은 끊긴 것으로 보고 풀어준다.
create or replace function public.lab_session_timeout_minutes() returns int language sql immutable as $$ select 5 $$;

create or replace function public.lab_login(p_name text, p_password text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare s lab_students%rowtype; newtoken text;
begin
  select * into s from lab_students where name = trim(p_name);
  if not found then return jsonb_build_object('ok', false, 'error', '등록되지 않은 이름입니다. 선생님께 문의하세요.'); end if;
  if encode(digest(p_password || s.salt, 'sha256'), 'hex') <> s.password_hash then
    return jsonb_build_object('ok', false, 'error', '비밀번호가 올바르지 않습니다.');
  end if;
  -- 다른 기기가 최근(lab_session_timeout_minutes분 이내)까지 활동 중이었으면 새 로그인을 막는다.
  if s.session_token is not null and s.session_at is not null
     and s.session_at > now() - (lab_session_timeout_minutes() || ' minutes')::interval then
    return jsonb_build_object('ok', false, 'error',
      '다른 기기에서 이미 로그인 중이에요. 그 기기에서 로그아웃하거나, '||lab_session_timeout_minutes()||'분간 그 기기를 쓰지 않으면 여기서 로그인할 수 있어요.');
  end if;
  newtoken := encode(gen_random_bytes(16), 'hex');
  update lab_students set logged_in_at = now(), session_token = newtoken, session_at = now() where name = s.name;
  return jsonb_build_object('ok', true, 'mustChange', s.must_change, 'studentId', s.student_id, 'sessionToken', newtoken);
end; $$;

-- 로그인 중인 기기가 주기적으로 불러서 "아직 쓰고 있다"고 알린다. 그 사이 다른 기기가 로그인해서
-- session_token이 바뀌었으면(kicked:true) 클라이언트는 그 즉시 이 기기를 로그아웃시켜야 한다.
create or replace function public.lab_session_heartbeat(p_name text, p_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare s lab_students%rowtype;
begin
  select * into s from lab_students where name = trim(p_name);
  if not found or s.session_token is distinct from p_token then
    return jsonb_build_object('ok', false, 'kicked', true);
  end if;
  update lab_students set session_at = now() where name = s.name;
  return jsonb_build_object('ok', true);
end; $$;

-- 명시적 로그아웃 시 세션을 즉시 풀어서, 그 기기가 아직 5분 안 지났어도 바로 다른 기기에서 로그인할 수 있게 한다.
create or replace function public.lab_session_logout(p_name text, p_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin
  update lab_students set session_token = null, session_at = null
    where name = trim(p_name) and session_token = p_token;
  return jsonb_build_object('ok', true);
end; $$;

-- 교사가 특정 학생의 "다른 기기에서 로그인 중" 잠금을 강제로 풀어준다(학생이 로그아웃을 못 하는
-- 상황 대비). 세션의 마지막 갱신 시각(session_at)도 함께 돌려줘서 왜 안 풀렸는지 진단할 수 있게 한다.
create or replace function public.lab_session_force_clear(p_teacher_password text, p_name text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare s lab_students%rowtype;
begin
  if not lab_teacher_check(p_teacher_password) then return jsonb_build_object('ok', false, 'error', '교사 비밀번호가 올바르지 않습니다.'); end if;
  select * into s from lab_students where name=trim(p_name);
  if not found then return jsonb_build_object('ok', false, 'error', '등록되지 않은 이름입니다.'); end if;
  update lab_students set session_token=null, session_at=null where name=trim(p_name);
  return jsonb_build_object('ok', true, 'previousSessionAt', s.session_at, 'now', now());
end; $$;

create or replace function public.lab_change_password(p_name text, p_old text, p_new text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare s lab_students%rowtype; newsalt text;
begin
  if length(p_new) < 4 then return jsonb_build_object('ok', false, 'error', '새 비밀번호는 4자 이상이어야 합니다.'); end if;
  select * into s from lab_students where name = trim(p_name);
  if not found then return jsonb_build_object('ok', false, 'error', '등록되지 않은 이름입니다.'); end if;
  if encode(digest(p_old || s.salt, 'sha256'), 'hex') <> s.password_hash then
    return jsonb_build_object('ok', false, 'error', '기존 비밀번호가 올바르지 않습니다.');
  end if;
  newsalt := encode(gen_random_bytes(16), 'hex');
  update lab_students set salt = newsalt, password_hash = encode(digest(p_new || newsalt, 'sha256'), 'hex'), must_change = false
    where name = s.name;
  return jsonb_build_object('ok', true);
end; $$;

-- 교사 전용 명단 관리
create or replace function public.lab_roster_add(p_teacher_password text, p_students jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare rec jsonb; nm text; sid text; newsalt text; added int := 0; skipped int := 0;
begin
  if not lab_teacher_check(p_teacher_password) then return jsonb_build_object('ok', false, 'error', '교사 비밀번호가 올바르지 않습니다.'); end if;
  for rec in select * from jsonb_array_elements(p_students) loop
    nm := trim(rec->>'name'); sid := trim(rec->>'studentId');
    if nm = '' or sid = '' then continue; end if;
    if exists(select 1 from lab_students where name = nm) then skipped := skipped + 1; continue; end if;
    newsalt := encode(gen_random_bytes(16), 'hex');
    insert into lab_students(name, student_id, salt, password_hash, must_change)
      values (nm, sid, newsalt, encode(digest(sid || newsalt, 'sha256'), 'hex'), true);
    added := added + 1;
  end loop;
  return jsonb_build_object('ok', true, 'added', added, 'skipped', skipped);
end; $$;

create or replace function public.lab_roster_resetpw(p_teacher_password text, p_name text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare s lab_students%rowtype; newsalt text;
begin
  if not lab_teacher_check(p_teacher_password) then return jsonb_build_object('ok', false, 'error', '교사 비밀번호가 올바르지 않습니다.'); end if;
  select * into s from lab_students where name = p_name;
  if not found then return jsonb_build_object('ok', false, 'error', '등록되지 않은 이름입니다.'); end if;
  newsalt := encode(gen_random_bytes(16), 'hex');
  update lab_students set salt = newsalt, password_hash = encode(digest(s.student_id || newsalt, 'sha256'), 'hex'), must_change = true
    where name = s.name;
  return jsonb_build_object('ok', true);
end; $$;

create or replace function public.lab_roster_remove(p_teacher_password text, p_name text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin
  if not lab_teacher_check(p_teacher_password) then return jsonb_build_object('ok', false, 'error', '교사 비밀번호가 올바르지 않습니다.'); end if;
  delete from lab_students where name = p_name;
  return jsonb_build_object('ok', true);
end; $$;

create or replace function public.lab_roster_list(p_teacher_password text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin
  if not lab_teacher_check(p_teacher_password) then return jsonb_build_object('ok', false, 'error', '교사 비밀번호가 올바르지 않습니다.'); end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'name', name, 'studentId', student_id, 'mustChange', must_change, 'loggedIn', logged_in_at is not null
  )), '[]'::jsonb) from lab_students);
end; $$;

-- ============================================================
-- 2) 과제(수행평가) 제출기록 — 학생은 제출만 가능, 조회는 교사 RPC로만
-- ============================================================
create table if not exists public.lab_submissions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  student_name text not null,
  class_no text not null,
  chapter_id text not null,
  chapter_title text,
  score int, total int, passed boolean,
  total_sec int, leave_count int, away_ms int,
  round_results jsonb, opinion_answers jsonb, perfect_clear boolean
);
alter table public.lab_submissions enable row level security;
drop policy if exists "students insert only" on public.lab_submissions;
create policy "students insert only" on public.lab_submissions for insert to anon with check (true);

create or replace function public.lab_submissions_list(p_teacher_password text)
returns setof lab_submissions language plpgsql security definer set search_path = public, extensions as $$
begin
  if not lab_teacher_check(p_teacher_password) then return; end if;
  return query select * from lab_submissions order by created_at desc;
end; $$;

-- ============================================================
-- 3) 오류신고/Q&A 게시판 — 누구나 쓰고 볼 수 있음, 답변·삭제는 교사만
-- ============================================================
create table if not exists public.lab_board (
  id text primary key,
  type text not null default 'qna',
  name text not null, class_no text,
  title text not null, content text not null,
  reply text, replied_at timestamptz, resolved boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.lab_board enable row level security;
drop policy if exists "anyone insert board" on public.lab_board;
create policy "anyone insert board" on public.lab_board for insert to anon with check (true);
drop policy if exists "anyone select board" on public.lab_board;
create policy "anyone select board" on public.lab_board for select to anon using (true);

create or replace function public.lab_board_reply(p_teacher_password text, p_id text, p_reply text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin
  if not lab_teacher_check(p_teacher_password) then return jsonb_build_object('ok', false, 'error', '교사 비밀번호가 올바르지 않습니다.'); end if;
  update lab_board set reply = p_reply, replied_at = now(), resolved = true where id = p_id;
  return jsonb_build_object('ok', true);
end; $$;

create or replace function public.lab_board_delete(p_teacher_password text, p_id text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin
  if not lab_teacher_check(p_teacher_password) then return jsonb_build_object('ok', false, 'error', '교사 비밀번호가 올바르지 않습니다.'); end if;
  delete from lab_board where id = p_id;
  return jsonb_build_object('ok', true);
end; $$;

-- ============================================================
-- 4) 다시쓰기 요청(교사→학생) — 학생은 자기 것만 조회, 등록/삭제는 교사만
-- ============================================================
create table if not exists public.lab_redo_requests (
  id text primary key,
  student_name text not null, class_no text,
  chapter_id text not null, chapter_title text,
  round_id text not null, round_title text,
  note text, created_at timestamptz not null default now()
);
alter table public.lab_redo_requests enable row level security;
drop policy if exists "anyone select redo" on public.lab_redo_requests;
create policy "anyone select redo" on public.lab_redo_requests for select to anon using (true);

create or replace function public.lab_redo_upsert(p_teacher_password text, p_student_name text, p_class_no text,
  p_chapter_id text, p_chapter_title text, p_round_id text, p_round_title text, p_note text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin
  if not lab_teacher_check(p_teacher_password) then return jsonb_build_object('ok', false, 'error', '교사 비밀번호가 올바르지 않습니다.'); end if;
  delete from lab_redo_requests where student_name = p_student_name and chapter_id = p_chapter_id and round_id = p_round_id;
  insert into lab_redo_requests(id, student_name, class_no, chapter_id, chapter_title, round_id, round_title, note)
    values ('redo-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16),
      p_student_name, p_class_no, p_chapter_id, p_chapter_title, p_round_id, p_round_title, p_note);
  return jsonb_build_object('ok', true);
end; $$;

create or replace function public.lab_redo_clear(p_teacher_password text, p_id text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin
  if not lab_teacher_check(p_teacher_password) then return jsonb_build_object('ok', false, 'error', '교사 비밀번호가 올바르지 않습니다.'); end if;
  delete from lab_redo_requests where id = p_id;
  return jsonb_build_object('ok', true);
end; $$;

-- ============================================================
-- 5) 서술답안 최신본 — 학생이 직접 저장(같은 학생/단원/라운드면 덮어씀), 자기 것만 조회
-- ============================================================
create table if not exists public.lab_journal_answers (
  id text primary key,
  student_name text not null, class_no text,
  chapter_id text not null, chapter_title text,
  round_id text not null, round_title text,
  text text, updated_at timestamptz not null default now(),
  unique(student_name, chapter_id, round_id)
);
alter table public.lab_journal_answers enable row level security;
drop policy if exists "anyone select journal" on public.lab_journal_answers;
create policy "anyone select journal" on public.lab_journal_answers for select to anon using (true);

create or replace function public.lab_journal_save(p_student_name text, p_token text, p_class_no text, p_chapter_id text,
  p_chapter_title text, p_round_id text, p_round_title text, p_text text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin
  if not lab_check_session(p_student_name, p_token) then return jsonb_build_object('ok', false, 'error', '세션이 유효하지 않습니다.'); end if;
  insert into lab_journal_answers(id, student_name, class_no, chapter_id, chapter_title, round_id, round_title, text, updated_at)
    values ('jrn-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16),
      p_student_name, p_class_no, p_chapter_id, p_chapter_title, p_round_id, p_round_title, p_text, now())
  on conflict (student_name, chapter_id, round_id) do update
    set text = excluded.text, updated_at = now(), class_no = excluded.class_no,
        chapter_title = excluded.chapter_title, round_title = excluded.round_title;
  delete from lab_redo_requests where student_name = p_student_name and chapter_id = p_chapter_id and round_id = p_round_id;
  return jsonb_build_object('ok', true);
end; $$;

-- ============================================================
-- 6) 연구점수 랭킹 — 전체 공개 조회, upsert는 함수로
-- ============================================================
create table if not exists public.lab_scores (
  name text primary key, class_no text,
  research_score int not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.lab_scores add column if not exists total_research_earned int not null default 0;
alter table public.lab_scores add column if not exists total_rc_earned int not null default 0;
alter table public.lab_scores enable row level security;
drop policy if exists "anyone select scores" on public.lab_scores;
create policy "anyone select scores" on public.lab_scores for select to anon using (true);

-- p_research_score는 더 이상 신뢰하지 않는다 — 예전엔 클라이언트가 계산한 S.researchScore를
-- 그대로 덮어썼는데, 그러면 학생이 이 함수를 직접 호출해서 랭킹(수행평가 top10 +1점 보너스와
-- 직결됨)을 조작할 수 있었다. 이제 서버가 갖고 있는 lab_game_state.data를 유일한 진실로 삼는다.
create or replace function public.lab_score_upsert(p_name text, p_token text, p_class_no text, p_research_score int)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare gs lab_game_state%rowtype; real_score int; real_total int; real_rc_total int;
begin
  if not lab_check_session(p_name, p_token) then return jsonb_build_object('ok', false, 'error', '세션이 유효하지 않습니다.'); end if;
  select * into gs from lab_game_state where name=trim(p_name);
  real_score := coalesce((gs.data->>'researchScore')::int, 0);
  real_total := coalesce((gs.data->>'totalResearchEarned')::int, real_score);
  real_rc_total := coalesce((gs.data->>'totalRcEarned')::int, 0);
  insert into lab_scores(name, class_no, research_score, total_research_earned, total_rc_earned, updated_at)
    values (p_name, p_class_no, real_score, real_total, real_rc_total, now())
  on conflict (name) do update set class_no = excluded.class_no, research_score = excluded.research_score,
    total_research_earned = excluded.total_research_earned, total_rc_earned = excluded.total_rc_earned, updated_at = now();
  return jsonb_build_object('ok', true, 'researchScore', real_score, 'totalResearchEarned', real_total, 'totalRcEarned', real_rc_total);
end; $$;

-- ============================================================
-- 7) 연구동 공개설정(마감일 등) — 전체 공개 조회, 저장은 교사만
-- ============================================================
create table if not exists public.lab_deptconfig (
  id int primary key default 1,
  data jsonb not null default '{}'::jsonb,
  check (id = 1)
);
alter table public.lab_deptconfig enable row level security;
drop policy if exists "anyone select deptconfig" on public.lab_deptconfig;
create policy "anyone select deptconfig" on public.lab_deptconfig for select to anon using (true);

create or replace function public.lab_deptconfig_save(p_teacher_password text, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin
  if not lab_teacher_check(p_teacher_password) then return jsonb_build_object('ok', false, 'error', '교사 비밀번호가 올바르지 않습니다.'); end if;
  insert into lab_deptconfig(id, data) values (1, p_data) on conflict (id) do update set data = excluded.data;
  return jsonb_build_object('ok', true);
end; $$;

-- ============================================================
-- 8) 단원(챕터) 문제 데이터(정답 포함) — 학생 브라우저에 절대 그대로 내려주면 안 되는 비공개 원본.
--    예전엔 "학생이 문제를 받아야 하니까"라는 이유로 전체 공개 조회였는데, 그러면 정답까지 그대로
--    노출되는 셈이라(개발자도구는커녕 이 테이블 자체를 그냥 읽으면 정답이 다 보임) 완전히 막는다.
--    실제 문제 UI는 지금처럼 정적 파일(data/chN.json, 이것도 정답이 들어있어 근본 해결은 아니지만
--    최소한 서버 채점 결과가 진실이 되게 아래 lab_submit_chapter로 검증한다)로 계속 그리고,
--    "제출된 답이 진짜 맞았는지"만 이 비공개 사본을 기준으로 서버가 다시 채점한다.
-- ============================================================
create table if not exists public.lab_chapters (
  id text primary key,  -- 'ch10' 형태
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.lab_chapters enable row level security;
drop policy if exists "anyone select chapters" on public.lab_chapters; -- 예전 공개 정책 제거(비공개로 전환)

create or replace function public.lab_chapter_save(p_teacher_password text, p_id text, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin
  if not lab_teacher_check(p_teacher_password) then return jsonb_build_object('ok', false, 'error', '교사 비밀번호가 올바르지 않습니다.'); end if;
  insert into lab_chapters(id, data, updated_at) values (p_id, p_data, now())
    on conflict (id) do update set data = excluded.data, updated_at = now();
  return jsonb_build_object('ok', true);
end; $$;

-- 라운드 하나(r)에 학생이 낸 답(ans)이 맞는지 채점한다. shinjang_science.html의 gradeRound()를
-- 그대로 옮긴 것 — 정답 필드(correct/correctIndex 등)는 이 함수 안에서만 다뤄지고 클라이언트로
-- 절대 돌아가지 않는다(맞았는지 아닌지 boolean만 돌려줌).
create or replace function public.lab_grade_round(r jsonb, ans jsonb) returns boolean
language plpgsql immutable as $$
declare
  kind text; items jsonb; li jsonb; i int; total_n int; correct_n int; ratio numeric;
  left_arr jsonb; correct_map jsonb; placed jsonb; prev_rank numeric; cur_rank numeric;
begin
  kind := r->>'kind';
  if kind = 'opinion' then return null; end if;
  if ans is null or jsonb_typeof(ans) = 'null' then return false; end if;

  if kind = 'classify' then
    items := r->'items';
    total_n := jsonb_array_length(items);
    if total_n = 0 then return false; end if;
    correct_n := 0;
    for i in 0..total_n-1 loop
      li := items->i;
      if (ans->>(li->>'id')) is not distinct from (li->>'correct') and (ans->>(li->>'id')) is not null then
        correct_n := correct_n + 1;
      end if;
    end loop;
    ratio := coalesce((r->>'passRatio')::numeric, 0.8);
    return (correct_n::numeric / total_n) >= ratio;

  elsif kind = 'matchpairs' then
    left_arr := r->'left';
    correct_map := r->'correct';
    total_n := jsonb_array_length(left_arr);
    if total_n = 0 then return false; end if;
    correct_n := 0;
    for i in 0..total_n-1 loop
      li := left_arr->i;
      if (ans->'pairs'->>(li->>'id')) is not distinct from (correct_map->>(li->>'id')) and (ans->'pairs'->>(li->>'id')) is not null then
        correct_n := correct_n + 1;
      end if;
    end loop;
    return correct_n = total_n;

  elsif kind = 'ordering' then
    placed := ans->'placed';
    if placed is null or jsonb_typeof(placed) <> 'array' then return false; end if;
    total_n := jsonb_array_length(placed);
    if total_n = 0 or total_n <> jsonb_array_length(r->'items') then return false; end if;
    prev_rank := null;
    for i in 0..total_n-1 loop
      select (it->>'rank')::numeric into cur_rank from jsonb_array_elements(r->'items') it where it->>'id' = (placed->>i);
      if cur_rank is null then return false; end if;
      if prev_rank is not null and cur_rank < prev_rank then return false; end if;
      prev_rank := cur_rank;
    end loop;
    return true;

  elsif kind = 'quiz' or kind = 'graphread' then
    return (ans::text)::int = (r->>'correctIndex')::int;

  elsif kind = 'combo' then
    return (ans::text)::int = (r->>'correctComboIndex')::int;

  else
    return false;
  end if;
exception when others then
  return false;
end; $$;

-- 챕터 제출 채점 + 크레딧 지급을 서버가 직접 한다(클라이언트가 "몇 점 맞았다"를 자체 보고하는 걸
-- 더 이상 신뢰하지 않음). p_round_ids는 이번 세션에 실제로 보여준 라운드 id 목록,
-- p_answers는 {라운드id: 그 라운드에 낸 답} 형태 — roundengine.js의 S.answers를 그대로 보낸다.
create or replace function public.lab_submit_chapter(p_name text, p_token text, p_chapter_id text, p_mode text,
  p_round_ids jsonb, p_answers jsonb, p_total_sec int, p_leave_count int, p_away_ms int)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  cs lab_chapters%rowtype; gs lab_game_state%rowtype;
  all_rounds jsonb; round_def jsonb; rid text; i int; n int; kind text;
  correct_n int := 0; total_n int := 0; round_results jsonb := '[]'::jsonb;
  pass_count int; pass_threshold int; passed boolean;
  ever_correct jsonb; chapter_key text; result_key text; title text; opinion_awarded jsonb;
  rc_gain int := 0; opinion_min_len int; opinion_text text; all_opinions_filled boolean := true;
  has_opinion_round boolean := false;
  perfect_clear boolean; cur_rc int; new_data jsonb; is_correct boolean;
begin
  if not lab_check_session(p_name, p_token) then return jsonb_build_object('ok', false, 'error', '세션이 유효하지 않습니다.'); end if;
  -- 클라이언트는 seedKey('ch10_seed_v1')를 보내지만 lab_chapters.id는 짧은 형태('ch10')라 둘 다 받아준다.
  select * into cs from lab_chapters where id = p_chapter_id or data->>'seedKey' = p_chapter_id limit 1;
  if not found then return jsonb_build_object('ok', false, 'error', '알 수 없는 단원입니다.'); end if;
  select * into gs from lab_game_state where name = trim(p_name);
  if not found then return jsonb_build_object('ok', false, 'error', '게임 상태를 찾을 수 없습니다.'); end if;

  all_rounds := coalesce(cs.data->'rounds','[]'::jsonb) || coalesce(cs.data->'gradablePool','[]'::jsonb);
  chapter_key := coalesce(cs.data->>'seedKey', p_chapter_id);
  result_key := chapter_key || (case when p_mode is not null and p_mode <> '' then '__'||p_mode else '' end);
  title := coalesce(cs.data->'meta'->>'title', p_chapter_id);

  ever_correct := coalesce(gs.data->'everCorrect'->chapter_key, '[]'::jsonb);
  opinion_awarded := coalesce(gs.data->'opinionAwarded', '{}'::jsonb);

  n := coalesce(jsonb_array_length(p_round_ids), 0);
  for i in 0..n-1 loop
    rid := p_round_ids->>i;
    round_def := null;
    select r into round_def from jsonb_array_elements(all_rounds) r where r->>'id' = rid limit 1;
    if round_def is null then continue; end if;
    kind := round_def->>'kind';

    if kind = 'opinion' then
      has_opinion_round := true;
      opinion_min_len := coalesce((round_def->>'minLen')::int, 20);
      opinion_text := coalesce(p_answers->>rid, '');
      if length(trim(opinion_text)) < opinion_min_len then all_opinions_filled := false; end if;
      if length(trim(opinion_text)) >= opinion_min_len and not (opinion_awarded ? (chapter_key||'_'||rid)) then
        rc_gain := rc_gain + 80;
        opinion_awarded := opinion_awarded || jsonb_build_object(chapter_key||'_'||rid, true);
      end if;
    else
      total_n := total_n + 1;
      is_correct := coalesce(lab_grade_round(round_def, p_answers->rid), false);
      if is_correct then correct_n := correct_n + 1; end if;
      round_results := round_results || jsonb_build_array(jsonb_build_object('id', rid, 'ok', is_correct));
      if is_correct and not (ever_correct ? rid) then
        rc_gain := rc_gain + 35;
        ever_correct := ever_correct || to_jsonb(rid);
      end if;
    end if;
  end loop;

  pass_count := nullif(cs.data->'meta'->>'passCount','')::int;
  -- total_n=0("채점 대상 문제가 아예 없음")은 진짜 서술형 전용 미션(p_mode='essay')일 때만 자동 통과다.
  -- 그 외 모드에서 total_n=0은 유효한 라운드 id를 하나도 못 찾았다는 뜻이라(가짜 id로 우회 시도 등)
  -- 통과로 치면 안 된다.
  if total_n = 0 then
    pass_threshold := 0;
    passed := (p_mode = 'essay');
  else
    pass_threshold := coalesce(pass_count, ceil(total_n*0.75)::int);
    passed := correct_n >= pass_threshold;
  end if;
  -- 서술형이 아예 없던 세션(mode=obj 등)은 "글 다 썼는지" 조건을 만점 판정에서 제외한다.
  perfect_clear := passed and (all_opinions_filled or not has_opinion_round);

  cur_rc := coalesce((gs.data->>'rc')::int, 0) + rc_gain;
  new_data := gs.data;
  new_data := jsonb_set(new_data, '{rc}', to_jsonb(cur_rc));
  -- jsonb_set(..., true)는 "맨 끝 키"만 없어도 만들어주고, 중간 컨테이너(everCorrect/claimed/...
  -- 자체)가 아예 없으면 조용히 아무 일도 안 하고 끝나버린다(옛날 계정처럼 이 필드가 한 번도 저장된
  -- 적 없는 경우). 그래서 중간 컨테이너부터 먼저 {}로 보장해준 뒤에 중첩 키를 넣는다.
  new_data := jsonb_set(new_data, '{everCorrect}', coalesce(new_data->'everCorrect','{}'::jsonb));
  new_data := jsonb_set(new_data, array['everCorrect', chapter_key], ever_correct, true);
  new_data := jsonb_set(new_data, '{opinionAwarded}', opinion_awarded);
  new_data := jsonb_set(new_data, '{claimed}', coalesce(new_data->'claimed','{}'::jsonb));
  new_data := jsonb_set(new_data, array['claimed', result_key], to_jsonb((extract(epoch from now())*1000)::bigint), true);
  if passed then
    -- "클리어" 여부(성적 표시용)는 만점이 아니어도 통과만 하면 확정한다. 한 번 통과하면 다음에
    -- 더 낮은 점수로 다시 내도 클리어 배지가 사라지지 않게 true만 기록하고 false로는 안 되돌린다.
    new_data := jsonb_set(new_data, '{everPassed}', coalesce(new_data->'everPassed','{}'::jsonb));
    new_data := jsonb_set(new_data, array['everPassed', result_key], 'true'::jsonb, true);
  end if;
  if perfect_clear then
    new_data := jsonb_set(new_data, '{everPerfect}', coalesce(new_data->'everPerfect','{}'::jsonb));
    new_data := jsonb_set(new_data, array['everPerfect', result_key], 'true'::jsonb, true);
  end if;

  update lab_game_state set data = new_data, updated_at = now() where name = trim(p_name);
  insert into lab_points(name, class_no, rc, src, updated_at) values (trim(p_name), gs.class_no, cur_rc, 0, now())
    on conflict (name) do update set rc = excluded.rc, updated_at = now();

  insert into lab_submissions(student_name, class_no, chapter_id, chapter_title, score, total, passed,
    total_sec, leave_count, away_ms, round_results, opinion_answers, perfect_clear)
  values (trim(p_name), gs.class_no, chapter_key, title, correct_n, total_n, passed,
    p_total_sec, p_leave_count, p_away_ms, round_results, '{}'::jsonb, perfect_clear);

  return jsonb_build_object('ok', true, 'score', correct_n, 'total', total_n, 'passed', passed,
    'perfectClear', perfect_clear, 'rc', cur_rc, 'rcGain', rc_gain);
end; $$;

-- "내 생각 다시 쓰기"(journalSheet)에서 챕터 세션 밖에서 서술답안을 저장할 때도 같은 규칙(처음
-- 글자수를 채운 순간에만 +80)으로 지급한다. lab_submit_chapter와 같은 opinionAwarded 맵을 공유해서
-- 어느 쪽으로 먼저 채우든 중복 지급되지 않는다.
create or replace function public.lab_award_opinion(p_name text, p_token text, p_chapter_id text, p_round_id text, p_text text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  gs lab_game_state%rowtype; cs lab_chapters%rowtype; round_def jsonb; min_len int := 20;
  opinion_awarded jsonb; award_key text; cur_rc int; new_data jsonb;
begin
  if not lab_check_session(p_name, p_token) then return jsonb_build_object('ok', false, 'error', '세션이 유효하지 않습니다.'); end if;
  select * into gs from lab_game_state where name = trim(p_name);
  if not found then return jsonb_build_object('ok', false, 'error', '게임 상태를 찾을 수 없습니다.'); end if;
  cur_rc := coalesce((gs.data->>'rc')::int, 0);

  select * into cs from lab_chapters where id = p_chapter_id or data->>'seedKey' = p_chapter_id limit 1;
  if found then
    select r into round_def from jsonb_array_elements(coalesce(cs.data->'rounds','[]'::jsonb)) r where r->>'id' = p_round_id limit 1;
    if round_def is not null then min_len := coalesce((round_def->>'minLen')::int, 20); end if;
  end if;

  if length(trim(coalesce(p_text,''))) < min_len then
    return jsonb_build_object('ok', true, 'awarded', false, 'rc', cur_rc);
  end if;

  opinion_awarded := coalesce(gs.data->'opinionAwarded', '{}'::jsonb);
  award_key := coalesce(cs.data->>'seedKey', p_chapter_id) || '_' || p_round_id;
  if opinion_awarded ? award_key then
    return jsonb_build_object('ok', true, 'awarded', false, 'rc', cur_rc);
  end if;

  cur_rc := cur_rc + 80;
  opinion_awarded := opinion_awarded || jsonb_build_object(award_key, true);
  new_data := gs.data;
  new_data := jsonb_set(new_data, '{rc}', to_jsonb(cur_rc));
  new_data := jsonb_set(new_data, '{opinionAwarded}', opinion_awarded);
  update lab_game_state set data = new_data, updated_at = now() where name = trim(p_name);
  insert into lab_points(name, class_no, rc, src, updated_at) values (trim(p_name), gs.class_no, cur_rc, 0, now())
    on conflict (name) do update set rc = excluded.rc, updated_at = now();
  return jsonb_build_object('ok', true, 'awarded', true, 'rc', cur_rc);
end; $$;

-- ============================================================
-- 9) 연구포인트·특별연구포인트 — 교사가 학생 계정 관리 화면에서 직접 조절
--    실제 사용(구매·가챠 등)은 학생 브라우저(localStorage)가 그대로 담당하고,
--    이 테이블은 "현재 잔액을 교사가 볼 수 있는 거울"이자 "교사가 지급/차감을 예약해두는 우편함" 역할만 한다.
--    ① 학생 클라이언트가 상태를 저장할 때마다 lab_points_sync로 현재 rc/src를 그대로 반영(거울).
--    ② 교사가 lab_points_grant로 +50, -20 같은 증감분을 예약해두면,
--    ③ 학생이 다음 로그인 때 lab_points_claim으로 그 증감분을 가져가 자기 localStorage에 더하고 반영한다.
-- ============================================================
create table if not exists public.lab_points (
  name text primary key, class_no text,
  rc int not null default 0, src int not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.lab_points enable row level security;
drop policy if exists "anyone select points" on public.lab_points;
create policy "anyone select points" on public.lab_points for select to anon using (true);

create or replace function public.lab_points_sync(p_name text, p_token text, p_class_no text, p_rc int, p_src int)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin
  if not lab_check_session(p_name, p_token) then return jsonb_build_object('ok', false, 'error', '세션이 유효하지 않습니다.'); end if;
  insert into lab_points(name, class_no, rc, src, updated_at)
    values (p_name, p_class_no, greatest(0, p_rc), greatest(0, p_src), now())
  on conflict (name) do update
    set class_no = excluded.class_no, rc = excluded.rc, src = excluded.src, updated_at = now();
  return jsonb_build_object('ok', true);
end; $$;

create table if not exists public.lab_points_grants (
  id text primary key,
  student_name text not null, class_no text,
  rc_delta int not null default 0, src_delta int not null default 0,
  note text, created_at timestamptz not null default now(),
  claimed boolean not null default false
);
alter table public.lab_points_grants enable row level security;
drop policy if exists "anyone select points grants" on public.lab_points_grants;
create policy "anyone select points grants" on public.lab_points_grants for select to anon using (true);

create or replace function public.lab_points_grant(p_teacher_password text, p_name text, p_class_no text,
  p_rc_delta int, p_src_delta int, p_note text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin
  if not lab_teacher_check(p_teacher_password) then return jsonb_build_object('ok', false, 'error', '교사 비밀번호가 올바르지 않습니다.'); end if;
  insert into lab_points_grants(id, student_name, class_no, rc_delta, src_delta, note)
    values ('pg-' || substr(md5(random()::text || clock_timestamp()::text), 1, 16),
      p_name, p_class_no, coalesce(p_rc_delta,0), coalesce(p_src_delta,0), p_note);
  return jsonb_build_object('ok', true);
end; $$;

-- 학생이 로그인 직후 자기 이름으로 부르는 함수(비밀번호 불필요 — lab_journal_save와 같은 신뢰 수준).
-- 미청구 지급분을 전부 모아서 lab_points 거울에도 즉시 반영해주고, 델타 합계를 돌려줘서
-- 학생 화면(로컬 S.rc/S.src)에 그대로 더하게 한다.
create or replace function public.lab_points_claim(p_student_name text, p_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare total_rc int; total_src int; notes text[]; gs lab_game_state%rowtype; new_rc int;
begin
  if not lab_check_session(p_student_name, p_token) then return jsonb_build_object('ok', false, 'error', '세션이 유효하지 않습니다.'); end if;
  select coalesce(sum(rc_delta),0), coalesce(sum(src_delta),0), coalesce(array_agg(note) filter (where note is not null and note <> ''), '{}')
    into total_rc, total_src, notes
    from lab_points_grants where student_name = p_student_name and claimed = false;
  if total_rc = 0 and total_src = 0 then
    return jsonb_build_object('ok', true, 'rcDelta', 0, 'srcDelta', 0, 'notes', '[]'::jsonb);
  end if;
  update lab_points_grants set claimed = true where student_name = p_student_name and claimed = false;
  update lab_points set rc = greatest(0, rc + total_rc), src = greatest(0, src + total_src), updated_at = now()
    where name = p_student_name;
  -- ⚠️ lab_state_sync가 rc를 클라이언트 말을 더 이상 안 믿게 되면서, 진짜 저장소인
  -- lab_game_state.data.rc도 여기서 직접 갱신해야 선생님이 지급한 포인트가 실제로 반영된다.
  select * into gs from lab_game_state where name=trim(p_student_name);
  if found then
    new_rc := greatest(0, coalesce((gs.data->>'rc')::int,0) + total_rc + total_src);
    update lab_game_state set data = jsonb_set(
      gs.data, '{rc}', to_jsonb(new_rc)
    ) || case when total_rc+total_src>0 then
      jsonb_build_object('totalRcEarned', coalesce((gs.data->>'totalRcEarned')::int,0) + total_rc + total_src)
    else '{}'::jsonb end, updated_at = now()
      where name = trim(p_student_name);
  end if;
  return jsonb_build_object('ok', true, 'rcDelta', total_rc, 'srcDelta', total_src, 'notes', to_jsonb(notes));
end; $$;

-- ============================================================
-- 10) 게임 상태 전체 동기화 — 연구포인트·특별연구포인트·조수·연구점수·논문기록·테마·
--     라운드별 크레딧 수령 기록·출석 기록·OX 기록을 통째로 JSON 하나에 저장.
--     로그인할 때 이걸 끌어와서 그 학생의 "가장 최근에 저장된" 게임 상태로 덮어쓴다.
--     (두 기기를 동시에 쓰지 않는다는 전제하에 마지막 저장이 항상 이긴다 — 단순한 방식)
-- ============================================================
create table if not exists public.lab_game_state (
  name text primary key, class_no text,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.lab_game_state enable row level security;
drop policy if exists "anyone select game state" on public.lab_game_state;
create policy "anyone select game state" on public.lab_game_state for select to anon using (true);

-- ⚠️ 핵심 보안 수정: 예전엔 이 함수가 클라이언트가 보낸 p_data를 통째로 그대로 믿고 저장했다.
-- 즉 학생이 개발자도구 콘솔에서 `S.rc=999999; saveLabState()` 한 줄만 쳐도 서버에 그대로 박혔다
-- (뽑기·강화 등 "행동"은 서버가 계산하도록 이미 옮겨놨지만, 그 결과가 쌓이는 저장소 자체는 여전히
-- 클라이언트가 통째로 덮어쓸 수 있는 구멍이었다 — 심지어 everPassed 같은 채점 결과까지도 이 경로로
-- 조작 가능했다). 이제 재화·채점 결과처럼 민감한 필드는, 클라이언트가 뭘 보내든 무시하고 서버에
-- 이미 저장돼 있는 값을 그대로 유지한다. 계정을 막 만들어서 아직 그 필드가 서버에 없을 때(최초 1회
-- 저장)만 클라이언트가 보낸 초기값(rc:200 등 기본값)이 그대로 들어간다.
create or replace function public.lab_state_sync(p_name text, p_token text, p_class_no text, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  cur jsonb; merged jsonb; k text;
  protected_keys text[] := array['rc','researchScore','totalResearchEarned','totalRcEarned','assistants','nobelCount','papers',
    'everPassed','everPerfect','everCorrect','opinionAwarded','claimed','deptSlots','ownedThemes','labTheme',
    'oxEverCorrect','lastAttendance'];
begin
  if not lab_check_session(p_name, p_token) then return jsonb_build_object('ok', false, 'error', '세션이 유효하지 않습니다.'); end if;
  select data into cur from lab_game_state where name=trim(p_name);
  cur := coalesce(cur, '{}'::jsonb);
  merged := coalesce(p_data, '{}'::jsonb);
  foreach k in array protected_keys loop
    if cur ? k then
      merged := jsonb_set(merged, array[k], cur->k, true);
    end if;
  end loop;
  insert into lab_game_state(name, class_no, data, updated_at)
    values (p_name, p_class_no, merged, now())
  on conflict (name) do update
    set class_no = excluded.class_no, data = excluded.data, updated_at = now();
  return jsonb_build_object('ok', true);
end; $$;

-- ============================================================
-- 서버 권위 게임 로직 (재화를 쓰는 행동은 서버가 직접 계산·저장)
-- 예전에는 클라이언트(학생 브라우저)가 뽑기·강화 등을 스스로 계산해서 최종 상태를 통보하기만
-- 해서, 개발자도구 콘솔로 그 결과값을 조작해도 서버가 그대로 믿고 저장했다. 이제부터는
-- 클라이언트가 "이 행동을 해달라"고 요청만 하고, 계산은 전부 여기(서버)에서 한다.
-- 모든 함수는 p_token(로그인 때 발급된 세션 토큰)이 그 학생의 현재 세션과 일치하는지부터 확인한다.
-- ============================================================
create or replace function public.lab_check_session(p_name text, p_token text) returns boolean
language sql stable as $$
  select exists(select 1 from lab_students where name=trim(p_name) and session_token=p_token and session_token is not null);
$$;

-- 조수(대학원생) 전체 명단 — shinjang_science.html의 ASSISTANTS_POOL과 반드시 동일하게 유지
create table if not exists public.lab_assistants_pool (
  id text primary key, theme text not null, set_id text not null, rare_draw boolean not null default false
);
alter table public.lab_assistants_pool add column if not exists name text;
truncate public.lab_assistants_pool;
alter table public.lab_assistants_pool alter column name set not null;
insert into public.lab_assistants_pool (id, name, theme, set_id, rare_draw) values
 ('a_bio1','찰스 다윈','bio','set_bio',true),('a_bio2','그레고어 멘델','bio','set_bio',false),
 ('a_bio3','제임스 왓슨','bio','set_bio',false),('a_bio4','로절린드 프랭클린','bio','set_bio',false),
 ('a_bio5','제인 구달','bio','set_bio',false),('a_bio6','루이 파스퇴르','bio','set_bio',false),
 ('a_bio7','프랜시스 크릭','bio','set_bio',false),('a_bio8','알렉산더 플레밍','bio','set_bio',false),
 ('a_bio9','바버라 매클린톡','bio','set_bio',false),('a_bio10','에드워드 제너','bio','set_bio',false),
 ('a_chem1','앙투안 라부아지에','chem','set_chem',false),('a_chem2','드미트리 멘델레예프','chem','set_chem',false),
 ('a_chem3','마리 퀴리','chem','set_chem',true),('a_chem4','라이너스 폴링','chem','set_chem',false),
 ('a_chem5','프리츠 하버','chem','set_chem',false),('a_chem6','존 돌턴','chem','set_chem',false),
 ('a_chem7','알프레드 노벨','chem','set_chem',false),('a_chem8','로버트 보일','chem','set_chem',false),
 ('a_chem9','도러시 호지킨','chem','set_chem',false),('a_chem10','스반테 아레니우스','chem','set_chem',false),
 ('a_earth1','알프레드 베게너','earth','set_earth',false),('a_earth2','찰스 라이엘','earth','set_earth',false),
 ('a_earth3','제임스 허턴','earth','set_earth',false),('a_earth4','마리 타프','earth','set_earth',false),
 ('a_earth5','밀루틴 밀란코비치','earth','set_earth',false),('a_earth6','니콜라우스 코페르니쿠스','earth','set_earth',true),
 ('a_earth7','에드워드 로렌즈','earth','set_earth',false),('a_earth8','야코브 비에르크네스','earth','set_earth',false),
 ('a_earth9','요하네스 케플러','earth','set_earth',false),('a_earth10','찬드라세카르','earth','set_earth',false),
 ('a_phys1','아이작 뉴턴','phys','set_phys',true),('a_phys2','마이클 패러데이','phys','set_phys',false),
 ('a_phys3','알베르트 아인슈타인','phys','set_phys',false),('a_phys4','제임스 클러크 맥스웰','phys','set_phys',false),
 ('a_phys5','리제 마이트너','phys','set_phys',false),('a_phys6','갈릴레오 갈릴레이','phys','set_phys',false),
 ('a_phys7','리처드 파인만','phys','set_phys',false),('a_phys8','닐스 보어','phys','set_phys',false),
 ('a_phys9','어니스트 러더퍼드','phys','set_phys',false),('a_phys10','베르너 하이젠베르크','phys','set_phys',false),
 ('a_etc1','앨런 튜링','etc','set_etc',true),('a_etc2','클로드 섀넌','etc','set_etc',false),
 ('a_etc3','에이다 러브레이스','etc','set_etc',false),('a_etc4','그레이스 호퍼','etc','set_etc',false),
 ('a_etc5','팀 버너스리','etc','set_etc',false),('a_etc6','찰스 배비지','etc','set_etc',false),
 ('a_etc7','마빈 민스키','etc','set_etc',false),('a_etc8','존 매카시','etc','set_etc',false),
 ('a_etc9','캐서린 존슨','etc','set_etc',false),('a_etc10','존 폰 노이만','etc','set_etc',false),
 ('a_davinci','레오나르도 다빈치','uni','set_universal',true),('a_uni1','알렉산더 폰 훔볼트','uni','set_universal',false),
 ('a_uni2','고트프리트 라이프니츠','uni','set_universal',false),('a_uni3','아리스토텔레스','uni','set_universal',false);
alter table public.lab_assistants_pool enable row level security;
drop policy if exists "anyone select assistants pool" on public.lab_assistants_pool;
create policy "anyone select assistants pool" on public.lab_assistants_pool for select to anon using (true);

-- 연구실 테마 가격표 — shinjang_science.html의 LAB_THEMES와 반드시 동일하게 유지
create table if not exists public.lab_themes_catalog(key text primary key, cost int not null);
truncate public.lab_themes_catalog;
insert into public.lab_themes_catalog(key,cost) values
 ('bright',0),('cozy',300),('playful',300),('classic',300),('space',400),('greenhouse',400),
 ('neon',400),('ocean',400),('snu',1000),('yonsei',1000),('korea',1000),('skku',1000),('hanyang',1000);
alter table public.lab_themes_catalog enable row level security;
drop policy if exists "anyone select themes catalog" on public.lab_themes_catalog;
create policy "anyone select themes catalog" on public.lab_themes_catalog for select to anon using (true);

-- 뽑기(가챠) — GACHA_COST=100. 학사65%·석사25%·박사9%(전설 1% 제외 나머지 99% 중 비율), 전설 1%.
-- 이미 보유한 조수가 또 나오면(중복) 30% 환급, 아니면 새로 배열에 추가.
create or replace function public.lab_gacha_pull(p_name text, p_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  gs lab_game_state%rowtype; cost int:=100; cur_rc int;
  is_legend boolean; picked record; start_degree text; roll numeric; dup boolean; refund int;
  new_data jsonb;
begin
  if not lab_check_session(p_name, p_token) then return jsonb_build_object('ok', false, 'error', '세션이 유효하지 않습니다.'); end if;
  select * into gs from lab_game_state where name=trim(p_name);
  if not found then return jsonb_build_object('ok', false, 'error', '게임 상태를 찾을 수 없습니다.'); end if;
  cur_rc := coalesce((gs.data->>'rc')::int, 0);
  if cur_rc < cost then return jsonb_build_object('ok', false, 'error', '연구포인트가 부족해요 ('||cost||' 필요)'); end if;

  is_legend := random() < 0.01;
  if is_legend then
    select id, theme into picked from lab_assistants_pool where rare_draw=true order by random() limit 1;
    start_degree := 'phd';
  else
    select id, theme into picked from lab_assistants_pool where rare_draw=false order by random() limit 1;
    roll := random()*100;
    start_degree := case when roll<=66 then 'bachelor' when roll<=91 then 'master' else 'phd' end;
  end if;

  dup := exists(select 1 from jsonb_array_elements(coalesce(gs.data->'assistants','[]'::jsonb)) a where a->>'poolId'=picked.id);
  cur_rc := cur_rc - cost;

  if dup then
    refund := round(cost*0.3);
    cur_rc := cur_rc + refund;
    new_data := jsonb_set(gs.data, '{rc}', to_jsonb(cur_rc));
    update lab_game_state set data=new_data, updated_at=now() where name=trim(p_name);
    insert into lab_points(name, class_no, rc, src, updated_at) values (trim(p_name), gs.class_no, cur_rc, 0, now())
      on conflict (name) do update set rc=excluded.rc, updated_at=now();
    return jsonb_build_object('ok', true, 'dup', true, 'refund', refund, 'rc', cur_rc, 'poolId', picked.id);
  else
    new_data := jsonb_set(jsonb_set(gs.data, '{rc}', to_jsonb(cur_rc)), '{assistants}',
      coalesce(gs.data->'assistants','[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'poolId', picked.id, 'assignedDept', null, 'lastCollectedAt', (extract(epoch from now())*1000)::bigint,
        'degree', start_degree, 'lv', 1)));
    update lab_game_state set data=new_data, updated_at=now() where name=trim(p_name);
    insert into lab_points(name, class_no, rc, src, updated_at) values (trim(p_name), gs.class_no, cur_rc, 0, now())
      on conflict (name) do update set rc=excluded.rc, updated_at=now();
    return jsonb_build_object('ok', true, 'dup', false, 'rc', cur_rc, 'poolId', picked.id, 'degree', start_degree, 'isLegend', is_legend);
  end if;
end; $$;

-- 전설뽑기 확정권 — LEGEND_TICKET_COST=8000. gacha와 동일하되 무조건 전설급.
create or replace function public.lab_legend_ticket(p_name text, p_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  gs lab_game_state%rowtype; cost int:=8000; cur_rc int; picked record; dup boolean; refund int; new_data jsonb;
begin
  if not lab_check_session(p_name, p_token) then return jsonb_build_object('ok', false, 'error', '세션이 유효하지 않습니다.'); end if;
  select * into gs from lab_game_state where name=trim(p_name);
  if not found then return jsonb_build_object('ok', false, 'error', '게임 상태를 찾을 수 없습니다.'); end if;
  cur_rc := coalesce((gs.data->>'rc')::int, 0);
  if cur_rc < cost then return jsonb_build_object('ok', false, 'error', '연구포인트가 부족해요 ('||cost||' 필요)'); end if;

  select id into picked from lab_assistants_pool where rare_draw=true order by random() limit 1;
  dup := exists(select 1 from jsonb_array_elements(coalesce(gs.data->'assistants','[]'::jsonb)) a where a->>'poolId'=picked.id);
  cur_rc := cur_rc - cost;

  if dup then
    refund := round(cost*0.3);
    cur_rc := cur_rc + refund;
    new_data := jsonb_set(gs.data, '{rc}', to_jsonb(cur_rc));
    update lab_game_state set data=new_data, updated_at=now() where name=trim(p_name);
    insert into lab_points(name, class_no, rc, src, updated_at) values (trim(p_name), gs.class_no, cur_rc, 0, now())
      on conflict (name) do update set rc=excluded.rc, updated_at=now();
    return jsonb_build_object('ok', true, 'dup', true, 'refund', refund, 'rc', cur_rc, 'poolId', picked.id);
  else
    new_data := jsonb_set(jsonb_set(gs.data, '{rc}', to_jsonb(cur_rc)), '{assistants}',
      coalesce(gs.data->'assistants','[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'poolId', picked.id, 'assignedDept', null, 'lastCollectedAt', (extract(epoch from now())*1000)::bigint,
        'degree', 'phd', 'lv', 1)));
    update lab_game_state set data=new_data, updated_at=now() where name=trim(p_name);
    insert into lab_points(name, class_no, rc, src, updated_at) values (trim(p_name), gs.class_no, cur_rc, 0, now())
      on conflict (name) do update set rc=excluded.rc, updated_at=now();
    return jsonb_build_object('ok', true, 'dup', false, 'rc', cur_rc, 'poolId', picked.id);
  end if;
end; $$;

-- 연구동 배치 슬롯 확장 — DEPT_SLOT_COST=100, 한 번 호출에 정확히 +1.
create or replace function public.lab_expand_slot(p_name text, p_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare gs lab_game_state%rowtype; cost int:=100; cur_rc int; cur_slots int; new_data jsonb;
begin
  if not lab_check_session(p_name, p_token) then return jsonb_build_object('ok', false, 'error', '세션이 유효하지 않습니다.'); end if;
  select * into gs from lab_game_state where name=trim(p_name);
  if not found then return jsonb_build_object('ok', false, 'error', '게임 상태를 찾을 수 없습니다.'); end if;
  cur_rc := coalesce((gs.data->>'rc')::int, 0);
  if cur_rc < cost then return jsonb_build_object('ok', false, 'error', '연구포인트가 부족해요 ('||cost||' 필요)'); end if;
  cur_slots := coalesce((gs.data->>'deptSlots')::int, 2) + 1;
  cur_rc := cur_rc - cost;
  new_data := jsonb_set(jsonb_set(gs.data, '{rc}', to_jsonb(cur_rc)), '{deptSlots}', to_jsonb(cur_slots));
  update lab_game_state set data=new_data, updated_at=now() where name=trim(p_name);
  insert into lab_points(name, class_no, rc, src, updated_at) values (trim(p_name), gs.class_no, cur_rc, 0, now())
    on conflict (name) do update set rc=excluded.rc, updated_at=now();
  return jsonb_build_object('ok', true, 'rc', cur_rc, 'deptSlots', cur_slots);
end; $$;

-- 재도전권(문제 리롤) — REROLL_COST=50. 어떤 문제로 바뀌는지는 클라이언트가 정하고(무작위라 조작해도
-- 이득이 없음), 여기서는 정말로 50점이 깎이는지만 서버가 보장한다.
create or replace function public.lab_reroll_charge(p_name text, p_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare gs lab_game_state%rowtype; cost int:=50; cur_rc int; new_data jsonb;
begin
  if not lab_check_session(p_name, p_token) then return jsonb_build_object('ok', false, 'error', '세션이 유효하지 않습니다.'); end if;
  select * into gs from lab_game_state where name=trim(p_name);
  if not found then return jsonb_build_object('ok', false, 'error', '게임 상태를 찾을 수 없습니다.'); end if;
  cur_rc := coalesce((gs.data->>'rc')::int, 0);
  if cur_rc < cost then return jsonb_build_object('ok', false, 'error', '연구포인트가 부족해요 ('||cost||' 필요)'); end if;
  cur_rc := cur_rc - cost;
  new_data := jsonb_set(gs.data, '{rc}', to_jsonb(cur_rc));
  update lab_game_state set data=new_data, updated_at=now() where name=trim(p_name);
  insert into lab_points(name, class_no, rc, src, updated_at) values (trim(p_name), gs.class_no, cur_rc, 0, now())
    on conflict (name) do update set rc=excluded.rc, updated_at=now();
  return jsonb_build_object('ok', true, 'rc', cur_rc);
end; $$;

-- 출석 보너스(하루 1회 +30🔬) — 예전엔 클라이언트가 오늘 날짜인지만 스스로 확인하고 S.rc+=30을
-- 직접 했는데, lab_state_sync가 rc/lastAttendance를 더 이상 클라이언트 말을 안 믿게 되면서
-- 이 보상도 서버 함수가 직접 줘야 실제로 적립된다. 날짜는 한국 시간(Asia/Seoul) 기준.
create or replace function public.lab_attendance_claim(p_name text, p_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare gs lab_game_state%rowtype; cur_rc int; total_rc int; today text; new_data jsonb;
begin
  if not lab_check_session(p_name, p_token) then return jsonb_build_object('ok', false, 'error', '세션이 유효하지 않습니다.'); end if;
  select * into gs from lab_game_state where name=trim(p_name);
  if not found then return jsonb_build_object('ok', false, 'error', '게임 상태를 찾을 수 없습니다.'); end if;
  today := to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD');
  if coalesce(gs.data->>'lastAttendance','') = today then
    return jsonb_build_object('ok', false, 'error', '오늘은 이미 받았어요');
  end if;
  cur_rc := coalesce((gs.data->>'rc')::int, 0) + 30;
  total_rc := coalesce((gs.data->>'totalRcEarned')::int, 0) + 30;
  new_data := jsonb_set(jsonb_set(jsonb_set(gs.data, '{rc}', to_jsonb(cur_rc)), '{lastAttendance}', to_jsonb(today)), '{totalRcEarned}', to_jsonb(total_rc));
  update lab_game_state set data=new_data, updated_at=now() where name=trim(p_name);
  insert into lab_points(name, class_no, rc, src, updated_at) values (trim(p_name), gs.class_no, cur_rc, 0, now())
    on conflict (name) do update set rc=excluded.rc, updated_at=now();
  return jsonb_build_object('ok', true, 'rc', cur_rc);
end; $$;

-- ============================================================
-- OX 퀴즈 — 정답(answer)이 담긴 원본 data/ox_questions.json이 공개 정적 파일이라
-- 개발자도구 네트워크 탭에서 그대로 보였다. 이제 문장(stmt)만 공개 파일에 남기고,
-- 정답·해설은 이 비공개 테이블에서 서버가 직접 채점할 때만 확인한다.
-- ============================================================
create table if not exists public.lab_ox_bank (
  ch_num text primary key,
  data jsonb not null default '[]'::jsonb -- [{stmt, answer(bool), explain}, ...]
);
alter table public.lab_ox_bank enable row level security;
drop policy if exists "anyone select ox bank" on public.lab_ox_bank;
-- 정답이 들어있으므로 공개 조회는 허용하지 않는다(교사 저장 + 서버 채점 함수만 접근).

create or replace function public.lab_ox_bank_save(p_teacher_password text, p_ch_num text, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin
  if not lab_teacher_check(p_teacher_password) then return jsonb_build_object('ok', false, 'error', '교사 비밀번호가 올바르지 않습니다.'); end if;
  insert into lab_ox_bank(ch_num, data) values (p_ch_num, p_data)
    on conflict (ch_num) do update set data = excluded.data;
  return jsonb_build_object('ok', true);
end; $$;

-- 학생이 고른 답(p_picked)을 서버가 가진 정답과 대조해서만 채점한다. 같은 문장은 하루가 아니라
-- 영구적으로 1회만 보상(everSet 방식, 기존 클라이언트 로직과 동일한 중복방지 키를 그대로 씀).
create or replace function public.lab_ox_answer(p_name text, p_token text, p_ch_num text, p_stmt text, p_picked boolean)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  gs lab_game_state%rowtype; bank jsonb; item jsonb; correct_answer boolean; explain_text text;
  ever jsonb; ever_set jsonb; cur_rc int; total_rc int; new_data jsonb; already boolean := false; i int;
begin
  if not lab_check_session(p_name, p_token) then return jsonb_build_object('ok', false, 'error', '세션이 유효하지 않습니다.'); end if;
  select data into bank from lab_ox_bank where ch_num=p_ch_num;
  if bank is null then return jsonb_build_object('ok', false, 'error', '문제 데이터를 찾을 수 없습니다.'); end if;
  for i in 0..jsonb_array_length(bank)-1 loop
    item := bank->i;
    if item->>'stmt' = p_stmt then
      correct_answer := (item->>'answer')::boolean;
      explain_text := item->>'explain';
    end if;
  end loop;
  if correct_answer is null then return jsonb_build_object('ok', false, 'error', '존재하지 않는 문제입니다.'); end if;

  select * into gs from lab_game_state where name=trim(p_name);
  if not found then return jsonb_build_object('ok', false, 'error', '게임 상태를 찾을 수 없습니다.'); end if;
  ever := coalesce(gs.data->'oxEverCorrect', '{}'::jsonb);
  ever_set := coalesce(ever->p_ch_num, '[]'::jsonb);
  if ever_set ? p_stmt then already := true; end if;

  new_data := gs.data;
  if p_picked = correct_answer and not already then
    ever_set := ever_set || to_jsonb(p_stmt);
    ever := jsonb_set(ever, array[p_ch_num], ever_set, true);
    cur_rc := coalesce((gs.data->>'rc')::int, 0) + 10;
    total_rc := coalesce((gs.data->>'totalRcEarned')::int, 0) + 10;
    new_data := jsonb_set(new_data, '{oxEverCorrect}', ever);
    new_data := jsonb_set(new_data, '{rc}', to_jsonb(cur_rc));
    new_data := jsonb_set(new_data, '{totalRcEarned}', to_jsonb(total_rc));
    update lab_game_state set data=new_data, updated_at=now() where name=trim(p_name);
    insert into lab_points(name, class_no, rc, src, updated_at) values (trim(p_name), gs.class_no, cur_rc, 0, now())
      on conflict (name) do update set rc=excluded.rc, updated_at=now();
  else
    cur_rc := coalesce((gs.data->>'rc')::int, 0);
  end if;
  return jsonb_build_object('ok', true, 'correct', p_picked=correct_answer, 'explain', explain_text, 'rc', cur_rc, 'alreadyCredited', already);
end; $$;

-- 강화(레벨업) — 비용은 학위 기본값×(1+(lv-1)*0.6). 실패 시 대부분 그대로, 10% 확률로 조수가 떠남.
-- Lv.5에서 성공하면 다음 학위로 승급(박사는 승급 없이 레벨만 계속 오름).
create or replace function public.lab_enhance(p_name text, p_token text, p_idx int)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  gs lab_game_state%rowtype; assistants jsonb; inst jsonb; degree text; lv int; enh_cost int; cost int;
  success_rate numeric; cur_rc int; success boolean; leaves boolean;
  new_assistants jsonb; new_data jsonb; kind text; new_lv int; new_degree text; line text; aname text;
begin
  if not lab_check_session(p_name, p_token) then return jsonb_build_object('ok', false, 'error', '세션이 유효하지 않습니다.'); end if;
  select * into gs from lab_game_state where name=trim(p_name);
  if not found then return jsonb_build_object('ok', false, 'error', '게임 상태를 찾을 수 없습니다.'); end if;
  assistants := coalesce(gs.data->'assistants', '[]'::jsonb);
  if p_idx is null or p_idx<0 or p_idx>=jsonb_array_length(assistants) then return jsonb_build_object('ok', false, 'error', '존재하지 않는 조수입니다.'); end if;
  inst := assistants->p_idx;
  if inst->>'assignedDept' is not null then return jsonb_build_object('ok', false, 'error', '연구동에 배치된 조수는 강화할 수 없어요. 먼저 로비로 불러오세요.'); end if;
  degree := coalesce(inst->>'degree','bachelor');
  lv := coalesce((inst->>'lv')::int, 1);
  select name into aname from lab_assistants_pool where id=inst->>'poolId';
  enh_cost := case degree when 'bachelor' then 10 when 'master' then 25 when 'phd' then 50 else 10 end;
  cost := round(enh_cost*(1+(lv-1)*0.6));
  cur_rc := coalesce((gs.data->>'rc')::int, 0);
  if cur_rc < cost then return jsonb_build_object('ok', false, 'error', '연구포인트가 부족해요 ('||cost||' 필요)'); end if;

  if lv<=5 then success_rate := (array[.90,.75,.60,.45,.30])[lv];
  else success_rate := greatest(0.02, 0.30*power(0.8, lv-5)); end if;

  cur_rc := cur_rc - cost;
  success := random() < success_rate;

  if not success then
    leaves := random() < 0.1;
    if not leaves then
      new_data := jsonb_set(gs.data, '{rc}', to_jsonb(cur_rc));
      kind := 'fail-stay';
    else
      new_assistants := assistants - p_idx;
      new_data := jsonb_set(jsonb_set(gs.data, '{rc}', to_jsonb(cur_rc)), '{assistants}', new_assistants);
      kind := 'fail-leave';
      line := (array['함께해서 더러웠고 다신 만나지 말자','저는 자유로운 집요정이에요!','이 구역은 이제 안녕, 저는 떠납니다',
        '그동안 고마웠어요, 두 번 다시는 안 볼 사이예요','나만 없어 워라밸... 이제 저부터 챙길게요','이건 제 최종 결정입니다. 안녕히',
        '다음 생에는 다른 연구실에서 만나요','저 그만할래요. 총총','인연이 아니었나 봐요, 여기까지가 제 최선이었어요',
        '저는 이 연구실 그만두고 유튜버 할게요'])[floor(random()*10+1)::int];
    end if;
  else
    if lv>=5 and degree<>'phd' then
      new_degree := case degree when 'bachelor' then 'master' else 'phd' end;
      new_lv := 1; kind := 'success-promote';
    else
      new_degree := degree; new_lv := lv+1; kind := 'success-lv';
    end if;
    inst := jsonb_set(jsonb_set(inst, '{degree}', to_jsonb(new_degree)), '{lv}', to_jsonb(new_lv));
    new_assistants := jsonb_set(assistants, array[p_idx::text], inst);
    new_data := jsonb_set(jsonb_set(gs.data, '{rc}', to_jsonb(cur_rc)), '{assistants}', new_assistants);
  end if;

  update lab_game_state set data=new_data, updated_at=now() where name=trim(p_name);
  insert into lab_points(name, class_no, rc, src, updated_at) values (trim(p_name), gs.class_no, cur_rc, 0, now())
    on conflict (name) do update set rc=excluded.rc, updated_at=now();
  return jsonb_build_object('ok', true, 'kind', kind, 'rc', cur_rc, 'degree', new_degree, 'lv', new_lv, 'line', line, 'leftDegree', degree, 'name', aname);
end; $$;

-- 조수를 연구동에 배치/해제 — 배치 슬롯 한도를 서버가 직접 검사한다.
create or replace function public.lab_assign(p_name text, p_token text, p_idx int, p_dept_id text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare gs lab_game_state%rowtype; assistants jsonb; inst jsonb; cur_dept text; assigned_count int; slots int; new_assistants jsonb;
begin
  if not lab_check_session(p_name, p_token) then return jsonb_build_object('ok', false, 'error', '세션이 유효하지 않습니다.'); end if;
  select * into gs from lab_game_state where name=trim(p_name);
  if not found then return jsonb_build_object('ok', false, 'error', '게임 상태를 찾을 수 없습니다.'); end if;
  assistants := coalesce(gs.data->'assistants', '[]'::jsonb);
  if p_idx is null or p_idx<0 or p_idx>=jsonb_array_length(assistants) then return jsonb_build_object('ok', false, 'error', '존재하지 않는 조수입니다.'); end if;
  inst := assistants->p_idx;
  cur_dept := inst->>'assignedDept';
  slots := coalesce((gs.data->>'deptSlots')::int, 2);
  if p_dept_id is not null and p_dept_id<>'' and cur_dept is null then
    select count(*) into assigned_count from jsonb_array_elements(assistants) a where a->>'assignedDept' is not null;
    if assigned_count >= slots then
      return jsonb_build_object('ok', false, 'error', '배치 슬롯이 가득 찼어요 ('||slots||'개) · 슬롯을 확장해보세요');
    end if;
  end if;
  inst := jsonb_set(inst, '{assignedDept}', case when p_dept_id is null or p_dept_id='' then 'null'::jsonb else to_jsonb(p_dept_id) end);
  inst := jsonb_set(inst, '{lastCollectedAt}', to_jsonb((extract(epoch from now())*1000)::bigint));
  new_assistants := jsonb_set(assistants, array[p_idx::text], inst);
  update lab_game_state set data=jsonb_set(gs.data,'{assistants}',new_assistants), updated_at=now() where name=trim(p_name);
  return jsonb_build_object('ok', true, 'assignedDept', p_dept_id);
end; $$;

-- 연구동에 배치된 조수의 생산량 수거 — "자동 복귀"(최대치 채움)와 "로비로 돌아오게 하기"(강제 수거)
-- 둘 다 이 함수 하나로 처리한다. 예전엔 클라이언트가 rate·cap(레벨/전공배치/세트효과/전설버프
-- 배율까지 전부)을 스스로 계산해서 그 결과(amt)만 서버에 통보했는데, 개발자도구로 그 계산 결과를
-- 얼마든지 부풀릴 수 있었다. 이제 레벨·배치·세트·전설버프 배율을 전부 서버가 직접 다시 계산한다.
create or replace function public.lab_collect_dept_production(p_name text, p_token text, p_idx int)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  gs lab_game_state%rowtype; assistants jsonb; inst jsonb; degree text; is_rare boolean; a_theme text;
  dept_id text; lv int; base_rate numeric; lv_mult numeric; legend_mult numeric;
  dept_mult numeric := 1; legend_buff_mult numeric := 1; theme_mult numeric; owned_count int;
  now_ms bigint; last_ms bigint; hours numeric; rate numeric; cap numeric; amt int; cur_rc int; total_rc int;
  new_assistants jsonb; new_data jsonb; j int; other jsonb; other_rare boolean; other_theme text;
  dept_majors jsonb := '{"d1":["earth","bio"],"d2":["chem"],"d3":["bio","earth"],"d4":["phys"],"d5":["etc"],"d6":["etc"]}'::jsonb;
begin
  if not lab_check_session(p_name, p_token) then return jsonb_build_object('ok', false, 'error', '세션이 유효하지 않습니다.'); end if;
  select * into gs from lab_game_state where name=trim(p_name);
  if not found then return jsonb_build_object('ok', false, 'error', '게임 상태를 찾을 수 없습니다.'); end if;
  assistants := coalesce(gs.data->'assistants', '[]'::jsonb);
  if p_idx is null or p_idx<0 or p_idx>=jsonb_array_length(assistants) then return jsonb_build_object('ok', false, 'error', '존재하지 않는 조수입니다.'); end if;
  inst := assistants->p_idx;
  dept_id := inst->>'assignedDept';
  if dept_id is null then return jsonb_build_object('ok', false, 'error', '연구동에 배치되지 않았어요.'); end if;
  degree := coalesce(inst->>'degree','bachelor');
  lv := coalesce((inst->>'lv')::int, 1);
  select rare_draw, theme into is_rare, a_theme from lab_assistants_pool where id=inst->>'poolId';

  case degree when 'bachelor' then base_rate:=20; when 'master' then base_rate:=35; else base_rate:=60; end case;
  lv_mult := 1+(lv-1)*0.15;
  legend_mult := case when is_rare then 2.2 else 1 end;
  if a_theme='uni' or (dept_majors ? dept_id and dept_majors->dept_id ? a_theme) then dept_mult := 1.2; end if;

  for j in 0..jsonb_array_length(assistants)-1 loop
    if j<>p_idx then
      other := assistants->j;
      if other->>'assignedDept' = dept_id then
        select rare_draw, theme into other_rare, other_theme from lab_assistants_pool where id=other->>'poolId';
        if other_rare and other_theme<>'uni' and dept_majors ? dept_id and dept_majors->dept_id ? other_theme then
          legend_buff_mult := 1.5;
        end if;
      end if;
    end if;
  end loop;

  select count(*) into owned_count from jsonb_array_elements(assistants) a
    join lab_assistants_pool p on p.id = a->>'poolId' where p.theme = a_theme;
  theme_mult := power(1.2::numeric, greatest(0, owned_count-1));

  rate := base_rate * lv_mult * legend_mult * dept_mult * legend_buff_mult * theme_mult;
  cap := rate; -- 코드 규칙상 cap은 rate와 항상 같은 배율(1시간이면 최대치)

  now_ms := (extract(epoch from now())*1000)::bigint;
  last_ms := coalesce((inst->>'lastCollectedAt')::bigint, 0);
  hours := greatest(0, (now_ms-last_ms)/3600000.0);
  amt := least(round(hours*rate)::int, round(cap)::int);

  cur_rc := coalesce((gs.data->>'rc')::int, 0) + amt;
  total_rc := coalesce((gs.data->>'totalRcEarned')::int, 0) + amt;
  inst := jsonb_set(inst, '{assignedDept}', 'null'::jsonb);
  inst := jsonb_set(inst, '{lastCollectedAt}', to_jsonb(now_ms));
  new_assistants := jsonb_set(assistants, array[p_idx::text], inst);
  new_data := jsonb_set(jsonb_set(jsonb_set(gs.data, '{assistants}', new_assistants), '{rc}', to_jsonb(cur_rc)), '{totalRcEarned}', to_jsonb(total_rc));
  update lab_game_state set data=new_data, updated_at=now() where name=trim(p_name);
  insert into lab_points(name, class_no, rc, src, updated_at) values (trim(p_name), gs.class_no, cur_rc, 0, now())
    on conflict (name) do update set rc=excluded.rc, updated_at=now();
  return jsonb_build_object('ok', true, 'rc', cur_rc, 'amt', amt);
end; $$;

-- 조수 해고 — 배치 여부와 상관없이 목록에서 제거하고, 학위(degree)별로 정해진 만큼 연구포인트(rc)를
-- 일부 돌려준다(투자한 강화 비용의 대략적인 환급 개념). 전설급은 항상 phd로 시작하므로 phd 환급액을 쓴다.
create or replace function public.lab_dismiss(p_name text, p_token text, p_idx int)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  gs lab_game_state%rowtype; assistants jsonb; inst jsonb; degree text; refund int; cur_rc int; total_rc int; new_assistants jsonb; aname text;
begin
  if not lab_check_session(p_name, p_token) then return jsonb_build_object('ok', false, 'error', '세션이 유효하지 않습니다.'); end if;
  select * into gs from lab_game_state where name=trim(p_name);
  if not found then return jsonb_build_object('ok', false, 'error', '게임 상태를 찾을 수 없습니다.'); end if;
  assistants := coalesce(gs.data->'assistants', '[]'::jsonb);
  if p_idx is null or p_idx<0 or p_idx>=jsonb_array_length(assistants) then return jsonb_build_object('ok', false, 'error', '존재하지 않는 조수입니다.'); end if;
  inst := assistants->p_idx;
  if inst->>'assignedDept' is not null then return jsonb_build_object('ok', false, 'error', '연구동에 배치된 조수는 해고할 수 없어요. 먼저 로비로 불러오세요.'); end if;
  degree := coalesce(inst->>'degree','bachelor');
  select name into aname from lab_assistants_pool where id=inst->>'poolId';
  case degree
    when 'bachelor' then refund := 50;
    when 'master' then refund := 120;
    else refund := 250; -- phd(전설급 포함)
  end case;
  cur_rc := coalesce((gs.data->>'rc')::int, 0) + refund;
  total_rc := coalesce((gs.data->>'totalRcEarned')::int, 0) + refund;
  new_assistants := assistants - p_idx;
  update lab_game_state set data = jsonb_set(jsonb_set(jsonb_set(gs.data,'{assistants}',new_assistants),'{rc}',to_jsonb(cur_rc)),'{totalRcEarned}',to_jsonb(total_rc)), updated_at=now() where name=trim(p_name);
  insert into lab_points(name, class_no, rc, src, updated_at) values (trim(p_name), gs.class_no, cur_rc, 0, now())
    on conflict (name) do update set rc=excluded.rc, updated_at=now();
  return jsonb_build_object('ok', true, 'rc', cur_rc, 'refund', refund, 'assistantName', aname);
end; $$;

-- 논문 완성 점수(연구점수) 계산 — 학위(degree)별 범위 안에서 무작위로 뽑는다(원래 의도대로
-- 유지 — 랜덤성 자체가 재미 요소). 전설급(is_rare)은 학위와 무관하게 별도 범위를 쓴다.
-- lab_instant_paper / lab_collect_paper / lab_collect_all_papers 세 곳에서 공통으로 쓴다.
create or replace function public.lab_paper_score(p_degree text, p_is_rare boolean, out score int, out nobel boolean)
language plpgsql as $$
declare lo int; hi int;
begin
  if p_is_rare then lo:=100; hi:=200;
  else
    case p_degree
      when 'bachelor' then lo:=10; hi:=50;
      when 'master' then lo:=30; hi:=100;
      else lo:=60; hi:=180; -- phd
    end case;
  end if;
  score := lo + floor(random()*(hi-lo+1))::int;
  nobel := score > 170;
end; $$;

-- 연구포인트로 즉시 논문 작성(150🔬, 24시간 대기 없이 바로 완성).
create or replace function public.lab_instant_paper(p_name text, p_token text, p_idx int)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  gs lab_game_state%rowtype; assistants jsonb; inst jsonb; degree text; is_rare boolean; cur_rc int; cost int:=150;
  score int; nobel boolean; new_assistants jsonb; new_data jsonb; rs int; total_earned int; nobel_count int; papers jsonb;
  aname text; atheme text; now_ms bigint;
begin
  if not lab_check_session(p_name, p_token) then return jsonb_build_object('ok', false, 'error', '세션이 유효하지 않습니다.'); end if;
  select * into gs from lab_game_state where name=trim(p_name);
  if not found then return jsonb_build_object('ok', false, 'error', '게임 상태를 찾을 수 없습니다.'); end if;
  assistants := coalesce(gs.data->'assistants', '[]'::jsonb);
  if p_idx is null or p_idx<0 or p_idx>=jsonb_array_length(assistants) then return jsonb_build_object('ok', false, 'error', '존재하지 않는 조수입니다.'); end if;
  inst := assistants->p_idx;
  if inst->>'assignedDept' is not null then return jsonb_build_object('ok', false, 'error', '연구동에 배치된 조수예요.'); end if;
  cur_rc := coalesce((gs.data->>'rc')::int, 0);
  if cur_rc < cost then return jsonb_build_object('ok', false, 'error', '연구포인트가 부족해요 ('||cost||' 필요)'); end if;

  degree := coalesce(inst->>'degree','bachelor');
  select rare_draw, name, theme into is_rare, aname, atheme from lab_assistants_pool where id=inst->>'poolId';
  select ps.score, ps.nobel into score, nobel from lab_paper_score(degree, is_rare) ps;
  now_ms := (extract(epoch from now())*1000)::bigint;

  cur_rc := cur_rc - cost;
  inst := jsonb_set(inst, '{lastCollectedAt}', to_jsonb(now_ms));
  new_assistants := jsonb_set(assistants, array[p_idx::text], inst);
  rs := coalesce((gs.data->>'researchScore')::int,0) + score;
  total_earned := coalesce((gs.data->>'totalResearchEarned')::int,0) + score;
  nobel_count := coalesce((gs.data->>'nobelCount')::int,0) + (case when nobel then 1 else 0 end);
  papers := coalesce(gs.data->'papers','[]'::jsonb) || jsonb_build_array(jsonb_build_object(
    'title','「연구 성과 보고서」','theme', atheme, 'assistantName', aname, 'degree', degree, 'score', score, 'nobel', nobel, 'at', now_ms));
  new_data := gs.data;
  new_data := jsonb_set(new_data, '{rc}', to_jsonb(cur_rc));
  new_data := jsonb_set(new_data, '{assistants}', new_assistants);
  new_data := jsonb_set(new_data, '{researchScore}', to_jsonb(rs));
  new_data := jsonb_set(new_data, '{totalResearchEarned}', to_jsonb(total_earned));
  new_data := jsonb_set(new_data, '{nobelCount}', to_jsonb(nobel_count));
  new_data := jsonb_set(new_data, '{papers}', papers);
  update lab_game_state set data=new_data, updated_at=now() where name=trim(p_name);
  insert into lab_points(name, class_no, rc, src, updated_at) values (trim(p_name), gs.class_no, cur_rc, 0, now())
    on conflict (name) do update set rc=excluded.rc, updated_at=now();
  return jsonb_build_object('ok', true, 'rc', cur_rc, 'score', score, 'nobel', nobel, 'researchScore', rs, 'title', '「연구 성과 보고서」', 'assistantName', aname);
end; $$;

-- 무료 논문 수거(24시간 지난 것만) — 서버가 직접 24시간 경과를 검사한다.
create or replace function public.lab_collect_paper(p_name text, p_token text, p_idx int)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  gs lab_game_state%rowtype; assistants jsonb; inst jsonb; degree text; is_rare boolean;
  score int; nobel boolean; new_assistants jsonb; new_data jsonb; rs int; total_earned int; nobel_count int; papers jsonb;
  last_collected bigint; hours_elapsed numeric; aname text; atheme text; now_ms bigint;
begin
  if not lab_check_session(p_name, p_token) then return jsonb_build_object('ok', false, 'error', '세션이 유효하지 않습니다.'); end if;
  select * into gs from lab_game_state where name=trim(p_name);
  if not found then return jsonb_build_object('ok', false, 'error', '게임 상태를 찾을 수 없습니다.'); end if;
  assistants := coalesce(gs.data->'assistants', '[]'::jsonb);
  if p_idx is null or p_idx<0 or p_idx>=jsonb_array_length(assistants) then return jsonb_build_object('ok', false, 'error', '존재하지 않는 조수입니다.'); end if;
  inst := assistants->p_idx;
  if inst->>'assignedDept' is not null then return jsonb_build_object('ok', false, 'error', '연구동에 배치된 조수예요.'); end if;
  now_ms := (extract(epoch from now())*1000)::bigint;
  last_collected := coalesce((inst->>'lastCollectedAt')::bigint, 0);
  hours_elapsed := (now_ms - last_collected) / 3600000.0;
  if hours_elapsed < 24 then return jsonb_build_object('ok', false, 'error', '아직 24시간이 안 지났어요'); end if;

  degree := coalesce(inst->>'degree','bachelor');
  select rare_draw, name, theme into is_rare, aname, atheme from lab_assistants_pool where id=inst->>'poolId';
  select ps.score, ps.nobel into score, nobel from lab_paper_score(degree, is_rare) ps;

  inst := jsonb_set(inst, '{lastCollectedAt}', to_jsonb(now_ms));
  new_assistants := jsonb_set(assistants, array[p_idx::text], inst);
  rs := coalesce((gs.data->>'researchScore')::int,0) + score;
  total_earned := coalesce((gs.data->>'totalResearchEarned')::int,0) + score;
  nobel_count := coalesce((gs.data->>'nobelCount')::int,0) + (case when nobel then 1 else 0 end);
  papers := coalesce(gs.data->'papers','[]'::jsonb) || jsonb_build_array(jsonb_build_object(
    'title','「연구 성과 보고서」','theme', atheme, 'assistantName', aname, 'degree', degree, 'score', score, 'nobel', nobel, 'at', now_ms));
  new_data := gs.data;
  new_data := jsonb_set(new_data, '{assistants}', new_assistants);
  new_data := jsonb_set(new_data, '{researchScore}', to_jsonb(rs));
  new_data := jsonb_set(new_data, '{totalResearchEarned}', to_jsonb(total_earned));
  new_data := jsonb_set(new_data, '{nobelCount}', to_jsonb(nobel_count));
  new_data := jsonb_set(new_data, '{papers}', papers);
  update lab_game_state set data=new_data, updated_at=now() where name=trim(p_name);
  return jsonb_build_object('ok', true, 'score', score, 'nobel', nobel, 'researchScore', rs, 'title', '「연구 성과 보고서」', 'assistantName', aname);
end; $$;

-- 완성된 논문(24시간 지난 것) 전부 한 번에 수거.
create or replace function public.lab_collect_all_papers(p_name text, p_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  gs lab_game_state%rowtype; assistants jsonb; inst jsonb; i int; n int;
  degree text; is_rare boolean; score int; nobel boolean;
  rs int; total_earned int; nobel_count int; papers jsonb; collected jsonb := '[]'::jsonb;
  last_collected bigint; hours_elapsed numeric; aname text; atheme text; now_ms bigint;
begin
  if not lab_check_session(p_name, p_token) then return jsonb_build_object('ok', false, 'error', '세션이 유효하지 않습니다.'); end if;
  select * into gs from lab_game_state where name=trim(p_name);
  if not found then return jsonb_build_object('ok', false, 'error', '게임 상태를 찾을 수 없습니다.'); end if;
  assistants := coalesce(gs.data->'assistants', '[]'::jsonb);
  n := jsonb_array_length(assistants);
  rs := coalesce((gs.data->>'researchScore')::int,0);
  total_earned := coalesce((gs.data->>'totalResearchEarned')::int,0);
  nobel_count := coalesce((gs.data->>'nobelCount')::int,0);
  papers := coalesce(gs.data->'papers','[]'::jsonb);
  now_ms := (extract(epoch from now())*1000)::bigint;

  for i in 0..n-1 loop
    inst := assistants->i;
    if inst->>'assignedDept' is null then
      last_collected := coalesce((inst->>'lastCollectedAt')::bigint, 0);
      hours_elapsed := (now_ms - last_collected) / 3600000.0;
      if hours_elapsed >= 24 then
        degree := coalesce(inst->>'degree','bachelor');
        select rare_draw, name, theme into is_rare, aname, atheme from lab_assistants_pool where id=inst->>'poolId';
        select ps.score, ps.nobel into score, nobel from lab_paper_score(degree, is_rare) ps;
        inst := jsonb_set(inst, '{lastCollectedAt}', to_jsonb(now_ms));
        assistants := jsonb_set(assistants, array[i::text], inst);
        rs := rs + score;
        total_earned := total_earned + score;
        if nobel then nobel_count := nobel_count + 1; end if;
        papers := papers || jsonb_build_array(jsonb_build_object(
          'title','「연구 성과 보고서」','theme', atheme, 'assistantName', aname, 'degree', degree, 'score', score, 'nobel', nobel, 'at', now_ms));
        collected := collected || jsonb_build_array(jsonb_build_object('assistantName', aname, 'score', score, 'nobel', nobel,
          'title', '「연구 성과 보고서」', 'theme', atheme, 'degree', degree, 'at', now_ms));
      end if;
    end if;
  end loop;

  if jsonb_array_length(collected) = 0 then
    return jsonb_build_object('ok', false, 'error', '지금 수거할 수 있는 논문이 없어요');
  end if;

  update lab_game_state set data=(
    (gs.data - 'assistants' - 'researchScore' - 'totalResearchEarned' - 'nobelCount' - 'papers')
    || jsonb_build_object('assistants', assistants, 'researchScore', rs, 'totalResearchEarned', total_earned, 'nobelCount', nobel_count, 'papers', papers)
  ), updated_at=now() where name=trim(p_name);
  return jsonb_build_object('ok', true, 'collected', collected, 'researchScore', rs);
end; $$;

-- 연구실 테마 구매/전환 — 이미 보유했으면 무료로 전환만, 아니면 구매.
create or replace function public.lab_buy_theme(p_name text, p_token text, p_key text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare gs lab_game_state%rowtype; v_cost int; cur_rc int; owned jsonb; new_data jsonb;
begin
  if not lab_check_session(p_name, p_token) then return jsonb_build_object('ok', false, 'error', '세션이 유효하지 않습니다.'); end if;
  select cost into v_cost from lab_themes_catalog where key=p_key;
  if v_cost is null then return jsonb_build_object('ok', false, 'error', '존재하지 않는 테마입니다.'); end if;
  select * into gs from lab_game_state where name=trim(p_name);
  if not found then return jsonb_build_object('ok', false, 'error', '게임 상태를 찾을 수 없습니다.'); end if;
  owned := coalesce(gs.data->'ownedThemes', '["bright"]'::jsonb);
  if owned @> to_jsonb(p_key) then
    update lab_game_state set data=jsonb_set(gs.data,'{labTheme}',to_jsonb(p_key)), updated_at=now() where name=trim(p_name);
    return jsonb_build_object('ok', true, 'alreadyOwned', true, 'labTheme', p_key);
  end if;
  cur_rc := coalesce((gs.data->>'rc')::int, 0);
  if cur_rc < v_cost then return jsonb_build_object('ok', false, 'error', '연구포인트가 부족해요 ('||v_cost||' 필요)'); end if;
  cur_rc := cur_rc - v_cost;
  owned := owned || jsonb_build_array(p_key);
  new_data := gs.data;
  new_data := jsonb_set(new_data, '{rc}', to_jsonb(cur_rc));
  new_data := jsonb_set(new_data, '{ownedThemes}', owned);
  new_data := jsonb_set(new_data, '{labTheme}', to_jsonb(p_key));
  update lab_game_state set data=new_data, updated_at=now() where name=trim(p_name);
  insert into lab_points(name, class_no, rc, src, updated_at) values (trim(p_name), gs.class_no, cur_rc, 0, now())
    on conflict (name) do update set rc=excluded.rc, updated_at=now();
  return jsonb_build_object('ok', true, 'alreadyOwned', false, 'rc', cur_rc, 'labTheme', p_key);
end; $$;

-- ============================================================
-- anon 롤에게 위 함수들을 호출할 권한 부여(테이블 직접 권한은 안 줌 — RLS+정책만으로 제어)
-- ============================================================
grant execute on all functions in schema public to anon, authenticated;
