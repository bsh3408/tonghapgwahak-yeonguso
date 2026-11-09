-- 「막차」 유물 뽑기·장착 (2026-11-05). 코인은 연구소 코인과 같은 지갑(subway_state: 평가 코인 + 게임 코인 − 사용)을 쓴다.
-- 뽑기 규칙은 연구소 유물 뽑기와 같다: 🪙100, ★ 60% · ★★ 30% · ★★★ 10%, 10번째까지 ★★★이 없으면 ★★★ 확정, 가진 유물이 또 나오면 🪙40 돌려줌.
-- 유물 등급 목록은 막차 game.js의 MK_RELIC_GRADE와 반드시 같게 고친다.
create table if not exists public.makcha_state (
  name text primary key,
  relics jsonb not null default '[]'::jsonb,
  equipped jsonb not null default '[]'::jsonb,
  pity int not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.makcha_state enable row level security;

create or replace function public.makcha_relics(p_grade int) returns text[] language sql immutable as $$
  select case p_grade
    when 3 then array['amber','coalLump','firewall','litmus','whitePaint','dinoTooth','chip','timetable']
    when 2 then array['fossilTri','strata','tundra','fossilAmm','iceCore','tusk','cog','meteor','solarBit','beaker','ticket','catalyst','zinc','thermite']
    else array['feather','valve','usb','magnet','hammerHead','fern','fossilFish','indexFossil','acorn','wax','pellet','wormSoil','seedBank','silk','salt','battery','blade','dataLog','circuit','parasol','spine','thermo','down','sledRunner'] end $$;

create or replace function public.makcha_view(p_name text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('ok', true,
    'coins', subway_eval_coins(s.name) + s.game_coins - s.coins_spent,
    'relics', coalesce(m.relics, '[]'::jsonb), 'equipped', coalesce(m.equipped, '[]'::jsonb), 'pity', coalesce(m.pity, 0))
  from subway_state s left join makcha_state m on m.name = s.name where s.name = trim(p_name) $$;

create or replace function public.makcha_state_get(p_name text, p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not lab_check_session(p_name, p_token) then return jsonb_build_object('ok', false, 'error', '세션이 유효하지 않습니다.'); end if;
  perform subway_row(p_name);
  insert into makcha_state(name) values (trim(p_name)) on conflict (name) do nothing;
  return makcha_view(p_name);
end $$;

create or replace function public.makcha_gacha(p_name text, p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s subway_state; m makcha_state; bal int; g int; roll numeric; pool text[]; pick text; dup boolean;
begin
  if not lab_check_session(p_name, p_token) then return jsonb_build_object('ok', false, 'error', '세션이 유효하지 않습니다.'); end if;
  perform subway_row(p_name);
  insert into makcha_state(name) values (trim(p_name)) on conflict (name) do nothing;
  select * into s from subway_state where name = trim(p_name) for update;
  select * into m from makcha_state where name = trim(p_name) for update;
  bal := subway_eval_coins(s.name) + s.game_coins - s.coins_spent;
  if bal < 100 then return jsonb_build_object('ok', false, 'error', '코인이 모자랍니다.', 'coins', bal); end if;
  if m.pity >= 9 then g := 3; else roll := random(); g := case when roll < 0.1 then 3 when roll < 0.4 then 2 else 1 end; end if;
  pool := makcha_relics(g);
  pick := pool[1 + floor(random() * array_length(pool, 1))::int];
  dup := m.relics ? pick;
  update subway_state set coins_spent = coins_spent + 100 - (case when dup then 40 else 0 end), updated_at = now() where name = s.name;
  update makcha_state set relics = case when dup then relics else relics || to_jsonb(pick) end,
    pity = case when g = 3 then 0 else pity + 1 end, updated_at = now() where name = m.name;
  return makcha_view(p_name) || jsonb_build_object('relic', pick, 'grade', g, 'dup', dup);
end $$;

create or replace function public.makcha_equip(p_name text, p_token text, p_relics jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m makcha_state; e text;
begin
  if not lab_check_session(p_name, p_token) then return jsonb_build_object('ok', false, 'error', '세션이 유효하지 않습니다.'); end if;
  insert into makcha_state(name) values (trim(p_name)) on conflict (name) do nothing;
  select * into m from makcha_state where name = trim(p_name) for update;
  if jsonb_typeof(p_relics) <> 'array' or jsonb_array_length(p_relics) > 3 then return jsonb_build_object('ok', false, 'error', '유물은 3개까지 장착합니다.'); end if;
  for e in select jsonb_array_elements_text(p_relics) loop
    if not (m.relics ? e) then return jsonb_build_object('ok', false, 'error', '가지지 않은 유물입니다.'); end if;
  end loop;
  update makcha_state set equipped = (select coalesce(jsonb_agg(distinct v), '[]'::jsonb) from jsonb_array_elements_text(p_relics) v), updated_at = now() where name = m.name;
  perform subway_row(p_name);
  return makcha_view(p_name);
end $$;

grant execute on function public.makcha_state_get(text, text), public.makcha_gacha(text, text), public.makcha_equip(text, text, jsonb) to anon, authenticated;
revoke execute on function public.makcha_view(text) from public, anon, authenticated;

-- 막차 판이 끝나면 코인도 준다(2026-11-05): 통과한 역 1개당 🪙5, 클리어(막차 탑승) 🪙100, 하루에 게임 코인 🪙200까지(서울 날짜, 연구소 게임 코인 한도와 같이 센다)
create or replace function public.makcha_run_finish(p_name text, p_token text, p_job text, p_stages int, p_secs numeric, p_win boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me text := trim(p_name); o record; jr record; s subway_state; today date := (now() at time zone 'Asia/Seoul')::date; earned int; give int;
begin
  if not lab_check_session_grace(p_name, p_token) then return jsonb_build_object('ok', false, 'error', '세션이 유효하지 않습니다.'); end if;
  if not (p_job = any(makcha_jobs())) or p_stages < 0 or p_stages > 24 or p_secs is null or p_secs < 0 or p_secs < p_stages * 10 then
    return jsonb_build_object('ok', false, 'error', '기록이 올바르지 않습니다.'); end if;
  insert into makcha_runs(name, job, stages, secs, win) values (me, p_job, p_stages, round(p_secs, 1), coalesce(p_win, false));
  perform subway_row(p_name);
  select * into s from subway_state where name = me for update;
  earned := p_stages * 5 + case when coalesce(p_win, false) then 100 else 0 end;
  if s.game_day is distinct from today then s.game_today := 0; end if;
  give := least(earned, greatest(0, 200 - s.game_today));
  update subway_state set game_coins = game_coins + give, game_day = today, game_today = s.game_today + give, updated_at = now() where name = me;
  select rk, stages, secs into o from makcha_best(null) where name = me;
  select rk, stages, secs into jr from makcha_best(p_job) where name = me;
  return jsonb_build_object('ok', true,
    'rank', o.rk, 'best', jsonb_build_object('stages', o.stages, 'secs', o.secs),
    'jobRank', jr.rk, 'jobBest', jsonb_build_object('stages', jr.stages, 'secs', jr.secs),
    'players', (select count(*) from makcha_best(null)), 'jobPlayers', (select count(*) from makcha_best(p_job)),
    'earned', earned, 'gained', give, 'coins', subway_eval_coins(me) + s.game_coins + give - s.coins_spent);
end $$;
