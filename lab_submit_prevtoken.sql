-- 2026-11-13 연구 노트를 다 풀고 제출하면 "로그인이 풀렸어요"로 거부되고 결과가 저장되지 않는 문제
-- 원인: 세션은 1분만 활동이 없으면 다른 곳에서 새로 로그인할 수 있다. 문제를 푸는 탭이 숨겨져 하트비트가 늦거나,
--      학생이 다른 탭·기기에서 다시 로그인하면 토큰이 바뀌어서, 문제를 풀던 창의 제출이 통째로 거부됐다.
-- 해결: 그 학생이 최근에 받았던 토큰(최대 5개, 12시간 안)으로도 "제출과 서술형 저장"만은 받아 준다.
--      게임·포인트 사용 같은 나머지 기능은 그대로 지금 토큰만 받는다.

alter table lab_students add column if not exists prev_tokens jsonb not null default '[]'::jsonb;

-- 토큰이 바뀌거나(새 로그인) 지워질 때(로그아웃) 옛 토큰을 기억해 둔다
create or replace function public.lab_students_keep_prev_token() returns trigger language plpgsql as $$
begin
  if old.session_token is not null and new.session_token is distinct from old.session_token then
    new.prev_tokens := (
      select coalesce(jsonb_agg(x order by (x->>'at') desc), '[]'::jsonb)
      from (select x from jsonb_array_elements(
              jsonb_build_array(jsonb_build_object('t', old.session_token, 'at', now())) || coalesce(old.prev_tokens, '[]'::jsonb)) x
            where (x->>'at')::timestamptz > now() - interval '12 hours'
            order by (x->>'at') desc limit 5) s);
  end if;
  return new;
end $$;
drop trigger if exists lab_students_keep_prev_token on lab_students;
create trigger lab_students_keep_prev_token before update of session_token on lab_students
  for each row execute function public.lab_students_keep_prev_token();

-- 제출 전용 세션 확인: 지금 토큰 또는 최근 토큰
create or replace function public.lab_check_submit(p_name text, p_token text) returns boolean language sql stable as $$
  select (lab_service_open(now() - (lab_submit_grace_minutes() || ' minutes')::interval) or lab_time_exempt(p_name))
    and p_token is not null
    and exists(select 1 from lab_students s where s.name = trim(p_name)
               and (s.session_token = p_token or s.prev_tokens @> jsonb_build_array(jsonb_build_object('t', p_token))));
$$;

-- 제출(lab_submit_chapter)과 서술형 저장(lab_journal_save)만 새 확인 함수로 바꾼다(나머지 내용은 그대로)
do $$
declare d text;
begin
  d := pg_get_functiondef('public.lab_submit_chapter'::regproc);
  if position('lab_check_session_grace(p_name, p_token)' in d) = 0 then raise exception 'lab_submit_chapter: 바꿀 곳이 없음'; end if;
  execute replace(d, 'lab_check_session_grace(p_name, p_token)', 'lab_check_submit(p_name, p_token)');
  d := pg_get_functiondef('public.lab_journal_save'::regproc);
  if position('lab_check_session_grace(p_student_name, p_token)' in d) = 0 then raise exception 'lab_journal_save: 바꿀 곳이 없음'; end if;
  execute replace(d, 'lab_check_session_grace(p_student_name, p_token)', 'lab_check_submit(p_student_name, p_token)');
end $$;

select (select count(*) from regexp_matches(pg_get_functiondef('public.lab_submit_chapter'::regproc), 'lab_check_submit', 'g')) as submit_fixed,
       (select count(*) from regexp_matches(pg_get_functiondef('public.lab_journal_save'::regproc), 'lab_check_submit', 'g')) as journal_fixed;
