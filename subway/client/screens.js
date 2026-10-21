// 화면 흐름: 제목 → 직업 고르기 → 노선 고르기 → 칸 진행(짐칸) → 개찰구 보스 → 환승 통로(연구 노트·정비소) → … → 탈출/쓰러짐
import { game, startCar, goFullscreen } from './main.js';
import { drawPlayer } from './render.js';
import { setHud, updateHud, showTip, pushEvents } from './hud.js';
import { saveCheckpoint, loadCheckpoint, clearCheckpoint, mergeCodex, loadCodex, resumePlan } from './save.js';
import { createRun, generateLine, offerLines, enterCar, finishCar, finishLine, openCargo, takeCargo, researchNote, pickNote, applyUpgrade, gearCost, craftGear, craftItem, upgradeWeapon, UPGRADE_COST, upgradeMod, craftWeapon, WEAPON_RECIPES } from '../sim/run.js';
import { MODS, MOD_COST } from '../sim/data/mods.js';
import { JOBS, JOB_ORDER, TRAIT_TEXT, SKILL_TEXT } from '../sim/data/jobs.js';
import { WEAPONS } from '../sim/data/weapons.js';
import { LINES } from '../sim/data/lines.js';
import { STATUS } from '../sim/data/status.js';
import { GEAR, MATERIALS, SLOT_NAME } from '../sim/data/gear.js';
import { CONSUMABLES, ITEM_RECIPES } from '../sim/data/consumables.js';
import { RELICS } from '../sim/data/relics.js';
import { TICK_HZ } from '../sim/constants.js';
import { lab, connectLab, equippedRelics, serverCodex, finishRunOnServer, refreshState } from './lab.js';

const card = () => document.getElementById('screenCard'), screen = document.getElementById('screen');
let run = null, lineData = null, notes = null;
// 시험판 주소 뒤 ?test=boss(보스방 확인) / ?test=reward(스테이지 보상 확인). 연구소(로그인)에서는 꺼진다
const testMode = () => lab.online ? null : new URLSearchParams(location.search).get('test');
const TEST_NAME = { boss: '보스방 확인', reward: '스테이지 보상 확인' };
const LAYOUT_NAME = { seats: '객실', poles: '손잡이 기둥 칸', barricade: '짐 바리케이드 칸', debris: '천장이 무너진 칸' };

// 받침이 있으면 앞, 없으면 뒤 조사
export const josa = (w, a, b) => { const c = w.charCodeAt(w.length - 1); return w + ((c - 0xac00) % 28 > 0 && c >= 0xac00 && c <= 0xd7a3 ? a : b); };
const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function show(html) { card().innerHTML = html; screen.classList.add('on'); setHud(false); card().scrollTop = 0; }
function hide() { screen.classList.remove('on'); setHud(true); }
const on = (sel, fn) => card().querySelectorAll(sel).forEach(el => el.addEventListener('click', () => fn(el)));
const matText = r => Object.entries(r).map(([k, v]) => `${MATERIALS[k]} ${v}`).join(' + ');
const haveText = () => { const m = Object.entries(run.materials).filter(([, v]) => v > 0); return m.length ? m.map(([k, v]) => `${MATERIALS[k]} ${v}`).join(', ') : '없음'; };

function gearFunction(id) {
  const G = GEAR[id], out = [];
  for (const [s, v] of Object.entries(G.blocks)) out.push(s === 'melee' ? '근접 피해 −1' : `${STATUS[s].name} ${v === 0 ? '막음' : v <= 0.3 ? '크게 줄임' : '절반'}`);
  const SRC = { mosquito: '모기 감염', infmosq: '감염 모기', wasp: '말벌 독', viper: '뱀 독' };
  for (const s of Object.keys(G.sources || {})) if (SRC[s]) out.push(`${SRC[s]} 막음`);
  return [...new Set(out)].join(', ');
}

