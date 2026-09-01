// 정적 파일 서버 (프로토타입 미리보기용) + 교사용 관리 페이지 저장 API + 제출기록 모의 저장소 + 학생 로그인
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { execFile } = require('child_process');
const ROOT = path.resolve(process.argv[2]);
const PORT = +(process.env.PORT || process.argv[3] || 5173);
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8', '.md':'text/markdown; charset=utf-8',
  '.json':'application/json; charset=utf-8', '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml' };

const DATA_DIR = path.join(ROOT, 'data');
const MOCK_SUBMISSIONS_FILE = path.join(DATA_DIR, '_submissions_mock.json');
const STUDENTS_FILE = path.join(DATA_DIR, '_students.json');
const LABSCORES_FILE = path.join(DATA_DIR, '_labscores.json');
const DEPTCONFIG_FILE = path.join(DATA_DIR, '_deptconfig.json');
const BOARD_FILE = path.join(DATA_DIR, '_board.json');
const REDO_FILE = path.join(DATA_DIR, '_redorequests.json');
const JOURNAL_FILE = path.join(DATA_DIR, '_journalanswers.json');
const LOBBY_HTML_FILE = path.join(ROOT, 'shinjang_science.html');
const ADMIN_HTML_FILE = path.join(ROOT, 'teacher.html');

/* ---------- 수파베이스(학생 로그인 원본 저장소) ----------
   학생 로그인은 이제 shinjang_science.html이 수파베이스 RPC(lab_login 등)를 직접 호출해서 처리하므로,
   이 로컬 서버(교사 컴퓨터에서만 켜짐)가 관리하는 명단(roster)도 같은 lab_students 테이블에 써야
   학생들이 실제로 로그인할 수 있다. supabase-config.js와 같은 URL/anon key를 그대로 쓴다. */
