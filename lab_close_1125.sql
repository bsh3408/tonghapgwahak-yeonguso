-- 2026-11-25 교사 요청: 오늘 오후 5시부터 연구소 운영 종료(학생 접속 닫음)
-- lab_service_open 맨 앞에 종료 시각을 넣는다. 교사·테스트 계정은 lab_time_exempt로 계속 쓸 수 있다.
-- 제출은 마감 뒤 20분 여유(lab_submit_grace_minutes)가 있어서 5시 20분 전까지 낸 답은 받는다.
-- 화면 쪽은 lab_auth.js의 CLOSED_RANGES에 같은 시각이 있다. 다시 열려면 두 곳 모두에서 이 줄을 지운다.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.lab_service_open(timestamptz)'::regprocedure);
  if position('2026-11-25 17:00' in d) > 0 then raise notice '이미 들어가 있음'; return; end if;
  if position('select case' in d) = 0 then raise exception 'lab_service_open: 바꿀 곳이 없음'; end if;
  execute replace(d, 'select case', 'select case
    when p_at >= ''2026-11-25 17:00:00+09''::timestamptz then false -- 2026-11-25 교사 요청 운영 종료');
end $$;
