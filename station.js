// 역무실(설계서 0-1절): 출발 · 연구 노트 · 유물 뽑기 · 도감 · 순위 · 내 기록
import { RELICS } from './subway/sim/data/relics.js';
import { JOBS } from './subway/sim/data/jobs.js';
import { GEAR, SLOT_NAME } from './subway/sim/data/gear.js';
import { STATUS } from './subway/sim/data/status.js';

const $ = id => document.getElementById(id);
const esc = t => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let ST = null, GAME = null, CFG = {};

// 2회 수행평가 연구 노트 6영역(2026-11-05): 기본 8 + 영역 1~5 객관식·서술형 각 1점 + 영역 6 보고서 2점 = 20점
// obj: 객관식 점수, essay: 서술형 점수(영역 6은 Q-사이클 보고서 2점). 서버 lab_t2_auto와 같게 고친다
const CHAPTERS = [
  { num: 16, slug: '태양에너지의생성과전환', t: '태양 에너지와 에너지 전환', dept: 'd4', term: 2, obj: 1, essay: 1 },
  { num: 15, slug: '지구환경의변화', t: '지구 열수지, 온실 효과와 지구 온난화', dept: 'd3', term: 2, obj: 1, essay: 1 },
  { num: 23, slug: '사막화와엘니뇨', t: '사막화와 엘니뇨', dept: 'd3', term: 2, obj: 1, essay: 1 },
  { num: 17, slug: '전기에너지생산과효율', t: '발전의 원리와 신재생 에너지', dept: 'd4', term: 2, obj: 1, essay: 1 },
  { num: 20, slug: '물질변화와에너지의출입', t: '열 출입', dept: 'd2', term: 2, obj: 1, essay: 1 },
  { num: 24, slug: '통합과학총정리', t: '통합과학 총정리 (신장 Q-사이클 보고서)', dept: 'd4', term: 2, obj: 0, essay: 2 },
];
const TERM_BASE = 8, TERM_EXTRA_MAX = 12;
const key = (c, mode) => `ch${c.num}_seed_v1__${mode}`;
function chapterOpen(c) {
  const d = CFG[c.dept], ch = CFG[`ch${c.num}_seed_v1`];
  const deptOpen = d && typeof d.open === 'boolean' ? d.open : c.dept === 'd2';
  return deptOpen && !(ch && ch.locked);
}
function term2Score() {
  const passed = GAME?.everPassed || {};
  let got = 0, total = 0;
  for (const c of CHAPTERS) { total += c.obj + c.essay; if (c.obj && passed[key(c, 'obj')]) got += c.obj; if (passed[key(c, 'essay')]) got += c.essay; }
  return { got, total, extra: got, score: TERM_BASE + got };
}

async function load() {
  const [st, gs, cfg] = await Promise.all([
    labRpc('subway_state_get').catch(() => null),
    supaSelect('lab_game_state', 'name=eq.' + encodeURIComponent(CURRENT_STUDENT.name)).catch(() => null),
    supaSelect('lab_deptconfig', 'id=eq.1').catch(() => null),
  ]);
  if (st && st.ok === false && /세션/.test(st.error || '')) { clearSessionAndReload('로그인이 풀렸어요. 다시 로그인해 주세요.'); return; }
  ST = st?.ok ? st : ST; GAME = gs?.[0]?.data || GAME; CFG = cfg?.[0]?.data || CFG;
  render();
}
function hasLocalRun() {
  try { return !!localStorage.getItem('subwayEscape.v1__' + CURRENT_STUDENT.name); } catch { return false; }
}
function render() {
  $('who').textContent = '👤 ' + CURRENT_STUDENT.name;
  $('coinPill').textContent = '🪙 ' + (ST ? ST.coins : '-');
  const eq = (ST?.equipped || []).map(r => RELICS[r]?.name).filter(Boolean);
  const best = ST?.best ? `최고 기록 ${ST.best.lines}/9 노선(${JOBS[ST.best.job]?.name})` : '아직 기록 없음';
  $('heroInfo').textContent = `장착 유물: ${eq.join(', ') || '없음'} · ${best}`;
  $('goBtn').textContent = hasLocalRun() ? '이어 하기' : '출발';
}

