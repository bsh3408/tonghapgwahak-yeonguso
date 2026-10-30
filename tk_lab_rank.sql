-- 연구소 순위 화면용 「딸깍 독재자」 전체 순위 (2026-10-30). tk_* 표는 읽기만 한다.
-- 진짜 지도자: 진짜 독재자(mode 2)를 끝까지 마친 판의 지도자 종합 점수(st.score), 같으면 GDP가 큰 순.
-- 국가소득: 끝까지 마친 판(초보·진짜 모두)의 GDP가 큰 순. 학생마다 가장 좋은 판 하나, 교사·시험 계정 제외.
create or replace function public.tk_lab_rank(p_name text, p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := trim(p_name);
begin
  if not lab_check_session(p_name, p_token) then return jsonb_build_object('ok', false, 'error', '세션이 유효하지 않습니다.'); end if;
  return (with
    lead as (select distinct on (name) name, nation, (st->>'score')::numeric score, st->>'grade' grade, gdp from tk_players
              where mode = 2 and done and st ? 'score' and not (name = any(makcha_hidden()))
              order by name, (st->>'score')::numeric desc, gdp desc),
    lr as (select *, rank() over (order by score desc, gdp desc) rk from lead),
    rich as (select distinct on (name) name, nation, gdp, mode from tk_players
              where done and not (name = any(makcha_hidden())) order by name, gdp desc),
    gr as (select *, rank() over (order by gdp desc) rk from rich)
  select jsonb_build_object('ok', true,
    'leader', (select coalesce(jsonb_agg(jsonb_build_object('rank', rk, 'name', name, 'nation', nation, 'score', score, 'grade', grade, 'gdp', gdp) order by rk, name), '[]'::jsonb) from lr where rk <= 5),
    'gdp', (select coalesce(jsonb_agg(jsonb_build_object('rank', rk, 'name', name, 'nation', nation, 'gdp', gdp, 'mode', mode) order by rk, name), '[]'::jsonb) from gr where rk <= 5),
    'meLeader', (select jsonb_build_object('rank', rk, 'score', score, 'grade', grade) from lr where name = me),
    'meGdp', (select jsonb_build_object('rank', rk, 'gdp', gdp) from gr where name = me)));
end $$;
grant execute on function public.tk_lab_rank(text, text) to anon, authenticated;