// ---------- 제목 ----------
export async function startApp() {
  window.__game = game;
  await connectLab();
  if (lab.online && serverCodex()) mergeCodex(serverCodex());
  try { notes = await fetch(new URL('../data/notes.sample.json', import.meta.url)).then(r => r.json()); } catch { notes = window.__NOTES__ || { questions: [] }; }
  game.onCarEnd = onCarEnd;
  game.onTick = s => pushEvents(s.events);
  game.onFrame = (s, dt) => { if (s && !screen.classList.contains('on')) updateHud(s, run, dt); };
  addEventListener('keydown', e => { if (e.code === 'Escape' && game.state && !game.paused) pause(); });
  title();
}
function title() {
  game.paused = true; game.state = null;
  const c = loadCheckpoint();
  show(`<h1>🚇 지하철 노선 탈출</h1><p>기후 위기로 무너진 도시. 1~9호선을 환승하며 빠져나가자. 몬스터와 재난이 일으키는 상태 이상은 <b>과학으로 대비</b>해야 막을 수 있다.</p>
    <p>이동 WASD·방향키 · 공격 마우스 왼쪽(가까운 적 자동 조준, 상자에 붙으면 총으로 후려침) · 스킬 마우스 오른쪽 · 달리기 왼쪽 Shift(달리는 동안은 방어막이 차지 않음) · 무기 바꾸기 Q · 소모품 E · 멈춤 Esc · 화면 버튼으로도 할 수 있다</p>
    ${TEST_NAME[testMode()] ? `<p style="color:var(--acc)">🧪 시험 모드: ${TEST_NAME[testMode()]}</p>` : ''}
    ${lab.online ? `<p>👤 ${esc(lab.student.name)} · 🪙 코인 ${lab.state?.coins ?? 0} · 장착 유물: ${equippedRelics().map(r => RELICS[r]?.name).filter(Boolean).join(', ') || '없음 (역무실 「유물 뽑기」에서 장착)'}</p>` : ''}
    <div class="row">${c ? `<button class="btn" id="cont">이어 하기 (${c.phase === 'choose' ? `노선 ${c.run.lineIndex + 1}/9 고르기` : `${LINES[c.lineData.line].name} ${c.phase === 'transfer' ? '환승 통로' : c.carIndex >= c.lineData.cars.length ? '개찰구' : (c.carIndex + 1) + '칸'}`})</button>` : ''}<button class="btn ${c ? 'ghost' : ''}" id="new">새로 시작</button><button class="btn ghost" id="codex">도감</button>${lab.online ? '<button class="btn ghost" id="home">🏢 역무실로</button>' : ''}</div>`);
  on('#home', () => { location.href = '../shinjang_science.html'; });
  on('#new', () => { clearCheckpoint(); jobSelect(); });
  on('#cont', () => { goFullscreen(); resume(c); });
  on('#codex', codexScreen);
}
function resume(c) {
  run = c.run; lineData = c.lineData;
  const r = resumePlan(c);
  if (r.kind === 'transfer') transfer(r.step, r.extra); else if (r.kind === 'choose') lineChoice(); else if (r.kind === 'cargo') cargo(r.carIndex); else playCar(r.carIndex);
}

function codexScreen() {
  const cx = loadCodex();
  show(`<h2>📖 도감</h2><p>막아 낸 장비의 기능과 걸려 본 상태 이상이 판이 끝나도 남는다.</p>
    <h2>장비</h2><div class="grid">${Object.entries(GEAR).map(([id, g]) => `<div class="opt ${cx.gear.includes(id) ? '' : 'dis'}"><b>${g.name} · ${SLOT_NAME[g.slot]}</b><small>${cx.gear.includes(id) ? gearFunction(id) : '아직 모름'}</small></div>`).join('')}</div>
    <h2 style="margin-top:14px">상태 이상</h2><div class="grid">${Object.entries(STATUS).filter(([id]) => id !== 'stolen').map(([id, st]) => `<div class="opt ${cx.status.includes(id) ? '' : 'dis'}"><b>${st.icon} ${st.name}</b><small>${cx.status.includes(id) ? `${st.effect}<br>${st.reason}` : '아직 걸려 본 적 없음'}</small></div>`).join('')}</div>
    <div class="row"><button class="btn" id="back">돌아가기</button></div>`);
  on('#back', title);
}