/* ---------- 시트 ---------- */
function sheet(html) { $('sheetCard').innerHTML = html + '<div class="row" style="margin-top:14px"><button class="btn ghost" data-close>닫기</button></div>'; $('sheet').classList.add('on'); $('sheetCard').querySelectorAll('[data-close]').forEach(b => b.onclick = closeSheet); }
function closeSheet() { $('sheet').classList.remove('on'); render(); }
$('sheet').addEventListener('click', e => { if (e.target.id === 'sheet') closeSheet(); });

function notes() {
  const passed = GAME?.everPassed || {}, sc = term2Score();
  const row = c => {
    const open = chapterOpen(c), file = `챕터${c.num}_${c.slug}.html`;
    const btn = (mode, label) => { const ok = !!passed[key(c, mode)];
      return `<button class="btn ${ok ? 'ghost' : ''}" ${open ? '' : 'disabled'} data-go="${file}?mode=${mode}">${label} ${ok ? '✓' : ''}</button>`; };
    return `<div class="it"><div><div class="nm">영역 ${CHAPTERS.indexOf(c) + 1}. ${esc(c.t)}</div></div>
      <div class="row">${open ? '' : '<span class="tag lock">아직 잠김</span>'}${c.obj ? btn('obj', '객관식(1점)') : ''}${btn('essay', c.essay === 2 ? '보고서(2점)' : '서술형(1점)')}</div></div>`;
  };
  sheet(`<h2>📓 연구 노트</h2><p>영역 1~5는 객관식과 서술형이 1점씩, 영역 6은 신장 Q-사이클 보고서(질문→확장→탐구→표현→성찰)가 2점이다. 객관식(통과 기준 이상이면 1점)과 서술형(모든 문항을 정해진 글자 수 이상 쓰면 1점)이 있다. 처음 맞힌 객관식 1문항마다 🪙10, 처음 완성한 서술형 1문항마다 🪙30을 받는다.</p><p>🪙 모은 코인으로 <b>막차</b> 첫 화면의 「🎰 유물 뽑기」에서 유물을 뽑을 수 있다. 막차를 하면서 역을 통과하고 클리어해도 코인을 받는다.</p>
    <p>지금 2회 수행평가: <b style="color:var(--acc)">${sc.score}점</b> / 20점 (기본 ${TERM_BASE} + 추가 ${sc.extra}, 받은 점수 ${sc.got}/${sc.total})</p>
    <div class="list">${CHAPTERS.map(row).join('')}</div>`);
  $('sheetCard').querySelectorAll('[data-go]').forEach(b => b.onclick = () => { try { sessionStorage.setItem('lastDeptId', 'notes'); } catch {} location.href = b.dataset.go; });
}

