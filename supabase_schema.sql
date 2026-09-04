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

create or replace function public.lab_journal_save(p_student_name text, p_class_no text, p_chapter_id text,
  p_chapter_title text, p_round_id text, p_round_title text, p_text text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin
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
alter table public.lab_scores enable row level security;
drop policy if exists "anyone select scores" on public.lab_scores;
create policy "anyone select scores" on public.lab_scores for select to anon using (true);

create or replace function public.lab_score_upsert(p_name text, p_class_no text, p_research_score int)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin
  insert into lab_scores(name, class_no, research_score, updated_at)
    values (p_name, p_class_no, greatest(0, p_research_score), now())
  on conflict (name) do update set class_no = excluded.class_no, research_score = excluded.research_score, updated_at = now();
  return jsonb_build_object('ok', true);
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
-- 8) 단원(챕터) 문제 데이터 — 전체 공개 조회(학생이 문제를 받아야 하니까), 저장은 교사만
-- ============================================================
create table if not exists public.lab_chapters (
  id text primary key,  -- 'ch10' 형태
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.lab_chapters enable row level security;
drop policy if exists "anyone select chapters" on public.lab_chapters;
create policy "anyone select chapters" on public.lab_chapters for select to anon using (true);

create or replace function public.lab_chapter_save(p_teacher_password text, p_id text, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin
  if not lab_teacher_check(p_teacher_password) then return jsonb_build_object('ok', false, 'error', '교사 비밀번호가 올바르지 않습니다.'); end if;
  insert into lab_chapters(id, data, updated_at) values (p_id, p_data, now())
    on conflict (id) do update set data = excluded.data, updated_at = now();
  return jsonb_build_object('ok', true);
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

create or replace function public.lab_points_sync(p_name text, p_class_no text, p_rc int, p_src int)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin
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
create or replace function public.lab_points_claim(p_student_name text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare total_rc int; total_src int; notes text[];
begin
  select coalesce(sum(rc_delta),0), coalesce(sum(src_delta),0), coalesce(array_agg(note) filter (where note is not null and note <> ''), '{}')
    into total_rc, total_src, notes
    from lab_points_grants where student_name = p_student_name and claimed = false;
  if total_rc = 0 and total_src = 0 then
    return jsonb_build_object('ok', true, 'rcDelta', 0, 'srcDelta', 0, 'notes', '[]'::jsonb);
  end if;
  update lab_points_grants set claimed = true where student_name = p_student_name and claimed = false;
  update lab_points set rc = greatest(0, rc + total_rc), src = greatest(0, src + total_src), updated_at = now()
    where name = p_student_name;
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

create or replace function public.lab_state_sync(p_name text, p_class_no text, p_data jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
begin
  insert into lab_game_state(name, class_no, data, updated_at)
    values (p_name, p_class_no, p_data, now())
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

-- 연구포인트로 즉시 논문 작성(150🔬, 24시간 대기 없이 바로 완성).
create or replace function public.lab_instant_paper(p_name text, p_token text, p_idx int)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  gs lab_game_state%rowtype; assistants jsonb; inst jsonb; degree text; is_rare boolean; cur_rc int; cost int:=150;
  lo int; hi int; score int; nobel boolean; new_assistants jsonb; new_data jsonb; rs int; nobel_count int; papers jsonb;
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
  if is_rare then lo:=100; hi:=200;
  else case degree when 'bachelor' then lo:=10; hi:=50; when 'master' then lo:=30; hi:=100; else lo:=60; hi:=180; end case; end if;
  score := lo + floor(random()*(hi-lo+1))::int;
  nobel := score > 170;
  now_ms := (extract(epoch from now())*1000)::bigint;

  cur_rc := cur_rc - cost;
  inst := jsonb_set(inst, '{lastCollectedAt}', to_jsonb(now_ms));
  new_assistants := jsonb_set(assistants, array[p_idx::text], inst);
  rs := coalesce((gs.data->>'researchScore')::int,0) + score;
  nobel_count := coalesce((gs.data->>'nobelCount')::int,0) + (case when nobel then 1 else 0 end);
  papers := coalesce(gs.data->'papers','[]'::jsonb) || jsonb_build_array(jsonb_build_object(
    'title','「연구 성과 보고서」','theme', atheme, 'assistantName', aname, 'degree', degree, 'score', score, 'nobel', nobel, 'at', now_ms));
  new_data := gs.data;
  new_data := jsonb_set(new_data, '{rc}', to_jsonb(cur_rc));
  new_data := jsonb_set(new_data, '{assistants}', new_assistants);
  new_data := jsonb_set(new_data, '{researchScore}', to_jsonb(rs));
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
  lo int; hi int; score int; nobel boolean; new_assistants jsonb; new_data jsonb; rs int; nobel_count int; papers jsonb;
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
  if is_rare then lo:=100; hi:=200;
  else case degree when 'bachelor' then lo:=10; hi:=50; when 'master' then lo:=30; hi:=100; else lo:=60; hi:=180; end case; end if;
  score := lo + floor(random()*(hi-lo+1))::int;
  nobel := score > 170;

  inst := jsonb_set(inst, '{lastCollectedAt}', to_jsonb(now_ms));
  new_assistants := jsonb_set(assistants, array[p_idx::text], inst);
  rs := coalesce((gs.data->>'researchScore')::int,0) + score;
  nobel_count := coalesce((gs.data->>'nobelCount')::int,0) + (case when nobel then 1 else 0 end);
  papers := coalesce(gs.data->'papers','[]'::jsonb) || jsonb_build_array(jsonb_build_object(
    'title','「연구 성과 보고서」','theme', atheme, 'assistantName', aname, 'degree', degree, 'score', score, 'nobel', nobel, 'at', now_ms));
  new_data := gs.data;
  new_data := jsonb_set(new_data, '{assistants}', new_assistants);
  new_data := jsonb_set(new_data, '{researchScore}', to_jsonb(rs));
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
  degree text; is_rare boolean; lo int; hi int; score int; nobel boolean;
  rs int; nobel_count int; papers jsonb; collected jsonb := '[]'::jsonb;
  last_collected bigint; hours_elapsed numeric; aname text; atheme text; now_ms bigint;
begin
  if not lab_check_session(p_name, p_token) then return jsonb_build_object('ok', false, 'error', '세션이 유효하지 않습니다.'); end if;
  select * into gs from lab_game_state where name=trim(p_name);
  if not found then return jsonb_build_object('ok', false, 'error', '게임 상태를 찾을 수 없습니다.'); end if;
  assistants := coalesce(gs.data->'assistants', '[]'::jsonb);
  n := jsonb_array_length(assistants);
  rs := coalesce((gs.data->>'researchScore')::int,0);
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
        if is_rare then lo:=100; hi:=200;
        else case degree when 'bachelor' then lo:=10; hi:=50; when 'master' then lo:=30; hi:=100; else lo:=60; hi:=180; end case; end if;
        score := lo + floor(random()*(hi-lo+1))::int;
        nobel := score > 170;
        inst := jsonb_set(inst, '{lastCollectedAt}', to_jsonb(now_ms));
        assistants := jsonb_set(assistants, array[i::text], inst);
        rs := rs + score;
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
    (gs.data - 'assistants' - 'researchScore' - 'nobelCount' - 'papers')
    || jsonb_build_object('assistants', assistants, 'researchScore', rs, 'nobelCount', nobel_count, 'papers', papers)
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