const SUPABASE_URL = 'https://oqhldrkmcewcjslciqmp.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9xaGxkcmttY2V3Y2pzbGNpcW1wIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODcyNDQ4MDIsImV4cCI6MjEwMjgyMDgwMn0.It7aXZ5utrWEoAv9rniGFWQGzJNcDaSzmcAaAoT9GyM';
async function supaRpc(fnName, params) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fnName}`, {
    method: 'POST',
    headers: { 'Content-Type':'application/json', 'apikey': SUPABASE_ANON_KEY, 'Authorization': 'Bearer '+SUPABASE_ANON_KEY },
    body: JSON.stringify(params || {})
  });
  const text = await res.text();
  if (!res.ok) throw new Error('supabase rpc 실패: ' + text);
  return text ? JSON.parse(text) : null;
}

function readJsonBody(req, maxLen, cb) {
  let body = '';
  req.on('data', chunk => { body += chunk; if (body.length > maxLen) req.destroy(); });
  req.on('end', () => {
    try { cb(null, JSON.parse(body)); }
    catch (e) { cb(e); }
  });
}
function sendJson(res, code, obj) {
  res.writeHead(code, {'Content-Type':'application/json; charset=utf-8'});
  res.end(JSON.stringify(obj));
}

/* ---------- 학생 로그인 (아이디=이름, 처음 비밀번호=학번, 최초 로그인 후 변경 필수) ---------- */
function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}
function verifyPassword(password, salt, hash) {
  const test = Buffer.from(hashPassword(password, salt), 'hex');
  const real = Buffer.from(hash, 'hex');
  if (test.length !== real.length) return false;
  return crypto.timingSafeEqual(test, real);
}
function readStudents() {
  try { return JSON.parse(fs.readFileSync(STUDENTS_FILE, 'utf-8')); }
  catch (e) { return []; }
}
function writeStudents(list) {
  fs.writeFileSync(STUDENTS_FILE, JSON.stringify(list, null, 2), 'utf-8');
}
function findStudent(list, name) {
  return list.find(s => s.name === name);
}

// GET /api/roster?teacherPassword=...  |  POST /api/roster { teacherPassword, students:[{name, studentId}, ...] }
// 교사가 명단을 등록/추가한다. 이미 등록된 이름은 비밀번호·변경여부를 건드리지 않는다(재업로드해도 안전).
// 학생 로그인은 shinjang_science.html이 수파베이스를 직접 보므로, 여기서도 로컬 파일이 아니라
// 같은 lab_students 테이블에(lab_roster_* RPC — 교사 비밀번호로 보호됨) 써야 실제로 로그인할 수 있다.
function handleRoster(req, res, query) {
  if (req.method === 'GET') {
    const teacherPassword = query.get('teacherPassword') || '';
    return supaRpc('lab_roster_list', { p_teacher_password: teacherPassword })
      .then(out => {
        if (Array.isArray(out)) return sendJson(res, 200, out.map(s => ({ name: s.name, studentId: s.studentId, mustChange: s.mustChange, loggedIn: s.loggedIn })));
        return sendJson(res, 403, out); // {ok:false, error:'교사 비밀번호가 올바르지 않습니다.'}
      })
      .catch(e => sendJson(res, 500, { ok:false, error: e.message }));
  }
  if (req.method === 'POST') {
    return readJsonBody(req, 2_000_000, (err, body) => {
      if (err || !Array.isArray(body && body.students)) return sendJson(res, 400, { ok:false, error:'invalid body' });
      const students = body.students
        .map(s => ({ name: String(s.name || '').trim(), studentId: String(s.studentId || '').trim() }))
        .filter(s => s.name && s.studentId);
      supaRpc('lab_roster_add', { p_teacher_password: body.teacherPassword || '', p_students: students })
        .then(out => sendJson(res, out && out.ok ? 200 : 403, out))
        .catch(e => sendJson(res, 500, { ok:false, error: e.message }));
    });
  }
  res.writeHead(405); res.end('method not allowed');
  // DELETE(전체 명단 비우기)는 되돌릴 수 없는 위험한 동작이라 일부러 여기서 지원하지 않는다 —
  // 필요하면 수파베이스 SQL 편집기에서 "delete from lab_students;"를 직접 실행한다.
}

// POST /api/roster-resetpw  { teacherPassword, name } — 그 학생의 비밀번호를 학번으로 되돌리고 mustChange를 켠다.
function handleRosterResetPw(req, res) {
  if (req.method !== 'POST') { res.writeHead(405); return res.end('method not allowed'); }
  readJsonBody(req, 10_000, (err, body) => {
    if (err) return sendJson(res, 400, { ok:false, error:'invalid body' });
    const name = String(body.name || '').trim();
    supaRpc('lab_roster_resetpw', { p_teacher_password: body.teacherPassword || '', p_name: name })
      .then(out => sendJson(res, out && out.ok ? 200 : 403, out))
      .catch(e => sendJson(res, 500, { ok:false, error: e.message }));
  });
}

// POST /api/roster-remove  { teacherPassword, name } — 그 학생 계정 하나만 명단에서 지운다(과제 기록은 안 지움).
function handleRosterRemove(req, res) {
  if (req.method !== 'POST') { res.writeHead(405); return res.end('method not allowed'); }
  readJsonBody(req, 10_000, (err, body) => {
    if (err) return sendJson(res, 400, { ok:false, error:'invalid body' });
    const name = String(body.name || '').trim();
    supaRpc('lab_roster_remove', { p_teacher_password: body.teacherPassword || '', p_name: name })
      .then(out => sendJson(res, out && out.ok ? 200 : 403, out))
      .catch(e => sendJson(res, 500, { ok:false, error: e.message }));
  });
}

// POST /api/login  { name, password }
function handleLogin(req, res) {
  if (req.method !== 'POST') { res.writeHead(405); return res.end('method not allowed'); }
  readJsonBody(req, 10_000, (err, body) => {
    if (err) return sendJson(res, 400, { ok:false, error:'invalid body' });
    const name = String(body.name || '').trim();
    const password = String(body.password || '');
    const list = readStudents();
    const student = findStudent(list, name);
    if (!student) return sendJson(res, 200, { ok:false, error:'등록되지 않은 이름입니다. 선생님께 문의하세요.' });
    if (!verifyPassword(password, student.salt, student.passwordHash)) {
      return sendJson(res, 200, { ok:false, error:'비밀번호가 올바르지 않습니다.' });
    }
    student.loggedInAt = new Date().toISOString();
    writeStudents(list);
    return sendJson(res, 200, { ok:true, mustChange: !!student.mustChange, studentId: student.studentId });
  });
}

// POST /api/change-password  { name, oldPassword, newPassword }
function handleChangePassword(req, res) {
  if (req.method !== 'POST') { res.writeHead(405); return res.end('method not allowed'); }
  readJsonBody(req, 10_000, (err, body) => {
    if (err) return sendJson(res, 400, { ok:false, error:'invalid body' });
    const name = String(body.name || '').trim();
    const oldPassword = String(body.oldPassword || '');
    const newPassword = String(body.newPassword || '');
    if (newPassword.length < 4) return sendJson(res, 200, { ok:false, error:'새 비밀번호는 4자 이상이어야 합니다.' });
    const list = readStudents();
    const student = findStudent(list, name);
    if (!student) return sendJson(res, 200, { ok:false, error:'등록되지 않은 이름입니다.' });
    if (!verifyPassword(oldPassword, student.salt, student.passwordHash)) {
      return sendJson(res, 200, { ok:false, error:'기존 비밀번호가 올바르지 않습니다.' });
    }
    const salt = crypto.randomBytes(16).toString('hex');
    student.salt = salt;
    student.passwordHash = hashPassword(newPassword, salt);
    student.mustChange = false;
    writeStudents(list);
    return sendJson(res, 200, { ok:true });
  });
}

// 연구점수 랭킹 저장소. 학생 이름을 키로 upsert하고, 전체 목록을 연구점수 내림차순으로 돌려준다.
function readLabScores() {
  try { return JSON.parse(fs.readFileSync(LABSCORES_FILE, 'utf-8')); }
  catch (e) { return []; }
}
function handleLabScore(req, res) {
  if (req.method === 'GET') {
    const list = readLabScores().slice().sort((a, b) => (b.researchScore||0) - (a.researchScore||0));
    return sendJson(res, 200, list);
  }
  if (req.method === 'POST') {
    return readJsonBody(req, 10_000, (err, body) => {
      if (err) return sendJson(res, 400, { ok:false, error:'invalid body' });
      const name = String(body.name || '').trim();
      const classNo = String(body.classNo || '').trim();
      const researchScore = Math.max(0, +body.researchScore || 0);
      if (!name) return sendJson(res, 400, { ok:false, error:'name required' });
      const list = readLabScores();
      const existing = list.find(s => s.name === name);
      if (existing) { existing.classNo = classNo; existing.researchScore = researchScore; existing.updatedAt = new Date().toISOString(); }
      else list.push({ name, classNo, researchScore, updatedAt: new Date().toISOString() });
      fs.writeFileSync(LABSCORES_FILE, JSON.stringify(list, null, 2), 'utf-8');
      return sendJson(res, 200, { ok:true });
    });
  }
  if (req.method === 'DELETE') {
    fs.writeFileSync(LABSCORES_FILE, '[]', 'utf-8');
    return sendJson(res, 200, { ok:true });
  }
  res.writeHead(405); res.end('method not allowed');
}

// 연구동 공개 여부·마감일 설정. 교사용 관리 페이지에서 저장하면 학생 로비가 이걸 읽어 DEPTS.open/dueDate를 덮어쓴다.
function readDeptConfig() {
  try { return JSON.parse(fs.readFileSync(DEPTCONFIG_FILE, 'utf-8')); }
  catch (e) { return {}; }
}
function handleDeptConfig(req, res) {
  if (req.method === 'GET') return sendJson(res, 200, readDeptConfig());
  if (req.method === 'POST') {
    return readJsonBody(req, 20_000, (err, body) => {
      if (err || typeof body !== 'object') return sendJson(res, 400, { ok:false, error:'invalid body' });
      const { teacherPassword, ...cfg } = body;
      fs.writeFileSync(DEPTCONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf-8');
      // 학생 로비는 이제 이 설정을 수파베이스(lab_deptconfig)에서 읽으므로, 여기도 같이 반영해야 실제로 보인다.
      supaRpc('lab_deptconfig_save', { p_teacher_password: teacherPassword || '', p_data: cfg })
        .then(out => sendJson(res, out && out.ok ? 200 : 403, out))
        .catch(e => sendJson(res, 500, { ok:false, error: e.message }));
    });
  }
  res.writeHead(405); res.end('method not allowed');
}

/* ---------- 🛠 오류신고 / Q&A 게시판 ---------- */
function readJsonList(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf-8')); }
  catch (e) { return []; }
}
function writeJsonList(file, list) {
  fs.writeFileSync(file, JSON.stringify(list, null, 2), 'utf-8');
}
function genId(prefix) { return prefix + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8); }

// GET /api/board -> 전체 목록(최신순은 클라이언트에서 정렬). POST -> 새 글 작성.
function handleBoard(req, res) {
  if (req.method === 'GET') return sendJson(res, 200, readJsonList(BOARD_FILE));
  if (req.method === 'POST') {
    return readJsonBody(req, 50_000, (err, body) => {
      if (err) return sendJson(res, 400, { ok:false, error:'invalid body' });
      const type = body.type === 'bug' ? 'bug' : 'qna';
      const name = String(body.name || '').trim();
      const classNo = String(body.classNo || '').trim();
      const title = String(body.title || '').trim().slice(0, 200);
      const content = String(body.content || '').trim().slice(0, 4000);
      if (!name || !title || !content) return sendJson(res, 400, { ok:false, error:'이름·제목·내용은 필수입니다.' });
      const list = readJsonList(BOARD_FILE);
      list.push({ id: genId('post'), type, name, classNo, title, content,
        reply: null, repliedAt: null, resolved: false, createdAt: new Date().toISOString() });
      writeJsonList(BOARD_FILE, list);
      return sendJson(res, 200, { ok:true });
    });
  }
  res.writeHead(405); res.end('method not allowed');
}
// POST /api/board-reply { id, reply } — 교사가 답변을 달면 자동으로 해결됨 처리.
function handleBoardReply(req, res) {
  if (req.method !== 'POST') { res.writeHead(405); return res.end('method not allowed'); }
  readJsonBody(req, 10_000, (err, body) => {
    if (err) return sendJson(res, 400, { ok:false, error:'invalid body' });
    const list = readJsonList(BOARD_FILE);
    const post = list.find(p => p.id === body.id);
    if (!post) return sendJson(res, 404, { ok:false, error:'글을 찾을 수 없습니다.' });
    post.reply = String(body.reply || '').trim().slice(0, 4000);
    post.repliedAt = new Date().toISOString();
    post.resolved = true;
    writeJsonList(BOARD_FILE, list);
    return sendJson(res, 200, { ok:true });
  });
}
// POST /api/board-delete { id }
function handleBoardDelete(req, res) {
  if (req.method !== 'POST') { res.writeHead(405); return res.end('method not allowed'); }
  readJsonBody(req, 10_000, (err, body) => {
    if (err) return sendJson(res, 400, { ok:false, error:'invalid body' });
    const list = readJsonList(BOARD_FILE).filter(p => p.id !== body.id);
    writeJsonList(BOARD_FILE, list);
    return sendJson(res, 200, { ok:true });
  });
}

/* ---------- 🚩 서술답안 다시쓰기 요청 (교사→학생) ---------- */
// 학생이 /api/journal-answers로 같은 (student_name,chapter_id,round_id) 답을 다시 저장하면 자동으로 지워진다.
function redoKey(r) { return [r.student_name, r.chapter_id, r.round_id].join('::'); }
function handleRedoRequests(req, res, query) {
  if (req.method === 'GET') {
    const list = readJsonList(REDO_FILE);
    const student = query.get('student');
    return sendJson(res, 200, student ? list.filter(r => r.student_name === student) : list);
  }
  if (req.method === 'POST') {
    return readJsonBody(req, 20_000, (err, body) => {
      if (err) return sendJson(res, 400, { ok:false, error:'invalid body' });
      const entry = {
        student_name: String(body.student_name || '').trim(),
        class_no: String(body.class_no || '').trim(),
        chapter_id: String(body.chapter_id || '').trim(),
        chapter_title: String(body.chapter_title || '').trim(),
        round_id: String(body.round_id || '').trim(),
        round_title: String(body.round_title || '').trim(),
        note: String(body.note || '').trim().slice(0, 1000),
      };
      if (!entry.student_name || !entry.chapter_id || !entry.round_id) return sendJson(res, 400, { ok:false, error:'invalid body' });
      const list = readJsonList(REDO_FILE);
      const existing = list.find(r => redoKey(r) === redoKey(entry));
      if (existing) { Object.assign(existing, entry); existing.createdAt = new Date().toISOString(); }
      else list.push(Object.assign({ id: genId('redo'), createdAt: new Date().toISOString() }, entry));
      writeJsonList(REDO_FILE, list);
      return sendJson(res, 200, { ok:true });
    });
  }
  res.writeHead(405); res.end('method not allowed');
}
// POST /api/redo-requests-clear { id } — 교사가 수동으로 요청을 취소할 때
function handleRedoRequestsClear(req, res) {
  if (req.method !== 'POST') { res.writeHead(405); return res.end('method not allowed'); }
  readJsonBody(req, 10_000, (err, body) => {
    if (err) return sendJson(res, 400, { ok:false, error:'invalid body' });
    const list = readJsonList(REDO_FILE).filter(r => r.id !== body.id);
    writeJsonList(REDO_FILE, list);
    return sendJson(res, 200, { ok:true });
  });
}

/* ---------- 📝 서술답안 최신본 저장소 (최초 제출 + 이후 "다시 쓰기" 수정본을 계속 덮어씀) ---------- */
function journalKey(r) { return [r.student_name, r.chapter_id, r.round_id].join('::'); }
function handleJournalAnswers(req, res, query) {
  if (req.method === 'GET') {
    const list = readJsonList(JOURNAL_FILE);
    const student = query.get('student');
    return sendJson(res, 200, student ? list.filter(r => r.student_name === student) : list);
  }
  if (req.method === 'POST') {
    return readJsonBody(req, 20_000, (err, body) => {
      if (err) return sendJson(res, 400, { ok:false, error:'invalid body' });
      const entry = {
        student_name: String(body.student_name || '').trim(),
        class_no: String(body.class_no || '').trim(),
        chapter_id: String(body.chapter_id || '').trim(),
        chapter_title: String(body.chapter_title || '').trim(),
        round_id: String(body.round_id || '').trim(),
        round_title: String(body.round_title || '').trim(),
        text: String(body.text || ''),
      };
      if (!entry.student_name || !entry.chapter_id || !entry.round_id) return sendJson(res, 400, { ok:false, error:'invalid body' });
      const list = readJsonList(JOURNAL_FILE);
      const existing = list.find(r => journalKey(r) === journalKey(entry));
      if (existing) { Object.assign(existing, entry); existing.updatedAt = new Date().toISOString(); }
      else list.push(Object.assign({ id: genId('jrn'), updatedAt: new Date().toISOString() }, entry));
      writeJsonList(JOURNAL_FILE, list);
      // 다시 쓴 답을 저장했으니, 같은 문항에 걸려 있던 "다시 써주세요" 요청은 자동으로 해제한다.
      const redoList = readJsonList(REDO_FILE).filter(r => redoKey(r) !== journalKey(entry));
      writeJsonList(REDO_FILE, redoList);
      return sendJson(res, 200, { ok:true });
    });
  }
  res.writeHead(405); res.end('method not allowed');
}

/* ---------- 연구동별 단원 목록 조회 + 새 단원(챕터) 생성 ---------- */
// shinjang_science.html의 DEPTS 배열을 정규식으로 읽어 {id, name, chapters:[번호,...]} 목록을 만든다.
// 이 배열이 "진짜" 연구동-단원 매핑이라, 관리자 페이지는 매번 이걸 다시 읽어서 사이드바를 그린다.
function readDeptChapters() {
  let html;
  try { html = fs.readFileSync(LOBBY_HTML_FILE, 'utf-8'); } catch (e) { return []; }
  const deptRe = /\{id:'(d\d+)',n:'([^']+)'[\s\S]*?ms:\[([\s\S]*?)\]\}/g;
  const out = [];
  let m;
  while ((m = deptRe.exec(html))) {
    const chapters = [...m[3].matchAll(/chapterMissions\('ch(\d+)'/g)].map(x => +x[1]);
    out.push({ id: m[1], name: m[2], chapters });
  }
  return out;
}
function handleDeptChapters(req, res) {
  if (req.method !== 'GET') { res.writeHead(405); return res.end('method not allowed'); }
  return sendJson(res, 200, readDeptChapters());
}

function jsEsc(s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

function buildChapterWrapperHtml(num, title) {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="roundstyle.css">
</head>
<body>
<div class="wrap">
  <div id="top"></div>
  <div id="app"></div>
</div>
<script src="supabase-config.js"></script>
<script src="roundengine.js"></script>
<script src="chapterdata.js"></script>
<script>
loadChapterData('data/ch${num}.json').then(({ROUNDS, META}) => startSession(ROUNDS, META));
</script>
</body>
</html>
`;
}

