-- 2026-11-25 "문제를 다 풀고 제출하면 로그아웃된다" 제보
-- 원인: 제출용 세션 확인이 lab_service_open(now() - 20분)만 봤다. 마감 뒤 20분 여유를 주려던 것인데,
--      그러면 아침 8:30~8:50에는 "20분 전(8:10~8:30)은 닫혀 있었다"로 판정돼 모든 제출이 거부되고,
--      학생 화면에는 "로그인이 풀렸어요"가 떴다. 지난 14일간 8:30~8:50 제출 기록이 0건이었다.
-- 해결: 지금 열려 있거나(now) 20분 전까지 열려 있었으면(마감 여유) 받는다.
create or replace function public.lab_check_submit(p_name text, p_token text) returns boolean language sql stable as $$
  select (lab_service_open() or lab_service_open(now() - (lab_submit_grace_minutes() || ' minutes')::interval) or lab_time_exempt(p_name))
    and p_token is not null
    and exists(select 1 from lab_students s where s.name = trim(p_name)
               and (s.session_token = p_token or s.prev_tokens @> jsonb_build_array(jsonb_build_object('t', p_token))));
$$;

-- 막차 기록 저장 등 다른 함수가 쓰는 같은 확인 함수도 똑같이 고친다
create or replace function public.lab_check_session_grace(p_name text, p_token text) returns boolean language sql stable as $$
  select (lab_service_open() or lab_service_open(now() - (lab_submit_grace_minutes() || ' minutes')::interval) or lab_time_exempt(p_name))
    and exists(select 1 from lab_students where name = trim(p_name) and session_token = p_token and session_token is not null);
$$;
