-- ============================================================
-- 통합과학연구소 수행평가 — 수파베이스 테이블 설정
-- Supabase 대시보드 > SQL Editor 에서 이 파일 내용을 그대로 붙여넣고 실행하세요.
-- ============================================================

create table if not exists public.submissions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  student_name text not null,
  class_no text not null,
  chapter_id text not null,       -- 예: ch14_seed_v1 (단원 구분용, chapterdata.js가 자동으로 채움)
  chapter_title text,
  score int,
  total int,
  passed boolean,
  total_sec int,
  leave_count int,
  away_ms int,
  round_results jsonb,            -- 라운드별 정답 여부 [{id,title,kind,ok}, ...]
  opinion_answers jsonb           -- 서술형 라운드 답안 {r7:'...', r8:'...', ...}
);

-- 학생 브라우저는 익명(anon) 키로 접속한다.
-- "제출만 가능, 조회/수정/삭제는 불가능"하도록 행 단위 보안(RLS)을 건다.
alter table public.submissions enable row level security;

drop policy if exists "학생은 제출만 가능" on public.submissions;
create policy "학생은 제출만 가능"
  on public.submissions
  for insert
  to anon
  with check (true);

-- anon 키로는 select/update/delete 정책을 만들지 않으므로 학생은 서로의 결과를 볼 수 없다.
-- 선생님이 전체 결과를 보려면:
--   1) Supabase 대시보드 > Table Editor 에서 직접 확인, 또는
--   2) apps-script-sync 폴더의 스크립트를 구글시트에 붙여넣어 자동 동기화(이 경우 service_role 키를 사용)