// POST /api/newchapter  { deptId, num, title, slug, cp, mj, targetMin } — 새 단원을 통째로 만든다.
// 1) data/chN.json 생성 2) 챕터N_slug.html 생성 3) shinjang_science.html의 해당 연구동 ms 배열에 ...chapterMissions(...) 추가
// 4) teacher.html의 CHAPTERS 배열에 항목 추가. 3)·4)는 파일 텍스트를 직접 편집하는 방식이라
// 실패해도(형식이 바뀌었거나 등) 1)·2)는 이미 만들어졌으니 warnings로 알리고 수동 추가를 안내한다.
function handleNewChapter(req, res) {
  if (req.method !== 'POST') { res.writeHead(405); return res.end('method not allowed'); }
  readJsonBody(req, 200_000, (err, body) => {
    if (err || typeof body !== 'object') return sendJson(res, 400, { ok:false, error:'invalid body' });
    const num = String(body.num || '').trim();
    const deptId = String(body.deptId || '').trim();
    const title = String(body.title || '').trim();
    const slug = String(body.slug || '').trim();
    const cp = String(body.cp || '').trim();
    const mj = String(body.mj || 'etc').trim();
    const targetMin = Math.max(1, +body.targetMin || 20);
    if (!/^\d+$/.test(num)) return sendJson(res, 400, { ok:false, error:'단원 번호가 올바르지 않습니다.' });
    if (!title || !slug || !deptId) return sendJson(res, 400, { ok:false, error:'제목·슬러그·연구동은 필수입니다.' });
    if (!/^[a-zA-Z0-9가-힣_]+$/.test(slug)) return sendJson(res, 400, { ok:false, error:'슬러그에는 한글/영문/숫자/밑줄만 쓸 수 있습니다.' });

    const dataFile = path.join(DATA_DIR, `ch${num}.json`);
    if (fs.existsSync(dataFile)) return sendJson(res, 400, { ok:false, error:`ch${num}.json이 이미 있어요. 다른 번호를 쓰세요.` });
    const htmlFile = path.join(ROOT, `챕터${num}_${slug}.html`);
    if (fs.existsSync(htmlFile)) return sendJson(res, 400, { ok:false, error:'같은 이름의 단원 파일이 이미 있어요.' });

    const chapterJson = {
      seedKey: `ch${num}_seed_v1`, vars: {},
      meta: { title, targetMin, passCount: 0,
        scoreNotice: '라운드별 정답률·소요시간·창 이탈 지표는 채점을 돕는 참고 자료일 뿐입니다. 실제 수행평가 점수는 선생님이 최종 확정합니다.' },
      rounds: [
        { id: 'r1', kind: 'opinion', title: '의견 라운드', prompt: '▶ 문제 내용을 여기에 입력하세요.', placeholder: '', minLen: 20 }
      ]
    };

    try {
      fs.writeFileSync(dataFile, JSON.stringify(chapterJson, null, 2), 'utf-8');
      fs.writeFileSync(htmlFile, buildChapterWrapperHtml(num, title), 'utf-8');
    } catch (e) {
      return sendJson(res, 500, { ok:false, error:'파일 생성 실패: ' + e.message });
    }

    const warnings = [];
    try {
      let lobbyHtml = fs.readFileSync(LOBBY_HTML_FILE, 'utf-8');
      const deptRe = new RegExp(`(\\{id:'${deptId}'[\\s\\S]*?)\\]\\}`);
      if (deptRe.test(lobbyHtml)) {
        const missionLine = `...chapterMissions('ch${num}',{num:${num},slug:'${jsEsc(slug)}',t:'${jsEsc(title)}',cp:'${jsEsc(cp)}',mj:'${jsEsc(mj)}'})`;
        lobbyHtml = lobbyHtml.replace(deptRe, (m, p1) => p1 + ',\n  ' + missionLine + ']}');
        fs.writeFileSync(LOBBY_HTML_FILE, lobbyHtml, 'utf-8');
      } else {
        warnings.push('학생 로비의 연구동 목록에 자동으로 넣지 못했어요. shinjang_science.html의 DEPTS 배열에 직접 추가해주세요.');
      }
    } catch (e) { warnings.push('학생 로비 갱신 실패: ' + e.message); }

    try {
      let adminHtml = fs.readFileSync(ADMIN_HTML_FILE, 'utf-8');
      const chaptersRe = /(const CHAPTERS = \[[\s\S]*?)\n\];/;
      if (chaptersRe.test(adminHtml)) {
        const entry = `  {file:'ch${num}.json', label:'${num}단원(${jsEsc(title)})'},`;
        adminHtml = adminHtml.replace(chaptersRe, (m, p1) => p1 + '\n' + entry + '\n];');
        fs.writeFileSync(ADMIN_HTML_FILE, adminHtml, 'utf-8');
      } else {
        warnings.push('관리자 페이지 단원 목록에 자동으로 넣지 못했어요. CHAPTERS 배열에 직접 추가해주세요.');
      }
    } catch (e) { warnings.push('관리자 페이지 갱신 실패: ' + e.message); }

    return sendJson(res, 200, { ok:true, num, warnings });
  });
}

