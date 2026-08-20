/**
 * 통합과학연구소 — 수파베이스 → 구글시트 자동 동기화
 *
 * [설치 방법]
 * 1) 새 구글시트를 만든다.
 * 2) 확장 프로그램 > Apps Script 를 연다.
 * 3) 기본 코드를 지우고 이 파일 내용을 그대로 붙여넣는다.
 * 4) 왼쪽 톱니바퀴(프로젝트 설정) > 스크립트 속성(Script Properties)에서 아래 두 값을 추가한다.
 *      SUPABASE_URL          예: https://xxxxxxxx.supabase.co
 *      SUPABASE_SERVICE_KEY  Supabase 프로젝트 설정 > API Keys 의 "service_role" 키
 *      (⚠ service_role 키는 모든 데이터에 접근 가능한 비밀키입니다. 절대 학생에게 공유하거나
 *         roundengine.js 같은 학생용 파일에 넣지 마세요. 이 스크립트 속성 안에서만 사용됩니다.)
 * 5) 위쪽 함수 선택 드롭다운에서 setupTrigger 를 고르고 ▶ 실행 버튼을 한 번 누른다.
 *    (처음 실행 시 권한 승인 화면이 뜨면 승인한다)
 * 6) 이후 10분마다 자동으로 새 제출 결과가 시트의 "제출기록" 탭에 쌓인다.
 *    지금 바로 확인하고 싶으면 syncFromSupabase 함수를 직접 실행해도 된다.
 */

const SHEET_NAME = '제출기록';
const HEADER = ['제출시각','이름','반-번호','단원ID','단원명','점수','총문항','통과여부','소요초','창이탈횟수','창이탈누적ms','라운드결과(JSON)','서술답안(JSON)'];

function syncFromSupabase() {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('SUPABASE_URL');
  const key = props.getProperty('SUPABASE_SERVICE_KEY');
  if (!url || !key) {
    throw new Error('스크립트 속성(Script Properties)에 SUPABASE_URL / SUPABASE_SERVICE_KEY를 먼저 설정하세요.');
  }

  const sheet = getOrCreateSheet();
  ensureHeader(sheet);

  const lastSynced = props.getProperty('LAST_SYNCED_AT') || '1970-01-01T00:00:00Z';
  const endpoint = url.replace(/\/$/, '') +
    '/rest/v1/submissions?created_at=gt.' + encodeURIComponent(lastSynced) +
    '&order=created_at.asc&limit=1000';

  const res = UrlFetchApp.fetch(endpoint, {
    method: 'get',
    headers: { apikey: key, Authorization: 'Bearer ' + key },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) {
    throw new Error('수파베이스 응답 오류(' + res.getResponseCode() + '): ' + res.getContentText());
  }

  const rows = JSON.parse(res.getContentText());
  if (rows.length === 0) return;

  rows.forEach(r => {
    sheet.appendRow([
      r.created_at,
      r.student_name,
      r.class_no,
      r.chapter_id,
      r.chapter_title,
      r.score,
      r.total,
      r.passed ? '통과' : '미통과',
      r.total_sec,
      r.leave_count,
      r.away_ms,
      JSON.stringify(r.round_results || []),
      JSON.stringify(r.opinion_answers || {})
    ]);
  });

  props.setProperty('LAST_SYNCED_AT', rows[rows.length - 1].created_at);
}

function getOrCreateSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
}

function ensureHeader(sheet) {
  if (sheet.getLastRow() > 0) return;
  sheet.appendRow(HEADER);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, HEADER.length).setFontWeight('bold');
}

/** 최초 1회만 실행: 10분마다 자동 동기화되는 트리거를 설치한다 */
function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'syncFromSupabase') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('syncFromSupabase').timeBased().everyMinutes(10).create();
  syncFromSupabase(); // 설치와 동시에 한 번 즉시 동기화
}