function gacha(result) {
  const owned = ST?.relics || [], eq = ST?.equipped || [];
  const res = result ? `<div class="big">${result.dup ? '♻️' : '✨'}</div><p style="text-align:center;font-size:16px;color:var(--ink)"><b class="g${result.grade}">${'★'.repeat(result.grade)} ${RELICS[result.relic].name}</b>${result.dup ? ' (이미 있어서 🪙40을 돌려받았다)' : ' 획득!'}<br><small>${RELICS[result.relic].effect}</small></p>` : '';
  sheet(`<h2>🎰 유물 뽑기</h2><p>한 번에 🪙100. ★ 60% · ★★ 30% · ★★★ 10%, 10번째까지 ★★★이 안 나오면 ★★★ 확정(지금 ${ST?.pity ?? 0}/9). 가진 유물이 또 나오면 🪙40을 돌려준다.</p>
    <p>🪙 지금 코인 <b style="color:var(--acc)">${ST?.coins ?? 0}</b> (평가 ${ST?.evalCoins ?? 0} + 게임 ${ST?.gameCoins ?? 0} − 사용 ${ST?.spent ?? 0}) · 오늘 게임 코인 ${ST?.gameToday ?? 0}/200</p>
    ${res}<div class="row"><button class="btn" id="pull" ${(ST?.coins ?? 0) < 100 ? 'disabled' : ''}>🪙100으로 뽑기</button></div>
    <h3>가진 유물 (눌러서 장착, 3개까지)</h3>
    <div class="grid">${Object.entries(RELICS).map(([id, r]) => { const has = owned.includes(id), on = eq.includes(id);
      return `<button class="relic ${on ? 'on' : ''} ${has ? '' : 'off'}" data-r="${id}" ${has ? '' : 'disabled'}><b class="g${r.grade}">${'★'.repeat(r.grade)} ${r.name}${on ? ' · 장착' : ''}</b><small>${has ? r.effect : '아직 없음'}</small></button>`; }).join('')}</div>`);
  $('pull').onclick = async () => { $('pull').disabled = true; const out = await labRpc('subway_gacha').catch(() => null);
    if (out?.ok) { ST = out; gacha(out); } else { alert(out?.error || '뽑기에 실패했어요.'); gacha(); } };
  $('sheetCard').querySelectorAll('[data-r]').forEach(b => b.onclick = async () => {
    const id = b.dataset.r; let next = eq.includes(id) ? eq.filter(x => x !== id) : [...eq, id];
    if (next.length > 3) { alert('유물은 3개까지 장착할 수 있어요. 하나를 먼저 빼 주세요.'); return; }
    const out = await labRpc('subway_equip', { p_relics: next }).catch(() => null);
    if (out?.ok) { ST = out; gacha(); } else alert(out?.error || '장착에 실패했어요.');
  });
}

function gearFn(id) {
  const G = GEAR[id], out = [];
  for (const [s, v] of Object.entries(G.blocks)) out.push(s === 'melee' ? '근접 피해 −1' : `${STATUS[s].name} ${v === 0 ? '막음' : v <= 0.3 ? '크게 줄임' : '절반'}`);
  const SRC = { mosquito: '모기 감염', infmosq: '감염 모기', wasp: '말벌 독', viper: '뱀 독' };
  for (const s of Object.keys(G.sources || {})) if (SRC[s]) out.push(`${SRC[s]} 막음`);
  return [...new Set(out)].join(', ');
}
function codex() {
  const cx = ST?.codex || { gear: [], status: [] };
  sheet(`<h2>📖 도감</h2><p>게임에서 장비가 상태 이상을 실제로 막아 내면 그 장비의 기능이 여기에 적힌다. 판이 끝나도 남는다.</p>
    <h3>장비 (${cx.gear.length}/13)</h3><div class="grid">${Object.entries(GEAR).map(([id, g]) => `<div class="relic ${cx.gear.includes(id) ? '' : 'off'}"><b>${g.name} · ${SLOT_NAME[g.slot]}</b><small>${cx.gear.includes(id) ? gearFn(id) : '아직 모름'}</small></div>`).join('')}</div>
    <h3>상태 이상 (${cx.status.length}/12)</h3><div class="grid">${Object.entries(STATUS).filter(([id]) => id !== 'stolen').map(([id, s]) => `<div class="relic ${cx.status.includes(id) ? '' : 'off'}"><b>${s.icon} ${s.name}</b><small>${cx.status.includes(id) ? `${s.effect}<br>${s.reason}` : '아직 걸려 본 적 없음'}</small></div>`).join('')}</div>`);
}

