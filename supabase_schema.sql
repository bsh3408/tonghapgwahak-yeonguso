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
  logged_in_at timestamptz
);
alter table public.lab_students enable row level security;
-- anon에게 테이블 직접 접근 정책 없음 → 아래 함수로만.

create or replace function public.lab_login(p_name text, p_password text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare s lab_students%rowtype;
begin
  select * into s from lab_students where name = trim(p_name);
  if not found then return jsonb_build_object('ok', false, 'error', '등록되지 않은 이름입니다. 선생님께 문의하세요.'); end if;
  if encode(digest(p_password || s.salt, 'sha256'), 'hex') <> s.password_hash then
    return jsonb_build_object('ok', false, 'error', '비밀번호가 올바르지 않습니다.');
  end if;
  update lab_students set logged_in_at = now() where name = s.name;
  return jsonb_build_object('ok', true, 'mustChange', s.must_change, 'studentId', s.student_id);
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
-- anon 롤에게 위 함수들을 호출할 권한 부여(테이블 직접 권한은 안 줌 — RLS+정책만으로 제어)
-- ============================================================
grant execute on all functions in schema public to anon, authenticated;
