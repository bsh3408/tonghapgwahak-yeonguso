-- 「지하철 노선 탈출」 서버 표·함수 (설계서 11~12절). 기존 lab_* 표는 건드리지 않고 새로 더한다.
-- 코인 = 평가 코인(2학기 단원 15~20에서 처음 맞힌 객관식 1개당 10, 처음 완성한 서술형 1개당 30) + 게임 코인 − 뽑기에 쓴 코인
-- 모든 함수는 lab_check_session으로 로그인·이용 시간을 확인한다. 표는 RLS로 막고 함수로만 읽고 쓴다.

create table if not exists public.subway_state (
  name text primary key,
  coins_spent int not null default 0,
  game_coins int not null default 0,
  game_day date,
  game_today int not null default 0,
  relics jsonb not null default '[]'::jsonb,
  equipped jsonb not null default '[]'::jsonb,
  codex jsonb not null default '{"gear":[],"status":[],"monsters":[]}'::jsonb,
  titles jsonb not null default '[]'::jsonb,
  best jsonb,
  best_by_job jsonb not null default '{}'::jsonb,
  runs int not null default 0,
  pity int not null default 0,
  updated_at timestamptz not null default now()
);
create table if not exists public.subway_runs (
  id bigserial primary key,
  name text not null,
  job text not null,
  lines int not null,
  ticks int not null,
  escaped boolean not null default false,
  kills int not null default 0,
  visited jsonb not null default '[]'::jsonb,
  verified boolean not null default false,   -- 서버 다시 돌리기 검증(2번 계획) 전까지는 false
  at timestamptz not null default now()
);
alter table public.subway_state enable row level security;
alter table public.subway_runs enable row level security;

create or replace function public.subway_term2_keys() returns text[] language sql immutable as $$
  select array['ch15_seed_v1','ch16_seed_v1','ch17_seed_v1','ch18_seed_v1','ch19_seed_v1','ch20_seed_v1'];
$$;
create or replace function public.subway_relics(p_grade int) returns text[] language sql immutable as $$
  select case p_grade
    when 1 then array['battery','medkit','lockBag','itemPouch']
    when 2 then array['magnifier','flashGen','hazardGlasses','sewingKit','magnet']
    else array['vaccine','solarPanel','oldNote','buoy'] end;
$$;
create or replace function public.subway_jobs() returns text[] language sql immutable as $$
  select array['doctor','electric','climate','chemist','ecologist','ai'];
$$;

-- 평가로 번 코인(서버에 이미 있는 채점 기록에서 계산하므로 따로 지급할 필요가 없다)
create or replace function public.subway_eval_coins(p_name text) returns int
language sql stable security definer set search_path = public as $$
  select coalesce((
    select 10 * coalesce(sum(jsonb_array_length(e.value)), 0)
      from lab_game_state g, jsonb_each(coalesce(g.data->'everCorrect','{}'::jsonb)) e
     where g.name = trim(p_name) and e.key = any(subway_term2_keys()) and jsonb_typeof(e.value) = 'array'), 0)
  + coalesce((
    select 30 * count(*)
      from lab_game_state g, jsonb_object_keys(coalesce(g.data->'opinionAwarded','{}'::jsonb)) k
     where g.name = trim(p_name) and exists (select 1 from unnest(subway_term2_keys()) t where k like t || '\_%')), 0)::int;
$$;

create or replace function public.subway_row(p_name text) returns public.subway_state
language plpgsql security definer set search_path = public as $$
declare r subway_state;
begin
  insert into subway_state(name) values (trim(p_name)) on conflict (name) do nothing;
  select * into r from subway_state where name = trim(p_name);
  return r;
end $$;

create or replace function public.subway_view(r public.subway_state) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ok', true,
    'coins', subway_eval_coins(r.name) + r.game_coins - r.coins_spent,
    'evalCoins', subway_eval_coins(r.name), 'gameCoins', r.game_coins, 'spent', r.coins_spent,
    'gameToday', case when r.game_day = (now() at time zone 'Asia/Seoul')::date then r.game_today else 0 end,
    'relics', r.relics, 'equipped', r.equipped, 'codex', r.codex, 'titles', r.titles,
    'best', r.best, 'bestByJob', r.best_by_job, 'runs', r.runs, 'pity', r.pity);