// ---------- 막차 순위 (2026-10-30): 전체 1~5등(직업 상관없음) · 직업 이름을 누르면 그 직업 1~5등. 2026-11-05: 첫 화면에서 빼고 순위 단추에서만, 가산점 없음 ----------
const MK_JOBS = { driver: '지하철 기관사', geo: '지질학자', eco: '생태학자', chem: '화학 연구원', weather: '기상 연구원', medic: '응급 구조사' };
const mkTime = s => { s = +s || 0; const m = Math.floor(s / 60); return m + '분 ' + String(Math.floor(s - m * 60)).padStart(2, '0') + '초'; };
let MK = null, mkTab = '';
async function makchaBoard(force, el) {
  const box = el || $('mkRank'); if (!box) return;
  if (!MK || force) { box.innerHTML = '<div class="mkhead"><b>🚇 막차 순위</b></div><p class="mknote">불러오는 중…</p>'; MK = await labRpc('makcha_rank').catch(() => null); }
  if (!MK?.ok) { box.innerHTML = '<div class="mkhead"><b>🚇 막차 순위</b></div><p class="mknote">' + esc(MK?.error || '순위를 아직 불러올 수 없어요.') + '</p>'; return; }
  const me = CURRENT_STUDENT.name, rows = mkTab ? (MK.byJob[mkTab] || []) : MK.overall, mine = mkTab ? MK.meByJob?.[mkTab] : MK.me;
  const tabs = ['', ...Object.keys(MK_JOBS)].map(j => '<button class="mktab' + (j === mkTab ? ' on' : '') + '" data-mk="' + j + '">' + (j ? MK_JOBS[j] : '전체') + '</button>').join('');
  const tbl = rows.length ? '<table><tr><th>순위</th><th>이름</th>' + (mkTab ? '' : '<th>직업</th>') + '<th>통과한 역</th><th>걸린 시간</th></tr>' + rows.map(r => '<tr class="' + (r.name === me ? 'me' : '') + '"><td>' + r.rank + '등</td><td>' + esc(r.name) + '</td>' + (mkTab ? '' : '<td>' + esc(MK_JOBS[r.job] || r.job) + '</td>') + '<td>' + r.stages + ' / 24</td><td>' + mkTime(r.secs) + '</td></tr>').join('') + '</table>' : '<p class="mknote">아직 기록이 없어요. 첫 기록의 주인공이 되어 보세요!</p>';
  box.innerHTML = '<div class="mkhead"><b>🚇 막차 순위 · ' + (mkTab ? MK_JOBS[mkTab] + ' 1~5등' : '전체 1~5등') + '</b><button class="mktab" data-mkr="1">새로 고침</button></div>'
    + '<div class="mktabs">' + tabs + '</div>' + tbl
    + '<p class="mknote">' + (mine ? '내 순위: ' + mine.rank + '등 · ' + mine.stages + ' / 24역 · ' + mkTime(mine.secs) : (mkTab ? '이 직업으로 남긴 기록이 없어요.' : '아직 내 기록이 없어요.')) + '</p>'
    + '<p class="mknote">통과한 역이 많을수록, 같으면 걸린 시간이 짧을수록 위예요. 학생마다 가장 좋은 판 하나로 매겨요.</p>';
  box.querySelectorAll('[data-mk]').forEach(b => b.onclick = () => { mkTab = b.dataset.mk; makchaBoard(false, box); });
  box.querySelector('[data-mkr]').onclick = () => makchaBoard(true, box);
}
// ---------- 딸깍 독재자 순위 (2026-10-30): 진짜 지도자 종합 점수 1~5등 · 국가소득(GDP) 1~5등 ----------
let TK = null, tkTab = 'leader';
async function ttalkkakBoard(force, box) {
  if (!TK || force) { box.innerHTML = '<div class="mkhead"><b>🗳 딸깍 독재자 순위</b></div><p class="mknote">불러오는 중…</p>'; TK = await labRpc('tk_lab_rank').catch(() => null); }
  if (!TK?.ok) { box.innerHTML = '<div class="mkhead"><b>🗳 딸깍 독재자 순위</b></div><p class="mknote">' + esc(TK?.error || '순위를 아직 불러올 수 없어요.') + '</p>'; return; }
  const me = CURRENT_STUDENT.name, L = tkTab === 'leader', rows = L ? TK.leader : TK.gdp, mine = L ? TK.meLeader : TK.meGdp, won = n => Math.round(+n || 0).toLocaleString('ko-KR') + '조';
  const tabs = [['leader', '진짜 지도자 점수'], ['gdp', '국가소득(GDP)']].map(([k, t]) => '<button class="mktab' + (k === tkTab ? ' on' : '') + '" data-tk="' + k + '">' + t + '</button>').join('');
  const tbl = rows.length ? '<table><tr><th>순위</th><th>이름</th><th>나라</th>' + (L ? '<th>등급</th><th>점수</th>' : '<th>GDP</th>') + '</tr>' + rows.map(r => '<tr class="' + (r.name === me ? 'me' : '') + '"><td>' + r.rank + '등</td><td>' + esc(r.name) + '</td><td>' + esc(r.nation) + '</td>' + (L ? '<td>' + esc(r.grade || '') + '</td><td>' + r.score + '</td>' : '<td>' + won(r.gdp) + '</td>') + '</tr>').join('') + '</table>' : '<p class="mknote">아직 끝까지 마친 기록이 없어요.</p>';
  box.innerHTML = '<div class="mkhead"><b>🗳 딸깍 독재자 순위 · ' + (L ? '진짜 지도자 1~5등' : '국가소득 1~5등') + '</b><button class="mktab" data-tkr="1">새로 고침</button></div><div class="mktabs">' + tabs + '</div>' + tbl
    + '<p class="mknote">' + (mine ? '내 순위: ' + mine.rank + '등 · ' + (L ? (mine.grade || '') + ' ' + mine.score + '점' : won(mine.gdp)) : '아직 내 기록이 없어요.') + '</p>'
    + '<p class="mknote">' + (L ? '진짜 독재자를 끝까지 마친 판의 지도자 종합 점수(GDP·국민 삶·공정·환경·스스로 판단·통치 기간)로 매겨요. 같으면 GDP가 큰 쪽이 위예요.' : '끝까지 마친 판의 국가소득(GDP)으로 매겨요.') + ' 학생마다 가장 좋은 판 하나로 매겨요.</p>';
  box.querySelectorAll('[data-tk]').forEach(b => b.onclick = () => { tkTab = b.dataset.tk; ttalkkakBoard(false, box); });
  box.querySelector('[data-tkr]').onclick = () => ttalkkakBoard(true, box);
}
let rankGame = 'mk';
async function rank() { // 순위 단추: 막차·딸깍 독재자 순위를 따로 본다
  sheet('<h2>🏆 순위</h2><div class="mktabs" id="rkGames"><button class="mktab" data-g="mk">🚇 막차</button><button class="mktab" data-g="tk">🗳 딸깍 독재자</button></div><div class="mkboard" id="rkBody"></div>');
  const show = g => { rankGame = g; document.querySelectorAll('#rkGames [data-g]').forEach(b => b.classList.toggle('on', b.dataset.g === g)); const box = $('rkBody'); if (g === 'mk') makchaBoard(true, box); else ttalkkakBoard(true, box); };
  document.querySelectorAll('#rkGames [data-g]').forEach(b => b.onclick = () => show(b.dataset.g)); show(rankGame);
}
async function rankOld() {
  sheet('<h2>🏆 순위</h2><p>불러오는 중…</p>');
  const out = await labRpc('subway_rank').catch(() => null);
  if (!out?.ok) { sheet(`<h2>🏆 순위</h2><p>${esc(out?.error || '순위를 불러오지 못했어요.')}</p>`); return; }
  const me = CURRENT_STUDENT.name, keep = r => !RANK_EXCLUDE_ACCOUNTS.includes(r.name) || r.name === me;
  const mins = t => Math.round(t / 30 / 60);
  const tbl = (rows, job) => rows.filter(keep).length ? `<table><tr><th>순위</th><th>이름</th>${job ? '<th>직업</th>' : ''}<th>노선</th><th>걸린 시간</th></tr>${rows.filter(keep).map((r, i) => `<tr class="${r.name === me ? 'me' : ''}"><td>${i + 1}</td><td>${esc(r.name)}</td>${job ? `<td>${JOBS[r.job]?.name || ''}</td>` : ''}<td>${r.lines}/9</td><td>${mins(r.ticks)}분</td></tr>`).join('')}</table>` : '<p>아직 기록이 없다.</p>';
  sheet(`<h2>🏆 순위</h2><p>통과한 노선 수가 많을수록, 같으면 걸린 시간이 짧을수록 위다. 학년 전체 순위이며, 직업별 1등과 통합 5등 안은 가산점 대상이다(점수는 선생님이 정함).</p>
    <h3>통합</h3>${tbl(out.overall, true)}
    ${Object.entries(out.byJob).map(([j, rows]) => `<h3>${JOBS[j].name}</h3>${tbl(rows, false)}`).join('')}`);
}

