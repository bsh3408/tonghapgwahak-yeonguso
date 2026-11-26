-- 2026-11-26 교사 요청: 2회차 수행평가 점수 확정 + 연구소 다시 열기
-- 1) 확정 점수 칸(t2_final)에 지금 점수(연구 노트 자동 점수 + 교사 감점)를 고정한다. 다시 열어도 연구 노트를 더 풀어 점수가 바뀌지 않는다.
alter table lab_term_scores add column if not exists t2_final int;
update lab_term_scores t set t2_final = least(20, greatest(0, lab_t2_auto(t.name) + coalesce(t.t2_adjust, 0))), updated_at = now()
where t.name in (select name from lab_students where length(student_id) = 5);

-- 2) 내 점수(lab_term_my)는 확정 점수가 있으면 그것을 보여 준다
do $$
declare d text; a text := $a$'t2', jsonb_build_object('auto', a, 'adjust', coalesce(r.t2_adjust, 0), 'total', least(20, greatest(0, a + coalesce(r.t2_adjust, 0))))$a$;
begin
  d := pg_get_functiondef('public.lab_term_my'::regproc);
  if position(a in d) = 0 then raise exception 'lab_term_my: 바꿀 곳이 없음'; end if;
  execute replace(d, a, $b$'t2', jsonb_build_object('auto', a, 'adjust', coalesce(r.t2_adjust, 0), 'total', coalesce(r.t2_final, least(20, greatest(0, a + coalesce(r.t2_adjust, 0)))), 'final', r.t2_final is not null)$b$);
end $$;

-- 3) 연구소 다시 열기: 11월 25일 오후 5시 운영 종료 줄을 뺀다(평일 이용 시간 규칙은 그대로)
do $$
declare d text; a text := $a$when p_at >= '2026-11-25 17:00:00+09'::timestamptz then false -- 2026-11-25 교사 요청 운영 종료$a$;
begin
  d := pg_get_functiondef('public.lab_service_open(timestamptz)'::regprocedure);
  if position(a in d) = 0 then raise notice '이미 빠져 있음'; return; end if;
  execute replace(d, a, '');
end $$;

-- 4) 2회차 연구 노트 6영역은 잠근다(확정 뒤에는 풀 수 없음)
update lab_deptconfig set data = data
  || jsonb_build_object('ch15_seed_v1', coalesce(data->'ch15_seed_v1', '{}'::jsonb) || '{"locked": true}')
  || jsonb_build_object('ch16_seed_v1', coalesce(data->'ch16_seed_v1', '{}'::jsonb) || '{"locked": true}')
  || jsonb_build_object('ch17_seed_v1', coalesce(data->'ch17_seed_v1', '{}'::jsonb) || '{"locked": true}')
  || jsonb_build_object('ch20_seed_v1', coalesce(data->'ch20_seed_v1', '{}'::jsonb) || '{"locked": true}')
  || jsonb_build_object('ch23_seed_v1', coalesce(data->'ch23_seed_v1', '{}'::jsonb) || '{"locked": true}')
  || jsonb_build_object('ch24_seed_v1', coalesce(data->'ch24_seed_v1', '{}'::jsonb) || '{"locked": true}')
where id = 1;

select count(*) || '명 확정, 합계 ' || sum(t2_final) || ', 평균 ' || round(avg(t2_final), 2) || ', 만점 ' || count(*) filter (where t2_final = 20)
  || ' | 열림(오늘 10시)=' || lab_service_open(date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul' + interval '10 hours')
  || ' | my_has_final=' || (position('t2_final' in pg_get_functiondef('public.lab_term_my'::regproc)) > 0) as r
from lab_term_scores where t2_final is not null;
