/* 연구소 공통 로그인·세션 관리 (역무실 shinjang_science.html, 게임 subway/index.html이 함께 쓴다)
   - 로그인(lab_login), 비밀번호 바꾸기, 하트비트(동시 로그인 방지), 자동 로그아웃, 이용 시간 제한
   - supabase-config.js를 먼저 불러와야 한다(supaRpc 등 전역 함수)
   - 로그인이 끝나면 window.LAB_ON_LOGIN(student)를 부른다 */
let CURRENT_STUDENT = null;
const TEACHER_TEST_ACCOUNTS = ['변석환', '테스트'];
const RANK_EXCLUDE_ACCOUNTS = [...TEACHER_TEST_ACCOUNTS, '이지숙'];

/* 이용 시간: 월·화·금은 08:30~16:00, 수·목은 08:30~17:00 (2026-09-23 변경).
   ⚠️ 서버(supabase_schema.sql의 lab_service_open)와 항상 같이 고쳐야 한다. */
const SERVICE_OPEN_MIN = 8 * 60 + 30;
const SERVICE_CLOSE_MIN = { Mon: 16 * 60, Tue: 16 * 60, Wed: 17 * 60, Thu: 17 * 60, Fri: 16 * 60 };
function serviceCloseLabel() { return '월·화·금 오후 4시, 수·목 오후 5시'; }
const SCHOOL_HOLIDAYS = ['2026-08-15', '2026-09-24', '2026-09-25', '2026-09-26', '2026-09-27', '2026-10-03', '2026-10-04', '2026-10-05',
  '2026-10-09', '2026-10-10', '2026-10-11', '2026-11-19', '2026-11-20', '2026-12-25', '2027-01-01'];
function isWithinServiceHours() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = t => parts.find(p => p.type === t).value;
  const weekday = get('weekday'), minutes = (+get('hour')) * 60 + (+get('minute')), dateStr = `${get('year')}-${get('month')}-${get('day')}`;
  if (weekday === 'Sat' || weekday === 'Sun' || SCHOOL_HOLIDAYS.includes(dateStr)) return false;
  const close = SERVICE_CLOSE_MIN[weekday]; if (!close) return false;
  return minutes >= SERVICE_OPEN_MIN && minutes < close;
}
const canUseNow = name => isWithinServiceHours() || TEACHER_TEST_ACCOUNTS.includes(name);

/* ---------- 세션 ---------- */
let _hb = null, _hourTimer = null, _idleTimer = null, _lastActivityAt = Date.now(), _hiddenSinceAt = null;
const IDLE_LOGOUT_MS = 15 * 60 * 1000, HIDDEN_LOGOUT_MS = 5 * 60 * 1000;
function labSession() {
  const name = sessionStorage.getItem('lab_logged_in');
  if (!name) return null;
  let studentId = null;
  try { const info = JSON.parse(sessionStorage.getItem('studentInfo') || 'null'); if (info && info.name === name) studentId = info.classNo; } catch (e) {}
  return { name, studentId, sessionToken: sessionStorage.getItem('lab_session_token') || null };
}
function labRpc(fn, params = {}) { return supaRpc(fn, Object.assign({ p_name: CURRENT_STUDENT.name, p_token: CURRENT_STUDENT.sessionToken }, params)); }
function startSessionWatch() {
  clearInterval(_hb); clearInterval(_hourTimer); clearInterval(_idleTimer);
  if (isSupabaseConfigured() && CURRENT_STUDENT && CURRENT_STUDENT.sessionToken) {
    _hb = setInterval(async () => {
      try { const out = await labRpc('lab_session_heartbeat'); if (out && out.kicked) clearSessionAndReload('다른 기기에서 같은 아이디로 로그인해서, 이 기기는 로그아웃됐어요.'); } catch (e) { /* 한 번 실패로는 로그아웃하지 않는다 */ }
    }, 20000);
  }
  _hourTimer = setInterval(() => {
    if (canUseNow(CURRENT_STUDENT && CURRENT_STUDENT.name)) return;
    clearSessionAndReload('🕐 오늘 연구소 문을 닫습니다. 진행한 내용은 모두 저장됐어요. 다음 수업일 오전 8시 30분에 다시 만나요!');
  }, 30000);
  _lastActivityAt = Date.now(); _hiddenSinceAt = null;
  _idleTimer = setInterval(() => {
    if (!CURRENT_STUDENT) return;
    if (Date.now() - _lastActivityAt > IDLE_LOGOUT_MS) { clearSessionAndReload(null, false, true); return; }
    if (_hiddenSinceAt && Date.now() - _hiddenSinceAt > HIDDEN_LOGOUT_MS) clearSessionAndReload(null, true, true);
  }, 20000);
}
['click', 'keydown', 'touchstart', 'pointerdown'].forEach(ev => document.addEventListener(ev, () => { _lastActivityAt = Date.now(); }, { passive: true }));
document.addEventListener('visibilitychange', () => { if (document.hidden) _hiddenSinceAt = Date.now(); else { _lastActivityAt = Date.now(); _hiddenSinceAt = null; } });

/* 서버 세션을 풀고(가능하면) 이 기기의 로그인 흔적을 지운 뒤 역무실(로그인 화면)로 돌아간다.
   keepServerSession: 자동 로그아웃은 이 탭만 정리한다(다른 탭의 제출이 거부되지 않게) */