// 내 점수(2026-11-05): 1회차는 교사가 확정한 점수, 2회차는 연구 노트 통과 수로 자동 계산 + 교사 조정
const T1_LABELS = ['지질 시대 객관식', '지질 시대 서술형', '진화와 다양성 객관식', '진화와 다양성 서술형', '산화와 환원 객관식', '산화와 환원 서술형',
  '산·염기·중화 객관식', '산·염기·중화 서술형', '생태계 객관식', '생태계 서술형', '기출 문제(18개 이상)', '연금술사 코드'];
async function record() { // 총점만 크게 보이고, 「세부 점수」를 눌러야 내역이 열린다(2026-11-05)
  sheet('<h2>📋 내 점수</h2><p>불러오는 중…</p>');
  const out = await labRpc('lab_term_my').catch(() => null);
  if (!out?.ok) { sheet('<h2>📋 내 점수</h2><p>' + esc(out?.error || '점수를 불러오지 못했어요.') + '</p>'); return; }
  const t1 = out.t1, t2 = out.t2, it = t1?.items?.items || [], ded = t1?.items?.deduct || {}, passed = GAME?.everPassed || {}; // ded: 과제별 감점 사유
  const box = (title, total, detail) => `<div class="it" style="display:block;padding:12px 14px"><div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px">
      <b style="font-size:16px">${title}</b><span class="score" style="font-size:30px">${total}</span></div>
      ${detail ? `<details style="margin-top:6px"><summary style="cursor:pointer;font-weight:700">세부 점수</summary><div style="margin-top:8px">${detail}</div></details>` : ''}</div>`;
  const row = (l, v) => `<div class="it"><span class="nm">${l}</span><span class="ds">${v}</span></div>`;
  const t1detail = t1 ? `<p>기본점수 ${t1.items?.base ?? 8}점 + 해결점수 ${it.reduce((a, v) => a + v, 0)}점${+t1.bonus ? ` · 연구점수 랭킹 보너스 +${+t1.bonus}` : ''}</p>
    <div class="list">${T1_LABELS.map((l, k) => ded[k] ? `<div class="it" style="display:block"><div style="display:flex;justify-content:space-between"><span class="nm">${l}</span><span class="ds" style="color:var(--bad)">✗ 감점</span></div><div style="font-size:12.5px;color:var(--bad);margin-top:4px">사유: ${esc(ded[k])}</div></div>` : row(l, it[k] ? '✓ 1점' : '—')).join('')}</div>` : '';
  const t2detail = `<p>기본점수 ${TERM_BASE}점 + 연구 노트 ${t2.auto - TERM_BASE}점${+t2.adjust ? ` + 선생님 조정 ${+t2.adjust > 0 ? '+' : ''}${+t2.adjust}점` : ''}</p>
    <div class="list">${CHAPTERS.map((c, k) => row('영역 ' + (k + 1) + '. ' + esc(c.t), (c.obj ? `객관식 ${passed[key(c, 'obj')] ? '✓' : '—'} · ` : '') + `${c.essay === 2 ? '보고서' : '서술형'} ${passed[key(c, 'essay')] ? '✓ ' + c.essay + '점' : '—'}`)).join('')}</div>`;
  sheet(`<h2>📋 내 점수</h2><div class="list">
    ${Object.keys(ded).length ? `<p style="color:var(--bad);font-weight:700">⚠ 1회차에 감점된 과제가 ${Object.keys(ded).length}개 있어요. 「세부 점수」를 누르면 사유를 볼 수 있어요.</p>` : ''}${box('1회 수행평가', t1 ? `${+t1.total}<small style="font-size:14px;color:var(--sub)"> / 20점</small>` : '<small style="font-size:14px;color:var(--sub)">아직 없음</small>', t1detail)}
    ${box('2회 수행평가 (지금까지)', `${t2.total}<small style="font-size:14px;color:var(--sub)"> / 20점</small>`, t2detail)}</div>
    ${out.note ? '<p>선생님 메모: ' + esc(out.note) + '</p>' : ''}
    <p style="font-size:12px;color:var(--sub)">최종 점수는 선생님이 확정해요.</p>`);
}

