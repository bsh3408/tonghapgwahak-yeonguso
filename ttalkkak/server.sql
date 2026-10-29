-- 딸깍 독재자: 실시간 교실용 표와 함수
-- 표 이름은 모두 tk_로 시작하며, 기존 통합과학연구소 표는 건드리지 않는다.
-- 학생(anon)은 표에 직접 접근할 수 없고, 아래 security definer 함수로만 읽고 쓴다.

create extension if not exists pgcrypto;

create table if not exists tk_rooms(
  code        text primary key,
  teacher_key text not null,
  turns       int  not null default 30,
  revealed    boolean not null default false,   -- 2차시: 숨겨진 지표 공개 여부
  voting      boolean not null default false,   -- 3차시: 투표 진행 여부
  created_at  timestamptz not null default now()
);

create table if not exists tk_players(
  id          uuid primary key default gen_random_uuid(),
  room        text not null references tk_rooms(code) on delete cascade,
  secret      text not null,
  name        text not null,
  nation      text not null,
  mode        int  not null,                   -- 1 = 2차시 첫 번째 통치, 2 = 3차시 두 번째 통치
  start_rank  int,
  gdp         numeric not null default 0,
  turn        int  not null default 0,
  done        boolean not null default false,
  ai_count    int not null default 0,
  ai_refused  int not null default 0,
  advice_used int not null default 0,
  purges      int not null default 0,
  blackouts   int not null default 0,
  st          jsonb,                           -- 숨겨진 지표
  ending      text,
  motto       text,
  reflection  text,
  updated_at  timestamptz not null default now(),
  unique(room, mode, name)
);

create table if not exists tk_votes(
  room       text not null references tk_rooms(code) on delete cascade,
  voter      uuid not null references tk_players(id) on delete cascade,
  target     uuid not null references tk_players(id) on delete cascade,
  reason     text,
  created_at timestamptz not null default now(),
  primary key(room, voter)
);

alter table tk_rooms   enable row level security;
alter table tk_players enable row level security;
alter table tk_votes   enable row level security;
-- 정책을 만들지 않으므로 anon은 위 표를 직접 읽거나 쓸 수 없다.

