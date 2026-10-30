-- 「막차」 순위 서버 표·함수 (2026-10-30). 기존 lab_*·subway_* 표는 건드리지 않고 새로 더한다.
-- 순위: 통과한 역 수가 많을수록, 같으면 걸린 시간(초)이 짧을수록 위. 학생마다 가장 좋은 판 하나로 매긴다.
-- 통합 순위는 직업과 상관없이, 직업별 순위는 그 직업으로 한 판 중에서. 교사·시험 계정은 순위에서 뺀다.
-- 모든 함수는 lab_check_session(_grace)로 로그인·이용 시간을 확인한다. 표는 RLS로 막고 함수로만 읽고 쓴다.

create table if not exists public.makcha_runs (
  id bigserial primary key,
  name text not null,
  job text not null,
  stages int not null,          -- 통과한 역 수(구역 6개 × 역 4개 = 24가 끝까지)
  secs numeric(10,1) not null,  -- 걸린 시간(초, 오답 벌칙 포함)
  win boolean not null default false,
  at timestamptz not null default now()
);
create index if not exists makcha_runs_name on public.makcha_runs(name);
alter table public.makcha_runs enable row level security;

create or replace function public.makcha_jobs() returns text[] language sql immutable as $$
  select array['driver','geo','eco','chem','weather','medic'] $$;
create or replace function public.makcha_hidden() returns text[] language sql immutable as $$
  select array['변석환','테스트','이지숙'] $$;  -- lab_auth.js RANK_EXCLUDE_ACCOUNTS와 같게

-- 학생마다 가장 좋은 판(p_job이 null이면 직업 상관없이)
create or replace function public.makcha_best(p_job text) returns table(name text, job text, stages int, secs numeric, rk bigint)
language sql stable security definer set search_path = public as $$
  select b.name, b.job, b.stages, b.secs, rank() over (order by b.stages desc, b.secs asc) rk from (
    select distinct on (r.name) r.name, r.job, r.stages, r.secs from makcha_runs r
     where (p_job is null or r.job = p_job) and not (r.name = any(makcha_hidden()))
     order by r.name, r.stages desc, r.secs asc) b $$;

-- 순위 보기: 통합 1~5등, 직업별 1~5등, 내 순위
create or replace function public.makcha_rank(p_name text, p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare byjob jsonb := '{}'::jsonb; mine jsonb := '{}'::jsonb; j text; me text := trim(p_name);
begin
  if not lab_check_session(p_name, p_token) then return jsonb_build_object('ok', false, 'error', '세션이 유효하지 않습니다.'); end if;
  foreach j in array makcha_jobs() loop
    byjob := byjob || jsonb_build_object(j, (select coalesce(jsonb_agg(jsonb_build_object('rank', rk, 'name', name, 'stages', stages, 'secs', secs) order by rk, name), '[]'::jsonb)
      from makcha_best(j) where rk <= 5));
    mine := mine || coalesce((select jsonb_build_object(j, jsonb_build_object('rank', rk, 'stages', stages, 'secs', secs)) from makcha_best(j) where name = me), '{}'::jsonb);
  end loop;
  return jsonb_build_object('ok', true,
    'overall', (select coalesce(jsonb_agg(jsonb_build_object('rank', rk, 'name', name, 'job', job, 'stages', stages, 'secs', secs) order by rk, name), '[]'::jsonb) from makcha_best(null) where rk <= 5),
    'byJob', byjob,
    'me', (select jsonb_build_object('rank', rk, 'job', job, 'stages', stages, 'secs', secs) from makcha_best(null) where name = me),
    'meByJob', mine,
    'players', (select count(*) from makcha_best(null)));
end $$;

-- 판이 끝날 때 기록하고, 지금 순위(통합·그 직업)를 돌려준다
create or replace function public.makcha_run_finish(p_name text, p_token text, p_job text, p_stages int, p_secs numeric, p_win boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := trim(p_name); o record; jr record;
begin
  if not lab_check_session_grace(p_name, p_token) then return jsonb_build_object('ok', false, 'error', '세션이 유효하지 않습니다.'); end if;
  if not (p_job = any(makcha_jobs())) or p_stages < 0 or p_stages > 24 or p_secs is null or p_secs < 0 or p_secs < p_stages * 10 then
    return jsonb_build_object('ok', false, 'error', '기록이 올바르지 않습니다.'); end if;
  insert into makcha_runs(name, job, stages, secs, win) values (me, p_job, p_stages, round(p_secs, 1), coalesce(p_win, false));
  select rk, stages, secs into o from makcha_best(null) where name = me;
  select rk, stages, secs into jr from makcha_best(p_job) where name = me;
  return jsonb_build_object('ok', true,
    'rank', o.rk, 'best', jsonb_build_object('stages', o.stages, 'secs', o.secs),
    'jobRank', jr.rk, 'jobBest', jsonb_build_object('stages', jr.stages, 'secs', jr.secs),
    'players', (select count(*) from makcha_best(null)), 'jobPlayers', (select count(*) from makcha_best(p_job)));
end $$;

grant execute on function public.makcha_rank(text, text), public.makcha_run_finish(text, text, text, int, numeric, boolean) to anon, authenticated;
revoke execute on function public.makcha_best(text) from public, anon, authenticated;