// ---------- 직업 고르기 ----------
function preview(canvas, jobId, weapon, t) {
  const x = canvas.getContext('2d'); x.imageSmoothingEnabled = false; x.clearRect(0, 0, canvas.width, canvas.height);
  const p = { jobId, aim: 0, face: 1, moving: true, swing: 0, recoil: 0, invuln: 0, weapons: [{ id: weapon, star: 1 }], weapon: 0 };
  drawPlayer(x, p, game.assets, t, 40, 72);
}
function jobSelect() {
  const relics = equippedRelics();
  show(`<h2>직업 고르기</h2><p>직업마다 체력·방어막·에너지와 스킬, 특성이 다르다. 장착 유물: ${relics.map(r => `${'★'.repeat(RELICS[r].grade)} ${RELICS[r].name}(${RELICS[r].effect})`).join(', ') || (lab.online ? '없음 (역무실에서 뽑고 장착)' : '없음')}</p>
    <div class="grid">${JOB_ORDER.map(id => { const j = JOBS[id]; return `<button class="opt" data-job="${id}"><canvas class="pv" width="80" height="100" data-pv="${id}"></canvas>
      <b>${j.name}</b><small>체력 ${j.hp} · 방어막 ${j.shield} · 에너지 ${j.energy}<br>시작 무기: ${WEAPONS[j.startWeapon].name} + 새총<br>스킬 ${j.skill.name}(${j.skill.cooldown}초): ${SKILL_TEXT[j.skill.id]}<br>특성: ${j.traits.map(t => TRAIT_TEXT[t]).join(', ')}<br>관련 단원: ${j.unit}</small></button>`; }).join('')}</div>
    <div class="row"><button class="btn ghost" id="back">돌아가기</button></div>`);
  const cvs = [...card().querySelectorAll('[data-pv]')];
  const anim = t => { if (!cvs[0]?.isConnected) return; cvs.forEach(c => preview(c, c.dataset.pv, JOBS[c.dataset.pv].startWeapon, t / 1000)); requestAnimationFrame(anim); };
  requestAnimationFrame(anim);
  on('[data-job]', el => { run = createRun({ seed: (Date.now() ^ Math.floor(Math.random() * 2 ** 31)) >>> 0, jobId: el.dataset.job, relicIds: equippedRelics() }); lineChoice(); });
  on('#back', title);
}

// ---------- 노선 고르기 (환승 통로 마지막 단계) ----------
function lineChoice() {
  const opts = offerLines(run), detail = JOBS[run.jobId].traits.includes('lineInfoDetail') || run.relics.includes('buoy');
  saveCheckpoint(run, lineData || generateLine(run, opts[0]), 0, 'choose');
  show(`<h2>${run.lineIndex === 0 ? '첫 노선 고르기' : '다음 노선 고르기'}</h2><p>표지판의 위험 표시를 보고 대비하자. 지난 노선: ${run.visited.map(n => LINES[n].name).join(', ') || '없음'}</p>
    <div class="grid">${opts.map(n => { const L = LINES[n]; return `<button class="opt" data-line="${n}"><div class="sign">🚇 <b style="font-size:20px;margin:0">${L.name}</b></div>
      <small>${L.theme} · ${L.hazardName}<br>위험 표시: ${L.hazardIcons.map(s => STATUS[s].icon).join(' ')}${detail ? `<br>${L.hazardIcons.map(s => STATUS[s].name).join(', ')}` : ''}</small></button>`; }).join('')}</div>`);
  on('[data-line]', el => startLine(+el.dataset.line));
}
function startLine(n) {
  goFullscreen();
  run.line = n; lineData = generateLine(run, n);
  if (testMode() === 'boss') { run.parts += 30; return playCar(lineData.cars.length); }
  if (testMode() === 'reward') {   // 짧은 칸 하나 → 짐칸 → 환승 통로(연구 노트·강화·정비소). 재료와 부품을 넉넉히 준다
    run.parts += 60; for (const k of Object.keys(MATERIALS)) if (k !== 'waterBottle') run.materials[k] = (run.materials[k] || 0) + 6;
    const c0 = lineData.cars[0], g = c0.waves.flat()[0]; c0.type = 'cabin'; c0.waves = [[{ monster: g.monster, count: 1 }]];
    lineData.cars[1] = { index: 1, type: 'cargo', waves: [], seed: c0.seed + 1 };
  }
  const L = LINES[n];
  showTip(`🚇 ${L.name} · ${L.theme}<br><small>${L.hazardName}: 숨겨진 칸 장치를 고치면 재난이 사라진다(준비 중)</small>`, 4);
  playCar(0);
}