$$;

create or replace function public.subway_state_get(p_name text, p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r subway_state;
begin
  if not lab_check_session(p_name, p_token) then return jsonb_build_object('ok', false, 'error', '세션이 유효하지 않습니다.'); end if;
  r := subway_row(p_name);
  return subway_view(r);
end $$;

-- 유물 뽑기: 한 번 100코인. ★ 60% / ★★ 30% / ★★★ 10%, 10번째까지 ★★★이 없으면 확정. 이미 있으면 40코인 돌려줌
create or replace function public.subway_gacha(p_name text, p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r subway_state; bal int; x float; g int; pool text[]; pick text; dup boolean;
begin
  if not lab_check_session(p_name, p_token) then return jsonb_build_object('ok', false, 'error', '세션이 유효하지 않습니다.'); end if;
  perform subway_row(p_name);
  select * into r from subway_state where name = trim(p_name) for update;
  bal := subway_eval_coins(r.name) + r.game_coins - r.coins_spent;
  if bal < 100 then return jsonb_build_object('ok', false, 'error', '코인이 모자랍니다.', 'coins', bal); end if;
  if r.pity >= 9 then g := 3;
  else x := random(); g := case when x < 0.10 then 3 when x < 0.40 then 2 else 1 end; end if;
  pool := subway_relics(g);
  pick := pool[1 + floor(random() * array_length(pool, 1))::int];
  dup := r.relics ? pick;
  update subway_state set
    coins_spent = coins_spent + 100 - (case when dup then 40 else 0 end),
    relics = case when dup then relics else relics || to_jsonb(pick) end,
    pity = case when g = 3 then 0 else pity + 1 end,
    updated_at = now()
  where name = r.name returning * into r;
  return subway_view(r) || jsonb_build_object('relic', pick, 'grade', g, 'dup', dup);
end $$;

create or replace function public.subway_equip(p_name text, p_token text, p_relics jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r subway_state; e text;
begin
  if not lab_check_session(p_name, p_token) then return jsonb_build_object('ok', false, 'error', '세션이 유효하지 않습니다.'); end if;
  r := subway_row(p_name);
  if jsonb_typeof(p_relics) <> 'array' or jsonb_array_length(p_relics) > 3 then return jsonb_build_object('ok', false, 'error', '유물은 3개까지 장착합니다.'); end if;
  for e in select jsonb_array_elements_text(p_relics) loop
    if not (r.relics ? e) then return jsonb_build_object('ok', false, 'error', '가지지 않은 유물입니다.'); end if;
  end loop;
  update subway_state set equipped = (select coalesce(jsonb_agg(distinct v), '[]'::jsonb) from jsonb_array_elements_text(p_relics) v), updated_at = now()
   where name = r.name returning * into r;
  return subway_view(r);
end $$;

-- 판이 끝날 때 기록. 게임 코인: 통과한 노선 1개당 20, 탈출 100, 하루 200까지(서울 날짜)
create or replace function public.subway_run_finish(p_name text, p_token text, p_job text, p_lines int, p_ticks int, p_escaped boolean,
  p_kills int, p_visited jsonb, p_codex jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r subway_state; today date := (now() at time zone 'Asia/Seoul')::date; earned int; room int; give int; cx jsonb; k text;
  rec jsonb; better boolean;
begin
  if not lab_check_session_grace(p_name, p_token) then return jsonb_build_object('ok', false, 'error', '세션이 유효하지 않습니다.'); end if;
  if not (p_job = any(subway_jobs())) or p_lines < 0 or p_lines > 9 or p_ticks < 0 then return jsonb_build_object('ok', false, 'error', '기록이 올바르지 않습니다.'); end if;
  perform subway_row(p_name);
  select * into r from subway_state where name = trim(p_name) for update;
  insert into subway_runs(name, job, lines, ticks, escaped, kills, visited) values (r.name, p_job, p_lines, p_ticks, coalesce(p_escaped, false), greatest(0, coalesce(p_kills, 0)), coalesce(p_visited, '[]'::jsonb));
  earned := p_lines * 20 + case when p_escaped then 100 else 0 end;
  if r.game_day is distinct from today then r.game_today := 0; end if;
  room := greatest(0, 200 - r.game_today); give := least(earned, room);
  cx := r.codex;
  for k in select unnest(array['gear','status','monsters']) loop
    cx := jsonb_set(cx, array[k], (select coalesce(jsonb_agg(distinct v), '[]'::jsonb) from (
      select jsonb_array_elements_text(coalesce(cx->k, '[]'::jsonb)) v union select jsonb_array_elements_text(coalesce(p_codex->k, '[]'::jsonb)) v) u), true);
  end loop;
  rec := jsonb_build_object('lines', p_lines, 'ticks', p_ticks, 'job', p_job, 'escaped', coalesce(p_escaped, false), 'at', now());
  better := r.best is null or p_lines > (r.best->>'lines')::int or (p_lines = (r.best->>'lines')::int and p_ticks < (r.best->>'ticks')::int);
  update subway_state set
    game_coins = game_coins + give, game_day = today, game_today = r.game_today + give,
    codex = cx, runs = runs + 1,
    best = case when better then rec else best end,
    best_by_job = case when best_by_job->p_job is null or p_lines > (best_by_job->p_job->>'lines')::int
                         or (p_lines = (best_by_job->p_job->>'lines')::int and p_ticks < (best_by_job->p_job->>'ticks')::int)
                       then jsonb_set(best_by_job, array[p_job], rec, true) else best_by_job end,
    updated_at = now()
  where name = r.name returning * into r;
  return subway_view(r) || jsonb_build_object('gained', give, 'earned', earned);
end $$;

-- 순위: 통과한 노선 수가 많을수록, 같으면 걸린 시간이 짧을수록 위. 통합 상위 30명과 직업별 상위 5명
create or replace function public.subway_rank(p_name text, p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare overall jsonb; byjob jsonb := '{}'::jsonb; j text;
begin
  if not lab_check_session(p_name, p_token) then return jsonb_build_object('ok', false, 'error', '세션이 유효하지 않습니다.'); end if;
  select coalesce(jsonb_agg(x order by (x->>'lines')::int desc, (x->>'ticks')::int asc), '[]'::jsonb) into overall from (
    select jsonb_build_object('name', name, 'lines', (best->>'lines')::int, 'ticks', (best->>'ticks')::int, 'job', best->>'job') x
      from subway_state where best is not null order by (best->>'lines')::int desc, (best->>'ticks')::int asc limit 30) t;
  foreach j in array subway_jobs() loop
    byjob := byjob || jsonb_build_object(j, (select coalesce(jsonb_agg(x order by (x->>'lines')::int desc, (x->>'ticks')::int asc), '[]'::jsonb) from (
      select jsonb_build_object('name', name, 'lines', (best_by_job->j->>'lines')::int, 'ticks', (best_by_job->j->>'ticks')::int) x
        from subway_state where best_by_job->j is not null order by (best_by_job->j->>'lines')::int desc, (best_by_job->j->>'ticks')::int asc limit 5) t));
  end loop;
  return jsonb_build_object('ok', true, 'overall', overall, 'byJob', byjob);
end $$;

grant execute on function public.subway_state_get(text, text), public.subway_gacha(text, text), public.subway_equip(text, text, jsonb),
  public.subway_run_finish(text, text, text, int, int, boolean, int, jsonb, jsonb), public.subway_rank(text, text) to anon, authenticated;
revoke execute on function public.subway_row(text), public.subway_view(public.subway_state), public.subway_eval_coins(text) from public, anon, authenticated;