function serveStatic(req, res) {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/shinjang_science.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404, {'Content-Type':'text/plain; charset=utf-8'}); return res.end('not found: ' + p); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
    res.end(d);
  });
}

// data/ch14.json 저장 직후, 같은 번호의 챕터 HTML(챕터14_*.html) 안에 있는
// <script id="embeddedChapterData"> 스냅샷도 같이 갱신한다.
// 이래야 더블클릭(file://)으로 직접 열어도 최신 내용이 보인다.
function syncEmbeddedFallback(filename, parsed) {
  const num = filename.match(/^ch(\d+)\.json$/)[1];
  let htmlFile;
  try {
    htmlFile = fs.readdirSync(ROOT).find(f => new RegExp(`^챕터${num}_.*\\.html$`).test(f));
  } catch (e) { return; }
  if (!htmlFile) return;
  const htmlPath = path.join(ROOT, htmlFile);
  let html;
  try { html = fs.readFileSync(htmlPath, 'utf-8'); } catch (e) { return; }

  const json = JSON.stringify(parsed, null, 2).replace(/<\/script/gi, '<\\/script');
  const snapshotTag = `<script type="application/json" id="embeddedChapterData">${json}</script>`;
  const re = /<script type="application\/json" id="embeddedChapterData">[\s\S]*?<\/script>/;

  let next;
  if (re.test(html)) {
    next = html.replace(re, snapshotTag);
  } else {
    // 아직 스냅샷 태그가 없으면 chapterdata.js 스크립트 태그 앞에 새로 끼워 넣는다
    next = html.replace(/<script src="chapterdata\.js"><\/script>/, snapshotTag + '\n<script src="chapterdata.js"></script>');
  }
  if (next !== html) fs.writeFileSync(htmlPath, next, 'utf-8');
  return htmlFile;
}

