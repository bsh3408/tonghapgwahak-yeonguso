-- 2026-11-17 교사 요청: 11월 18일(수) 낮 12시부터 11월 23일(월) 오전 8시 전까지 연구소 접속 차단
-- lab_service_open 맨 앞에 차단 기간을 넣는다(나머지 이용 시간 규칙은 그대로). 교사·테스트 계정은 lab_time_exempt로 계속 쓸 수 있다.
-- 화면 쪽은 lab_auth.js의 CLOSED_RANGES에 같은 기간이 있다.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.lab_service_open(timestamptz)'::regprocedure);
  if position('2026-11-18 12:00' in d) > 0 then raise notice '이미 들어가 있음'; return; end if;
  if position('select case' in d) = 0 then raise exception 'lab_service_open: 바꿀 곳이 없음'; end if;
  execute replace(d, 'select case', 'select case
    when p_at >= ''2026-11-18 12:00:00+09''::timestamptz and p_at < ''2026-11-23 08:00:00+09''::timestamptz then false -- 2026-11-17 교사 요청 접속 차단');
end $$;

select lab_service_open('2026-11-18 11:59:00+09') as "18일 11시59분",
       lab_service_open('2026-11-18 12:00:00+09') as "18일 12시",
       lab_service_open('2026-11-23 08:30:00+09') as "23일 8시30분",
       lab_service_open() as "지금";
