-- 연구 노트 6영역(2026-11-05): 기본 8 + 영역 1~5(16·15·23·17·20단원) 객관식·서술형 각 1점 + 영역 6(24단원) 보고서 2점 = 20점
create or replace function public.lab_t2_keys() returns text[] language sql immutable as $$
  select array['ch16_seed_v1__obj','ch16_seed_v1__essay','ch15_seed_v1__obj','ch15_seed_v1__essay','ch23_seed_v1__obj','ch23_seed_v1__essay',
               'ch17_seed_v1__obj','ch17_seed_v1__essay','ch20_seed_v1__obj','ch20_seed_v1__essay','ch24_seed_v1__essay'] $$;
create or replace function public.lab_t2_auto(p_name text) returns int
language sql stable security definer set search_path = public as $$
  select least(20, 8 + coalesce((select sum(case when e.key = 'ch24_seed_v1__essay' then 2 else 1 end)::int
    from lab_game_state g, jsonb_each(coalesce(g.data->'everPassed', '{}'::jsonb)) e
    where g.name = trim(p_name) and e.key = any(lab_t2_keys()) and e.value = 'true'::jsonb), 0)) $$;
-- 연구 노트 코인(평가 코인)도 새 영역 단원(23·24)을 셈에 넣는다
create or replace function public.subway_term2_keys() returns text[] language sql immutable as $$
  select array['ch15_seed_v1','ch16_seed_v1','ch17_seed_v1','ch18_seed_v1','ch19_seed_v1','ch20_seed_v1','ch23_seed_v1','ch24_seed_v1'] $$;