// git add → commit → push를 순서대로 실행. 실패해도 저장 자체는 이미 끝난 뒤라 예외를 던지지 않고
// {ok, error} 형태로만 알려준다(교사용 페이지가 "깃허브 반영" 상태를 배지로 보여줄 수 있게).
function runGit(args) {
  return new Promise((resolve, reject) => {
    execFile('git', ['-C', ROOT, ...args], { timeout: 20000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(stderr || err.message));
      resolve(stdout);
    });
  });
}
async function gitAutoSync(files, message) {
  try {
    await runGit(['add', ...files]);
    const status = await runGit(['status', '--porcelain', '--', ...files]);
    if (!status.trim()) return { ok: true, pushed: false, reason: 'no-changes' };
    await runGit(['commit', '-m', message]);
    await runGit(['push']);
    return { ok: true, pushed: true };
  } catch (e) {
    return { ok: false, pushed: false, error: e.message };
  }
}

// PUT /api/data/ch14.json  { ...json body... } -> data/ch14.json 저장
function saveChapterData(req, res, filename) {
  if (!/^ch\d+\.json$/.test(filename)) { res.writeHead(400); return res.end('invalid filename'); }
  const target = path.join(DATA_DIR, filename);
  if (!target.startsWith(DATA_DIR)) { res.writeHead(403); return res.end('forbidden'); }
  let body = '';
  req.on('data', chunk => { body += chunk; if (body.length > 5_000_000) req.destroy(); });
  req.on('end', () => {
    let parsed;
    try { parsed = JSON.parse(body); }
    catch (e) { res.writeHead(400, {'Content-Type':'application/json; charset=utf-8'}); return res.end(JSON.stringify({ok:false, error:'invalid json: '+e.message})); }
    fs.writeFile(target, JSON.stringify(parsed, null, 2), 'utf-8', async (err) => {
      if (err) { res.writeHead(500, {'Content-Type':'application/json; charset=utf-8'}); return res.end(JSON.stringify({ok:false, error:err.message})); }
      let htmlFile;
      try { htmlFile = syncEmbeddedFallback(filename, parsed); } catch (e) { /* 스냅샷 갱신 실패해도 저장 자체는 성공으로 처리 */ }
      const gitFiles = ['data/' + filename].concat(htmlFile ? [htmlFile] : []);
      const sync = await gitAutoSync(gitFiles, `문제 데이터 자동 반영: ${filename}`);
      res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
      res.end(JSON.stringify({ok:true, sync}));
    });
  });
}

