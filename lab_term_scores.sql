-- 수행평가 점수(2026-11-05). 표 이름 lab_term_scores: 기존 lab_scores는 연구점수 랭킹 표(누구나 읽기 가능)라 따로 둔다.
-- 처음 만들 때 잘못 만든 함수 정리
drop function if exists public.lab_my_scores(text, text);
drop function if exists public.lab_scores_list(text);
drop function if exists public.lab_scores_set(text, text, numeric, numeric, numeric, text);
--: 1회차는 교사가 확정한 점수를 넣어 두고, 2회차는 연구 노트 통과 기록으로 자동 계산한다.
-- 학생은 「내 점수」에서 자기 점수만 보고, 교사는 교사 비밀번호로 「수행평가 관리 > 📊 수행평가 점수」에서 고친다.
-- 학생 이름은 이 파일에 넣지 않는다(1회차 점수는 반·번호로 lab_students.student_id와 맞춰 따로 넣는다).
create table if not exists public.lab_term_scores (
  name text primary key,
  class_no int,
  num int,
  t1_total numeric,                         -- 1회차 합계(20점 만점, 기본점수 포함)
  t1_bonus numeric not null default 0,      -- 1회차 연구점수 랭킹 보너스(합계와 별도)
  t1_items jsonb,                           -- 1회차 해결 내역(12개 0/1)과 기출 최고 맞힌 수
  t2_adjust numeric not null default 0,     -- 2회차 교사 조정(자동 점수에 더함, 음수 가능)
  note text,
  updated_at timestamptz not null default now()
);
alter table public.lab_term_scores enable row level security;

-- 2회차 자동 점수: 기본 8 + 연구 노트 통과 수(15·16·17·20단원 객관식·서술형 각 1점, 최대 8)
create or replace function public.lab_t2_keys() returns text[] language sql immutable as $$
  select array['ch15_seed_v1__obj','ch15_seed_v1__essay','ch16_seed_v1__obj','ch16_seed_v1__essay',
               'ch17_seed_v1__obj','ch17_seed_v1__essay','ch20_seed_v1__obj','ch20_seed_v1__essay'] $$;
create or replace function public.lab_t2_auto(p_name text) returns int
language sql stable security definer set search_path = public as $$
  select 8 + coalesce((select count(*)::int from lab_game_state g, jsonb_each(coalesce(g.data->'everPassed', '{}'::jsonb)) e
    where g.name = trim(p_name) and e.key = any(lab_t2_keys()) and e.value = 'true'::jsonb), 0) $$;

create or replace function public.lab_term_my(p_name text, p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r lab_term_scores; a int;
begin
  if not lab_check_session(p_name, p_token) then return jsonb_build_object('ok', false, 'error', '세션이 유효하지 않습니다.'); end if;
  select * into r from lab_term_scores where name = trim(p_name);
  a := lab_t2_auto(p_name);
  return jsonb_build_object('ok', true,
    't1', case when r.t1_total is null then null else jsonb_build_object('total', r.t1_total, 'bonus', r.t1_bonus, 'items', r.t1_items) end,
    't2', jsonb_build_object('auto', a, 'adjust', coalesce(r.t2_adjust, 0), 'total', least(20, greatest(0, a + coalesce(r.t2_adjust, 0)))),
    'note', r.note);
end $$;

create or replace function public.lab_term_list(p_teacher_password text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not lab_teacher_check(p_teacher_password) then return jsonb_build_object('ok', false, 'error', '교사 비밀번호가 올바르지 않습니다.'); end if;
  return jsonb_build_object('ok', true, 'rows', (select coalesce(jsonb_agg(jsonb_build_object(
      'name', s.name, 'sid', s.student_id, 'class_no', coalesce(r.class_no, nullif(substr(s.student_id, 2, 2), '')::int), 'num', coalesce(r.num, nullif(substr(s.student_id, 4, 2), '')::int),
      't1_total', r.t1_total, 't1_bonus', coalesce(r.t1_bonus, 0), 't1_items', r.t1_items,
      't2_auto', lab_t2_auto(s.name), 't2_adjust', coalesce(r.t2_adjust, 0), 'note', r.note) order by s.student_id), '[]'::jsonb)
    from lab_students s left join lab_term_scores r on r.name = s.name where length(s.student_id) = 5));
end $$;

create or replace function public.lab_term_set(p_teacher_password text, p_name text, p_t1_total numeric, p_t1_bonus numeric, p_t2_adjust numeric, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not lab_teacher_check(p_teacher_password) then return jsonb_build_object('ok', false, 'error', '교사 비밀번호가 올바르지 않습니다.'); end if;
  if not exists (select 1 from lab_students where name = trim(p_name)) then return jsonb_build_object('ok', false, 'error', '없는 학생입니다.'); end if;
  if p_t1_total is not null and (p_t1_total < 0 or p_t1_total > 20) then return jsonb_build_object('ok', false, 'error', '1회차 점수는 0~20점입니다.'); end if;
  insert into lab_term_scores(name, t1_total, t1_bonus, t2_adjust, note) values (trim(p_name), p_t1_total, coalesce(p_t1_bonus, 0), coalesce(p_t2_adjust, 0), nullif(trim(coalesce(p_note, '')), ''))
  on conflict (name) do update set t1_total = excluded.t1_total, t1_bonus = excluded.t1_bonus, t2_adjust = excluded.t2_adjust, note = excluded.note, updated_at = now();
  return jsonb_build_object('ok', true, 't2_auto', lab_t2_auto(p_name));
end $$;

grant execute on function public.lab_term_my(text, text), public.lab_term_list(text), public.lab_term_set(text, text, numeric, numeric, numeric, text) to anon, authenticated;
revoke execute on function public.lab_t2_auto(text) from public, anon, authenticated;