// ---------- 칸 진행 ----------
function playCar(i) {
  run.carIndex = i;
  const car = lineData.cars[i];
  if (car && car.type === 'cargo') { saveCheckpoint(run, lineData, i, 'cargo'); return cargo(i); }
  saveCheckpoint(run, lineData, i, 'car');
  if (i >= lineData.cars.length) showTip(`🎫 승강장으로 나와 개찰구에 도착했다. ${lineData.boss.name}!`, 4);
  hide(); const st = enterCar(run, lineData, i); startCar(st);
  if (i < lineData.cars.length && i > 0) showTip(`🚃 ${i + 1}칸 · ${LAYOUT_NAME[st.layout] || '객실'}${st.carType === 'hazard' ? ' · ⚠️ 위험 칸' : ''}`, 2);
}
function cargo(i) {
  const loot = openCargo(run, lineData, i);
  show(`<h2>📦 짐칸: 보급 상자</h2><p>무기 2개 중 1개를 고른다(이미 가진 무기면 ★이 오른다). 재료도 챙겼다: ${matText(loot.materials)}</p>
    <div class="grid">${loot.weapons.map(id => { const w = WEAPONS[id], own = run.weapons.find(x => x.id === id); return `<button class="opt" data-w="${id}"><b>${w.name}${own ? ` ★${own.star} → ★${Math.min(3, own.star + 1)}` : ''}</b><small>${{ gun: '쏘기', melee: '휘두르기', throw: '던지기', beam: '줄기 뿜기' }[w.type]} · 피해 ${w.dmg[0]} · 에너지 ${w.energy ?? w.energyPerSec + '/초'}</small></button>`; }).join('')}</div>
    <p>무기는 2개까지 들 수 있다. 꽉 찼으면 지금 든 무기(${WEAPONS[run.weapons[run.weapon].id].name})와 바뀐다.</p><div class="row"><button class="btn ghost" id="skip">무기는 두고 가기</button></div>`);
  const after = () => testMode() === 'reward' ? transfer('note') : playCar(i + 1);
  on('[data-w]', el => { takeCargo(run, loot, el.dataset.w); after(); });
  on('#skip', () => { takeCargo(run, loot, null); after(); });
}
function onCarEnd(s) {
  const wasBoss = s.carType === 'boss';
  finishCar(run, s); mergeCodex(s.codex);
  if (run.dead) return gameOver();
  if (!wasBoss) return playCar(run.carIndex);
  finishLine(run);
  if (run.escaped) return victory();
  transfer('note');
}