function clearSessionAndReload(alertMsg, keepalive, keepServerSession) {
  clearInterval(_hb); clearInterval(_hourTimer); clearInterval(_idleTimer);
  if (!keepServerSession && isSupabaseConfigured() && CURRENT_STUDENT && CURRENT_STUDENT.sessionToken)
    supaRpc('lab_session_logout', { p_name: CURRENT_STUDENT.name, p_token: CURRENT_STUDENT.sessionToken }, keepalive ? { keepalive: true } : undefined).catch(() => {});
  ['studentInfo', 'lab_logged_in', 'lab_session_token'].forEach(k => sessionStorage.removeItem(k));
  if (alertMsg) alert(alertMsg);
  if (window.LAB_HOME) location.href = window.LAB_HOME; else location.reload();
}

/* 로그인 화면에서 왔던 곳으로 돌려보낸다(이 사이트의 과제 화면과 게임만 허용) */
function returnToPending() {
  let ret = null; try { ret = sessionStorage.getItem('lab_return_to'); } catch (e) {}
  if (!ret) return false;
  try { sessionStorage.removeItem('lab_return_to'); } catch (e) {}
  if (!/^(챕터\d+_[^\/?#]+\.html(\?mode=(obj|essay))?|subway\/index\.html)$/.test(ret)) return false;
  location.href = ret; return true;
}

/* ---------- 로그인 화면(역무실에서만) ---------- */
function setLoginErr(m) { const e = document.getElementById('loginErr'); if (e) e.textContent = m || ''; }
function setChangeErr(m) { const e = document.getElementById('changeErr'); if (e) e.textContent = m || ''; }
async function doLogin() {
  const name = document.getElementById('loginName').value.trim(), password = document.getElementById('loginPw').value;
  setLoginErr('');
  if (!name || !password) { setLoginErr('이름과 비밀번호를 모두 입력하세요.'); return; }
  if (!canUseNow(name)) { setLoginErr('지금은 이용 가능한 시간이 아니에요. 평일 오전 8시 30분부터 ' + serviceCloseLabel() + '까지 열려요.'); return; }
  try {
    const out = await supaRpc('lab_login', { p_name: name, p_password: password });
    if (!out.ok) { setLoginErr(out.error || '로그인에 실패했습니다.'); return; }
    CURRENT_STUDENT = { name, studentId: out.studentId, sessionToken: out.sessionToken || null };
    if (out.mustChange) { document.getElementById('loginStep1').classList.add('hide'); document.getElementById('loginStep2').classList.remove('hide'); document.getElementById('newPw1').focus(); }
    else finishLogin();
  } catch (e) { setLoginErr('서버 연결 오류: ' + e.message); }
}
async function doChangePassword() {
  const p1 = document.getElementById('newPw1').value, p2 = document.getElementById('newPw2').value;
  setChangeErr('');
  if (p1.length < 4) { setChangeErr('새 비밀번호는 4자 이상이어야 합니다.'); return; }
  if (p1 !== p2) { setChangeErr('두 번 입력한 비밀번호가 서로 달라요.'); return; }
  try {
    const out = await supaRpc('lab_change_password', { p_name: CURRENT_STUDENT.name, p_old: document.getElementById('loginPw').value, p_new: p1 });
    if (!out.ok) { setChangeErr(out.error || '비밀번호 변경에 실패했습니다.'); return; }
    finishLogin();
  } catch (e) { setChangeErr('서버 연결 오류: ' + e.message); }
}
function finishLogin() {
  sessionStorage.setItem('studentInfo', JSON.stringify({ name: CURRENT_STUDENT.name, classNo: CURRENT_STUDENT.studentId }));
  sessionStorage.setItem('lab_logged_in', CURRENT_STUDENT.name);
  if (CURRENT_STUDENT.sessionToken) sessionStorage.setItem('lab_session_token', CURRENT_STUDENT.sessionToken);
  startSessionWatch();
  if (returnToPending()) return;
  window.LAB_ON_LOGIN && window.LAB_ON_LOGIN(CURRENT_STUDENT);
}
function wireLoginForm() {
  document.getElementById('loginBtn').addEventListener('click', doLogin);
  document.getElementById('changeBtn').addEventListener('click', doChangePassword);
  document.getElementById('loginPw').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  document.getElementById('newPw2').addEventListener('keydown', e => { if (e.key === 'Enter') doChangePassword(); });
}
function logout() { if (confirm('로그아웃할까요?')) clearSessionAndReload(); }

/* 이미 로그인한 탭이면 바로 들어간다(이용 시간이 지났으면 들어가지 않는다) */
function tryAutoLogin() {
  const s = labSession();
  if (!s || !canUseNow(s.name)) return false;
  CURRENT_STUDENT = s; finishLogin(); return true;
}

/* 게임처럼 로그인 화면이 없는 쪽: 로그인 안 했으면 역무실로 보내고 돌아올 곳을 남긴다 */
function requireLogin(returnPath, home) {
  window.LAB_HOME = home;
  const s = labSession();
  if (!s || !canUseNow(s.name) || !isSupabaseConfigured()) { try { sessionStorage.setItem('lab_return_to', returnPath); } catch (e) {} location.href = home; return null; }
  CURRENT_STUDENT = s; startSessionWatch(); return s;
}