function readMockSubmissions() {
  try { return JSON.parse(fs.readFileSync(MOCK_SUBMISSIONS_FILE, 'utf-8')); }
  catch (e) { return []; }
}

// 수파베이스 연결 전, 실제 흐름을 미리 확인해보기 위한 모의(mock) 제출 저장소.
// 실제 수파베이스 REST API와 같은 경로 모양(/rest/v1/submissions)을 흉내낸다.
// POST -> 한 건 저장, GET -> 전체 목록, DELETE -> 전체 비우기(테스트 초기화용)
function handleMockSubmissions(req, res) {
  if (req.method === 'GET') {
    res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
    return res.end(JSON.stringify(readMockSubmissions()));
  }
  if (req.method === 'DELETE') {
    fs.writeFileSync(MOCK_SUBMISSIONS_FILE, '[]', 'utf-8');
    res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
    return res.end(JSON.stringify({ok:true}));
  }
  if (req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; if (body.length > 1_000_000) req.destroy(); });
    req.on('end', () => {
      let parsed;
      try { parsed = JSON.parse(body); }
      catch (e) { res.writeHead(400, {'Content-Type':'application/json; charset=utf-8'}); return res.end(JSON.stringify({ok:false, error:'invalid json: '+e.message})); }
      const list = readMockSubmissions();
      parsed.id = 'mock-' + Date.now() + '-' + Math.random().toString(36).slice(2,8);
      parsed.created_at = new Date().toISOString();
      list.push(parsed);
      fs.writeFileSync(MOCK_SUBMISSIONS_FILE, JSON.stringify(list, null, 2), 'utf-8');
      res.writeHead(200, {'Content-Type':'application/json; charset=utf-8'});
      res.end(JSON.stringify({ok:true}));
    });
    return;
  }
  res.writeHead(405); res.end('method not allowed');
}