// ---------- 환승 통로: 연구 노트 → 강화 → 정비소 → 다음 노선 ----------
function transfer(step, extra = {}) {
  game.paused = true;
  if (step !== 'upgrade') saveCheckpoint(run, lineData, 0, 'transfer', { step });
  if (step === 'note') return note();
  if (step === 'upgrade') return upgradePick(extra);
  if (step === 'shop') return shop();
  lineChoice();
}
function note() {
  const qs = notes?.questions || [];
  if (!qs.length) return transfer('shop');
  const qi = pickNote(run, qs), q = qs[qi], order = (run.seed + run.visited.length) % 2 ? [1, 0] : [0, 1];
  show(`<h2>📓 연구 노트 (환승 통로)</h2><p>${esc(q.unit)}${notes.status ? ` · <small>${esc(notes.status)}</small>` : ''}</p><p style="color:var(--ink);font-size:17px">${esc(q.q)}</p>
    <div class="grid">${order.map(k => `<button class="opt" data-a="${k}"><b>${esc(q.choices[k])}</b></button>`).join('')}</div>`);
  on('[data-a]', el => {
    const r = researchNote(run, q, +el.dataset.a);
    const head = r.correct ? '⭕ 맞았다!' : r.forgiven ? '❌ 틀렸지만 낡은 연구 노트 덕분에 강화를 고른다' : '❌ 아쉽다. 부품 3개를 얻었다';
    const extra = { step: 'upgrade', head, why: q.why, upgrades: r.upgrades };
    saveCheckpoint(run, lineData, 0, 'transfer', extra);   // 답한 결과를 바로 저장: 새로고침해도 다시 풀 수 없다
    upgradePick(extra);
  });
}
function upgradePick(x) {
  show(`<h2>${esc(x.head || '연구 노트')}</h2><p>${esc(x.why || '')}</p>${x.upgrades?.length ? `<h2>강화 1개 고르기</h2><div class="grid">${x.upgrades.map((u, i) => `<button class="opt" data-u="${i}"><b>${u.text}</b></button>`).join('')}</div>` : '<div class="row"><button class="btn" id="go">정비소로</button></div>'}`);
  on('[data-u]', b => { applyUpgrade(run, x.upgrades[+b.dataset.u]); transfer('shop'); });
  on('#go', () => transfer('shop'));
}
function shop(tab = 'gear') {
  const known = loadCodex().gear, info = id => run.showGearInfo ? gearFunction(id) : known.includes(id) ? `도감: ${gearFunction(id)}` : '무엇을 막아 줄까? 재료의 성질로 추리해 보자';
  const worn = Object.entries(run.gear).map(([sl, g]) => `${SLOT_NAME[sl]} ${g ? GEAR[g].name : '없음'}`).join(' · ');
  const tabs = `<div class="row"><button class="btn ${tab === 'gear' ? '' : 'ghost'}" data-t="gear">장비 만들기</button><button class="btn ${tab === 'item' ? '' : 'ghost'}" data-t="item">소모품 만들기</button><button class="btn ${tab === 'weapon' ? '' : 'ghost'}" data-t="weapon">★ 등급 올리기</button><button class="btn ${tab === 'mod' ? '' : 'ghost'}" data-t="mod">🔧 무기 강화</button><button class="btn ${tab === 'make' ? '' : 'ghost'}" data-t="make">🔫 무기 만들기</button></div>`;
  let body = '';
  if (tab === 'gear') body = `<div class="grid">${Object.entries(GEAR).map(([id, g]) => { const cost = gearCost(run, id), ok = Object.entries(cost).every(([k, v]) => (run.materials[k] || 0) >= v);
    return `<button class="opt ${ok ? '' : 'dis'}" data-g="${id}"><b>${g.name} · ${SLOT_NAME[g.slot]}${run.gear[g.slot] === id ? ' (착용 중)' : ''}</b><small>재료: ${matText(cost)}<br>${info(id)}</small></button>`; }).join('')}</div>`;
  if (tab === 'item') body = `<p>소모품 ${run.items.length}/${run.itemSlots}: ${run.items.map(i => CONSUMABLES[i].name).join(', ') || '없음'}</p><div class="grid">${Object.entries(ITEM_RECIPES).map(([id, r]) => { const ok = run.items.length < run.itemSlots && Object.entries(r).every(([k, v]) => (run.materials[k] || 0) >= v);
    return `<button class="opt ${ok ? '' : 'dis'}" data-i="${id}"><b>${CONSUMABLES[id].name}</b><small>재료: ${matText(r)}<br>고치는 것: ${CONSUMABLES[id].cures.map(c => STATUS[c].name).join(', ')}</small></button>`; }).join('')}</div>`;
  if (tab === 'make') body = `<p>무기는 2개까지 들 수 있다. 꽉 차 있으면 지금 든 무기(${WEAPONS[run.weapons[run.weapon].id].name})와 바뀐다. 부품 ${run.parts}개</p><div class="grid">${Object.entries(WEAPON_RECIPES).map(([id, r]) => { const w = WEAPONS[id], ok = run.parts >= r.parts && Object.entries(r).every(([k, v]) => k === 'parts' || (run.materials[k] || 0) >= v);
    return `<button class="opt ${ok ? '' : 'dis'}" data-make="${id}"><b>${w.rare ? '💎 ' : ''}${w.name}</b><small>${{ gun: '쏘기', melee: '휘두르기', throw: '던지기', beam: '줄기' }[w.type]} · 피해 ${w.dmg[0]}${w.range ? ' · 사거리 ' + w.range : ''}<br>부품 ${r.parts} + ${matText(Object.fromEntries(Object.entries(r).filter(([k]) => k !== 'parts')))}</small></button>`; }).join('')}</div>`;
  if (tab === 'mod') body = `<p>무기 강화는 들고 있는 <b>모든 무기에 함께</b> 적용된다. 부품 ${run.parts}개 (1단계 ${MOD_COST[1]}개, 2단계 ${MOD_COST[2]}개, 3단계 ${MOD_COST[3]}개)</p><div class="grid">${Object.values(MODS).map(m => { const lv = (run.mods || {})[m.id] || 0, max = lv >= m.max, c = MOD_COST[lv + 1], ok = !max && run.parts >= c;
    return `<button class="opt ${ok ? '' : 'dis'}" data-mod="${m.id}"><b>🔧 ${m.name} ${'■'.repeat(lv)}${'□'.repeat(m.max - lv)}</b><small>${lv ? `지금: ${m.text(lv)}<br>` : ''}${max ? '최고 단계' : `${lv + 1}단계: ${m.text(lv + 1)} · 부품 ${c}개`}</small></button>`; }).join('')}</div>`;
  if (tab === 'weapon') body = `<p>부품 ${run.parts}개 (★2 ${UPGRADE_COST[2]}개, ★3 ${UPGRADE_COST[3]}개)</p><div class="grid">${run.weapons.map((w, i) => { const c = UPGRADE_COST[w.star + 1], ok = w.star < 3 && run.parts >= c;
    return `<button class="opt ${ok ? '' : 'dis'}" data-wu="${i}"><b>${WEAPONS[w.id].name} ★${w.star}</b><small>${w.star >= 3 ? '최고 단계' : `★${w.star + 1}로 강화: 부품 ${c}개 · 피해 ${WEAPONS[w.id].dmg[w.star - 1]} → ${WEAPONS[w.id].dmg[w.star]}`}</small></button>`; }).join('')}</div>`;
  show(`<h2>🔧 정비소 (환승 통로)</h2><p>가진 재료: ${haveText()} · 부품 ${run.parts}</p><p>지금 장비: ${worn}</p>${tabs}${body}<div class="row"><button class="btn" id="next">다음 노선 고르기</button></div>`);
  on('[data-t]', el => shop(el.dataset.t));
  on('[data-g]', el => { if (craftGear(run, el.dataset.g)) showTip(`🧵 ${josa(GEAR[el.dataset.g].name, '을', '를')} 만들어 입었다`, 2); shop('gear'); });
  on('[data-i]', el => { if (craftItem(run, el.dataset.i)) showTip(`🧪 ${josa(CONSUMABLES[el.dataset.i].name, '을', '를')} 만들었다`, 2); shop('item'); });
  on('[data-wu]', el => { upgradeWeapon(run, +el.dataset.wu); shop('weapon'); });
  on('[data-make]', el => { if (craftWeapon(run, el.dataset.make)) showTip(`🔫 ${josa(WEAPONS[el.dataset.make].name, '을', '를')} 만들었다`, 2); shop('make'); });
  on('[data-mod]', el => { if (upgradeMod(run, el.dataset.mod)) showTip(`🔧 ${MODS[el.dataset.mod].name} ${run.mods[el.dataset.mod]}단계`, 2); shop('mod'); });
  on('#next', () => transfer('choose'));
}