-- 방 만들기 (교사)
create or replace function tk_create_room(p_turns int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c text; k text;
begin
  loop
    c := lpad((floor(random() * 10000))::int::text, 4, '0');
    exit when not exists (select 1 from tk_rooms where code = c);
  end loop;
  k := replace(gen_random_uuid()::text, '-', '');
  insert into tk_rooms(code, teacher_key, turns) values (c, k, case when p_turns = 12 then 12 else 30 end);
  return jsonb_build_object('code', c, 'key', k);
end $$;

-- 방 상태
create or replace function tk_room(p_code text)
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object('ok', true, 'turns', turns, 'revealed', revealed, 'voting', voting)
  from tk_rooms where code = p_code
$$;

-- 학생 입장 (같은 방·같은 판·같은 이름이면 새 판으로 다시 시작)
create or replace function tk_join(p_code text, p_name text, p_nation text, p_mode int, p_start_rank int, p_gdp numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r tk_players; s text; t int;
begin
  select turns into t from tk_rooms where code = p_code;
  if t is null then return jsonb_build_object('ok', false, 'msg', '방 코드를 찾을 수 없습니다'); end if;
  s := replace(gen_random_uuid()::text, '-', '');
  select * into r from tk_players where room = p_code and mode = p_mode and name = left(p_name, 20);
  if found then
    update tk_players set secret = s, nation = left(p_nation, 12), start_rank = p_start_rank, gdp = p_gdp, turn = 0, done = false,
      ai_count = 0, ai_refused = 0, advice_used = 0, purges = 0, blackouts = 0, st = null, ending = null, updated_at = now()
    where id = r.id;
    delete from tk_votes where voter = r.id or target = r.id;
    return jsonb_build_object('ok', true, 'id', r.id, 'secret', s, 'turns', t);
  end if;
  insert into tk_players(room, secret, name, nation, mode, start_rank, gdp)
  values (p_code, s, left(p_name, 20), left(p_nation, 12), p_mode, p_start_rank, p_gdp) returning * into r;
  return jsonb_build_object('ok', true, 'id', r.id, 'secret', s, 'turns', t);
end $$;

-- 학생 기록 갱신
create or replace function tk_update(p_id uuid, p_secret text, p jsonb)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update tk_players set
    gdp         = coalesce((p->>'gdp')::numeric, gdp),
    turn        = coalesce((p->>'turn')::int, turn),
    done        = coalesce((p->>'done')::boolean, done),
    ai_count    = coalesce((p->>'ai_count')::int, ai_count),
    ai_refused  = coalesce((p->>'ai_refused')::int, ai_refused),
    advice_used = coalesce((p->>'advice_used')::int, advice_used),
    purges      = coalesce((p->>'purges')::int, purges),
    blackouts   = coalesce((p->>'blackouts')::int, blackouts),
    st          = coalesce(p->'st', st),
    ending      = coalesce(p->>'ending', ending),
    motto       = coalesce(left(p->>'motto', 60), motto),
    reflection  = coalesce(left(p->>'reflection', 200), reflection),
    updated_at  = now()
  where id = p_id and secret = p_secret;
  return found;
end $$;

-- 반 GDP 순위 (숨겨진 지표는 없음)
create or replace function tk_board(p_code text, p_mode int)
returns table(name text, nation text, gdp numeric, turn int, done boolean, purges int)
language sql security definer set search_path = public as $$
  select name, nation, gdp, turn, done, purges from tk_players
  where room = p_code and mode = p_mode order by gdp desc
$$;

-- 숨겨진 지표 공개 (교사가 공개한 뒤에만 내용이 나온다)
create or replace function tk_reveal(p_code text, p_mode int)
returns table(name text, nation text, gdp numeric, ai_count int, ai_refused int, advice_used int, purges int, blackouts int, st jsonb, ending text)
language sql security definer set search_path = public as $$
  select p.name, p.nation, p.gdp, p.ai_count, p.ai_refused, p.advice_used, p.purges, p.blackouts, p.st, p.ending
  from tk_players p join tk_rooms r on r.code = p.room
  where p.room = p_code and p.mode = p_mode and r.revealed
  order by p.gdp desc
$$;

-- 투표용 나라 카드 (이름과 나라 이름은 빼고 '나라 A, B…'로만)
create or replace function tk_cards(p_code text)
returns table(label text, motto text, gdp numeric, st jsonb, ai_count int, purges int, ending text, reflection text)
language sql security definer set search_path = public as $$
  select chr(64 + (row_number() over (order by p.id))::int), p.motto, p.gdp, p.st, p.ai_count, p.purges, p.ending, p.reflection
  from tk_players p join tk_rooms r on r.code = p.room
  where p.room = p_code and p.mode = 2 and p.done and r.voting
  order by p.id
$$;

-- 투표하기 (자기 나라에는 투표할 수 없고, 다시 하면 바뀐다)
create or replace function tk_vote(p_id uuid, p_secret text, p_label text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me tk_players; tgt uuid;
begin
  select * into me from tk_players where id = p_id and secret = p_secret and mode = 2;
  if not found then return jsonb_build_object('ok', false, 'msg', '먼저 두 번째 통치를 마쳐 주세요'); end if;
  if not exists (select 1 from tk_rooms where code = me.room and voting) then return jsonb_build_object('ok', false, 'msg', '아직 투표 시간이 아닙니다'); end if;
  select id into tgt from (
    select p.id, chr(64 + (row_number() over (order by p.id))::int) as label
    from tk_players p where p.room = me.room and p.mode = 2 and p.done) x
  where x.label = p_label;
  if tgt is null then return jsonb_build_object('ok', false, 'msg', '그런 나라가 없습니다'); end if;
  if tgt = me.id then return jsonb_build_object('ok', false, 'msg', '자기 나라에는 투표할 수 없습니다'); end if;
  insert into tk_votes(room, voter, target, reason) values (me.room, me.id, tgt, left(p_reason, 200))
  on conflict (room, voter) do update set target = excluded.target, reason = excluded.reason, created_at = now();
  return jsonb_build_object('ok', true);
end $$;

-- 교사 버튼 (공개·숨김·투표 열기·투표 닫기)
create or replace function tk_teacher(p_code text, p_key text, p_action text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from tk_rooms where code = p_code and teacher_key = p_key) then
    return jsonb_build_object('ok', false, 'msg', '교사 키가 맞지 않습니다');
  end if;
  update tk_rooms set
    revealed = case p_action when 'reveal' then true when 'hide' then false else revealed end,
    voting   = case p_action when 'vote_open' then true when 'vote_close' then false else voting end
  where code = p_code;
  return (select jsonb_build_object('ok', true, 'revealed', revealed, 'voting', voting) from tk_rooms where code = p_code);
end $$;

-- 교사용: 모든 기록과 투표 결과 (교사 키 필요)
create or replace function tk_teacher_all(p_code text, p_key text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from tk_rooms where code = p_code and teacher_key = p_key) then
    return jsonb_build_object('ok', false, 'msg', '교사 키가 맞지 않습니다');
  end if;
  return jsonb_build_object('ok', true,
    'players', coalesce((select jsonb_agg(to_jsonb(x) order by x.mode, x.gdp desc) from (
      select p.name, p.nation, p.mode, p.start_rank, p.gdp, p.turn, p.done, p.ai_count, p.ai_refused, p.advice_used,
             p.purges, p.blackouts, p.st, p.ending, p.motto, p.reflection,
             case when p.mode = 2 and p.done then chr(64 + (row_number() over (partition by p.mode, p.done order by p.id))::int) end as label,
             (select count(*) from tk_votes v where v.target = p.id) as votes
      from tk_players p where p.room = p_code) x), '[]'::jsonb),
    'reasons', coalesce((select jsonb_agg(jsonb_build_object('target', t.name, 'voter', vt.name, 'reason', v.reason))
      from tk_votes v join tk_players t on t.id = v.target join tk_players vt on vt.id = v.voter where v.room = p_code), '[]'::jsonb));
end $$;

revoke all on tk_rooms, tk_players, tk_votes from anon, authenticated;
grant execute on function tk_create_room(int), tk_room(text), tk_join(text, text, text, int, int, numeric), tk_update(uuid, text, jsonb),
  tk_board(text, int), tk_reveal(text, int), tk_cards(text), tk_vote(uuid, text, text, text), tk_teacher(text, text, text),
  tk_teacher_all(text, text) to anon, authenticated;