http.createServer((req, res) => {
  const urlObj = new URL(req.url, 'http://localhost');
  const p = decodeURIComponent(urlObj.pathname);
  const query = urlObj.searchParams;
  const m = p.match(/^\/api\/data\/(ch\d+\.json)$/);
  if (req.method === 'PUT' && m) return saveChapterData(req, res, m[1]);
  if (p === '/api/mock-submissions') return handleMockSubmissions(req, res);
  if (p === '/api/roster') return handleRoster(req, res, query);
  if (p === '/api/roster-resetpw') return handleRosterResetPw(req, res);
  if (p === '/api/roster-remove') return handleRosterRemove(req, res);
  if (p === '/api/login') return handleLogin(req, res);
  if (p === '/api/change-password') return handleChangePassword(req, res);
  if (p === '/api/labscore') return handleLabScore(req, res);
  if (p === '/api/deptconfig') return handleDeptConfig(req, res);
  if (p === '/api/deptchapters') return handleDeptChapters(req, res);
  if (p === '/api/newchapter') return handleNewChapter(req, res);
  if (p === '/api/board') return handleBoard(req, res);
  if (p === '/api/board-reply') return handleBoardReply(req, res);
  if (p === '/api/board-delete') return handleBoardDelete(req, res);
  if (p === '/api/redo-requests') return handleRedoRequests(req, res, query);
  if (p === '/api/redo-requests-clear') return handleRedoRequestsClear(req, res);
  if (p === '/api/journal-answers') return handleJournalAnswers(req, res, query);
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end('method not allowed'); }
  serveStatic(req, res);
}).listen(PORT, () => console.log('serving', ROOT, 'on http://localhost:' + PORT));