// ---------- 끝 ----------
function summary() { return `통과한 노선 ${run.visited.length}/9 (${run.visited.map(n => LINES[n].name).join(' → ') || '없음'}) · 쓰러뜨린 적 ${run.kills || 0} · 걸린 시간 ${Math.round(run.ticks / TICK_HZ / 60)}분`; }
async function recordRun() {
  clearCheckpoint();
  if (!lab.online) return '';
  const out = await finishRunOnServer(run);
  if (!out?.ok) return '<p>⚠️ 기록을 서버에 저장하지 못했다. 다음에 다시 시도한다.</p>';
  return `<p>🪙 코인 +${out.gained}${out.gained < out.earned ? ` (하루 상한 200코인까지만 받는다)` : ''} · 지금 코인 ${out.coins}</p>`;
}
async function gameOver() { show(`<h2>💀 쓰러졌다</h2><p>${summary()}</p><p>기록을 저장하는 중…</p>`); const msg = await recordRun();
  show(`<h2>💀 쓰러졌다</h2><p>${summary()}</p>${msg}<p>무기·장비·강화·부품은 사라진다. 다시 처음부터 도전하자.</p><div class="row"><button class="btn" id="t">처음 화면으로</button></div>`); on('#t', title); }
async function victory() { show(`<h1>🎉 탈출 성공!</h1><p>기록을 저장하는 중…</p>`); const msg = await recordRun();
  show(`<h1>🎉 탈출 성공!</h1><p>${josa(JOBS[run.jobId].name, '으로', '로')} 9개 노선을 모두 지나 도시를 빠져나왔다.</p><p>${summary()}</p>${msg}<div class="row"><button class="btn" id="t">처음 화면으로</button></div>`); on('#t', title); }
function pause() {
  game.paused = true;
  show(`<h2>⏸ 멈춤</h2><p>칸 도중에 나가면 그 칸 처음부터 다시 한다(적 구성은 같다).</p><div class="row"><button class="btn" id="c">계속하기</button><button class="btn ghost" id="fs">⛶ 전체 화면</button><button class="btn ghost" id="q">처음 화면으로</button></div>`);
  on('#fs', () => goFullscreen());
  on('#c', () => { hide(); game.paused = false; });
  on('#q', title);
}
export { RELICS };