const OPEN = { notes, gacha: () => gacha(), codex, rank, record };
document.querySelectorAll('[data-open]').forEach(b => b.onclick = () => OPEN[b.dataset.open]());
// 첫 화면: 승강장에 선 전동차. 「출발」을 누르면 전동차가 옆으로 달려 나가고 게임이 시작된다
const cv = $('stationCv'), cx = cv.getContext('2d'); cx.imageSmoothingEnabled = false;
const IMG = {}; let trainX = null, trainV = 0, leaving = false, t0 = performance.now(), lastT = null;
const loadImg = n => new Promise(r => { const i = new Image(); i.onload = () => r(IMG[n] = i); i.onerror = () => r(null); i.src = `subway/assets/subway/${n}.png`; });
Promise.all(['platform', 'platform_front', 'train'].map(loadImg)).then(() => requestAnimationFrame(drawStation));
function drawStation(now) {
  const t = (now - t0) / 1000, dt = Math.min(0.05, lastT === null ? 0 : (now - lastT) / 1000), P = IMG.platform, F = IMG.platform_front, T = IMG.train; lastT = now;
  if (!P || !T) return;
  if (trainX === null) trainX = (640 - T.width) / 2;
  if (leaving) { trainV += 420 * dt; trainX += trainV * dt; }   // 점점 빨라지며 오른쪽으로
  const shake = leaving ? Math.round((Math.random() - .5) * Math.min(3, trainV / 120)) : 0;
  cx.drawImage(P, 0, 0);
  const ty = 258 - T.height + (leaving ? 0 : Math.round(Math.sin(t * 2) * 0.5));
  cx.drawImage(T, Math.round(trainX), ty + shake);
  if (leaving) { cx.fillStyle = 'rgba(255,255,255,.35)'; for (let i = 0; i < 14; i++) cx.fillRect((i * 97 + t * 900) % 640, 140 + (i * 37) % 120, 30 + trainV / 20, 1); }
  if (F) cx.drawImage(F, 0, 0);
  cx.fillStyle = `rgba(255,236,170,${0.06 + 0.04 * Math.sin(t * 7)})`; cx.fillRect(0, 0, 640, 40);   // 깜박이는 천장 불빛
  if (leaving && trainX > 660) { cx.fillStyle = '#000'; cx.fillRect(0, 0, 640, 360); location.href = 'subway/index.html'; return; }
  requestAnimationFrame(drawStation);
}
function depart() { if (leaving) return; leaving = true; trainV = 20; $('goBtn').disabled = true; $('goBtn').textContent = '출발합니다…';
  if (!IMG.train) location.href = 'subway/index.html';
  setTimeout(() => { location.href = 'subway/index.html'; }, 2500); }   // 그림이 멈춰 있어도 2.5초 뒤에는 출발
$('goBtn').onclick = depart; cv.onclick = depart;
$('logoutBtn').onclick = logout;

window.LAB_ON_LOGIN = async () => {
  $('loginScreen').classList.add('hide'); $('labApp').classList.remove('hide');
  render(); await load();
  let last = null; try { last = sessionStorage.getItem('lastDeptId'); sessionStorage.removeItem('lastDeptId'); } catch {}
  if (last) notes();   // 단원 평가에서 돌아왔으면 연구 노트을 다시 연다
};
window.addEventListener('focus', () => { if (CURRENT_STUDENT) load(); });
$('hoursNote').textContent = isWithinServiceHours() ? '이용 시간: 평일 오전 8시 30분 ~ 월·화·금 오후 4시, 수·목 오후 5시' : '🕐 지금은 이용 시간이 아니에요. 평일 오전 8시 30분부터 ' + serviceCloseLabel() + '까지 열려요.';
wireLoginForm();
tryAutoLogin();
