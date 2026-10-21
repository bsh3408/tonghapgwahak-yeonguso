// 한 판(run)과 노선(전동차 한 편성)을 만든다. 같은 씨앗값이면 언제나 같은 결과가 나온다.
import { createRng } from './rng.js';
import { JOBS } from './data/jobs.js';
import { MONSTERS } from './data/monsters.js';
import { BOSSES } from './data/bosses.js';
import { LINES } from './data/lines.js';
import { ITEM_SLOTS, CONSUMABLES, ITEM_RECIPES } from './data/consumables.js';
import { GEAR, MATERIALS } from './data/gear.js';
import { WEAPONS, RARE_WEAPONS } from './data/weapons.js';
import { createCarState } from './car.js';
import { gainWeapon } from './combat.js';
import { MODS, MOD_COST } from './data/mods.js';
import { LEGENDS, LEGEND_CHANCE } from './data/legends.js';
import { applyRelics } from './jobs.js';

export function createRun({ seed, jobId, relicIds }) {
  const j = JOBS[jobId];
  return applyRelics({
    seed: seed >>> 0, jobId, relics: [...relicIds],
    lineIndex: 0, visited: [], line: null, carIndex: 0,
    hp: j.hp, maxHp: j.hp, shield: j.shield, maxShield: j.shield, energy: j.energy, maxEnergy: j.energy,
    weapons: [{ id: j.startWeapon, star: 1 }, { id: 'slingshot', star: 1 }], weapon: 0, mods: {}, legends: [],
    gear: { head: null, body: null, feet: null },
    items: [], itemSlots: ITEM_SLOTS + (j.traits.includes('extraItemSlot') ? 1 : 0),
    materials: {}, parts: 0, meters: { infection: 0, heat: 0 },
    solved: [], codex: { gear: [], status: [], monsters: [] }, log: [],
    escaped: false, dead: false, ticks: 0, noteUsed: false,
  });
}

// 설계서 5절 난이도 증가. carIndex는 0부터
export function difficulty(run, carIndex) {
  const L = run.lineIndex;
  return {
    extraEnemies: carIndex,
    hpMul: (1 + 0.1 * carIndex) * (1 + 0.2 * L),
    atkSpeedMul: 1 + 0.05 * carIndex,
    statusDurMul: 1 + 0.1 * L,
    eliteChance: carIndex >= 2 ? 0.1 * (L + 1) : 0,
  };
}

// 그 노선에 나오는 일반·원거리 몬스터와 뽑힐 무게
function pool(line) {
  const out = [];
  for (const m of Object.values(MONSTERS)) {
    if (m.kind === 'elite' || m.hidden) continue;
    if (!m.lines.includes(line)) continue;
    let w = 1;
    if (LINES[line].invaders?.includes(m.id)) w = 3;
    if (line === 5 && m.weight5) w = m.weight5;
    out.push([m.id, w]);
  }
  return out;
}
function weighted(rng, list) {
  let t = 0; for (const [, w] of list) t += w;
  let x = rng.next() * t;
  for (const [id, w] of list) { x -= w; if (x < 0) return id; }
  return list.at(-1)[0];
}
const elitesOf = line => Object.values(MONSTERS).filter(m => m.kind === 'elite' && m.lines.includes(line)).map(m => m.id);

export function generateLine(run, line) {
  const rng = createRng(run.seed).fork('line' + line);
  const n = 5 + rng.int(3);
  const types = Array(n).fill('cabin'); types[n - 1] = 'cab';
  const cargo = 1 + rng.int(n - 2); types[cargo] = 'cargo';
  let hazard; do { hazard = rng.int(n - 1); } while (hazard === cargo); types[hazard] = 'hazard';
  const P = pool(line);
  const cars = types.map((type, index) => {
    if (type === 'cargo') return { index, type, waves: [], seed: rng.int(2 ** 31) };
    const d = difficulty(run, index), waveCount = type === 'cab' ? 3 : 2;
    const groups = 3 + d.extraEnemies + (type === 'cab' ? 1 : 0);
    const waves = Array.from({ length: waveCount }, () => []);
    for (let g = 0; g < groups; g++) {
      const id = weighted(rng, P);
      waves[g % waveCount].push({ monster: id, count: MONSTERS[id].swarm || 1 });
    }
    const E = elitesOf(line); if (rng.chance(d.eliteChance) && E.length) waves[waveCount - 1].push({ monster: rng.pick(E), count: 1 });
    return { index, type, waves, seed: rng.int(2 ** 31) };
  });
  const b = BOSSES[line];
  return { line, cars, boss: { line, ...b, hp: Math.round(b.hp * (1 + 0.2 * run.lineIndex)), seed: rng.int(2 ** 31) } };
}

// 환승 통로에서 고르는 다음 노선. 첫 노선은 3개, 그 뒤로는 2개. 아직 안 간 노선(1~9) 중 무작위
export function offerLines(run) {
  const left = [1, 2, 3, 4, 5, 6, 7, 8, 9].filter(n => !run.visited.includes(n));
  const n = Math.min(left.length, run.visited.length === 0 ? 3 : 2);
  const rng = createRng(run.seed).fork('offer' + run.visited.length), out = [];
  while (out.length < n) out.push(left.splice(rng.int(left.length), 1)[0]);
  return out.sort((x, y) => x - y);
}

// ---------- 한 판의 흐름: 칸 들어가기·끝내기, 짐칸, 환승 통로(연구 노트·정비소) ----------
// 칸 번호가 칸 수와 같으면 승강장 → 개찰구 보스 칸
export function enterCar(run, lineData, i) {
  run.line = lineData.line; run.carIndex = i;
  return createCarState(run, lineData, Math.min(i, lineData.cars.length - 1), { boss: i >= lineData.cars.length });
}

export function finishCar(run, s) {
  const p = s.player;
  Object.assign(run, { mods: { ...(p.mods || {}) }, legends: [...(p.legends || [])], hp: p.hp, shield: p.shield, maxShield: p.maxShield, energy: p.energy, weapons: p.weapons.map(w => ({ ...w })), weapon: p.weapon,
    gear: { ...p.gear }, items: [...p.items], meters: { infection: p.meters.infection, heat: 0 } });
  for (const [k, v] of Object.entries(s.gained.materials)) run.materials[k] = (run.materials[k] || 0) + v;
  run.parts = Math.max(0, run.parts + s.gained.parts);
  for (const k of ['gear', 'status', 'monsters']) for (const v of s.codex[k]) if (!run.codex[k].includes(v)) run.codex[k].push(v);
  run.ticks += s.tick; run.kills = (run.kills || 0) + s.stats.kills;
  if (s.done === 'dead') run.dead = true;
  else run.carIndex = s.carType === 'boss' ? 0 : run.carIndex + 1;
  return run;
}

export function finishLine(run) {
  if (!run.visited.includes(run.line)) run.visited.push(run.line);
  run.lineIndex = run.visited.length;
  run.carIndex = 0;
  if (run.visited.length >= 9) run.escaped = true;
  return run;
}

const WEAPON_IDS = Object.keys(WEAPONS);
const MAT_IDS = Object.keys(MATERIALS).filter(k => k !== 'waterBottle');
// 짐칸 상자: 무기 2개 중 1개 고르기 + 재료 2~3개(설계서 5절·7절)
export function openCargo(run, lineData, i) {
  const rng = createRng(lineData.cars[i].seed).fork('cargo');
  const owned = run.weapons.map(w => w.id);
  const pool = WEAPON_IDS.filter(id => id !== 'slingshot' && !WEAPONS[id].rare);
  // 3번째 노선부터는 칸마다 15% 확률로 희귀 무기가 섞인다
  const draw = () => run.lineIndex >= 2 && rng.chance(0.15) ? rng.pick(RARE_WEAPONS) : rng.pick(pool);
  const a = draw(); let b; do { b = draw(); } while (b === a);
  const materials = {}; for (let k = 2 + rng.int(2); k > 0; k--) { const m = rng.pick(MAT_IDS); materials[m] = (materials[m] || 0) + 1; }
  return { weapons: [a, b], materials, owned };
}
export function takeCargo(run, loot, weaponId) {
  if (weaponId) gainWeapon(run, weaponId);
  for (const [k, v] of Object.entries(loot.materials)) run.materials[k] = (run.materials[k] || 0) + v;
}

// 연구 노트: 맞히면 강화 3개 중 1개, 틀리면 부품 3개(낡은 연구 노트 유물은 한 번 봐줌)
export function researchNote(run, question, answerIndex) {
  const correct = answerIndex === question.answer;
  const forgive = !correct && run.relics.includes('oldNote') && !run.noteUsed;
  if (forgive) run.noteUsed = true;
  if (!correct && !forgive) { run.parts += 3; return { correct, upgrades: [] }; }
  run.noteCount = (run.noteCount || 0) + 1;
  const rng = createRng(run.seed).fork('note' + run.noteCount);
  const pool = [{ kind: 'maxHp', text: '최대 체력 +1' }, { kind: 'maxShield', text: '최대 방어막 +1' }, { kind: 'maxEnergy', text: '최대 에너지 +30' }, { kind: 'parts', text: '부품 +6' }, { kind: 'heal', text: '체력 모두 회복' }];
  for (const w of run.weapons) if (w.star < 3) pool.push({ kind: 'star', weapon: w.id, text: `${WEAPONS[w.id].name} ★${w.star + 1}` });
  // 공통 무기 강화도 2개 섞는다(아직 최대가 아닌 것 중에서)
  const openMods = Object.values(MODS).filter(m => ((run.mods || {})[m.id] || 0) < m.max);
  for (let k = 0; k < 2 && openMods.length; k++) { const m = openMods.splice(rng.int(openMods.length), 1)[0], lv = ((run.mods || {})[m.id] || 0) + 1; pool.push({ kind: 'mod', mod: m.id, text: `🔧 ${m.name} ${lv}단계: ${m.text(lv)}` }); }
  const items = Object.keys(CONSUMABLES); pool.push({ kind: 'item', item: rng.pick(items) });
  const pick = []; while (pick.length < 3 && pool.length) pick.push(pool.splice(rng.int(pool.length), 1)[0]);
  for (const u of pick) if (u.kind === 'item') u.text = `${CONSUMABLES[u.item].name} 1개`;
  // 운이 좋으면(20%) 마지막 칸에 아직 없는 전설 강화가 뜬다
  const lf = Object.values(LEGENDS).filter(l => !(run.legends || []).includes(l.id));
  if (lf.length && rng.chance(LEGEND_CHANCE)) { const l = rng.pick(lf); pick[pick.length - 1] = { kind: 'legend', legend: l.id, text: `🌟 전설: ${l.icon} ${l.name}: ${l.text}` }; }
  return { correct, forgiven: forgive, upgrades: pick };
}
export function applyUpgrade(run, u) {
  switch (u.kind) {
    case 'maxHp': run.maxHp += 1; run.hp += 1; break;
    case 'maxShield': run.maxShield += 1; run.shield += 1; break;
    case 'maxEnergy': run.maxEnergy += 30; run.energy += 30; break;
    case 'parts': run.parts += 6; break;
    case 'heal': run.hp = run.maxHp; break;
    case 'star': { const w = run.weapons.find(x => x.id === u.weapon); if (w) w.star = Math.min(3, w.star + 1); break; }
    case 'item': if (run.items.length < run.itemSlots) run.items.push(u.item); break;
    case 'legend': { run.legends ||= []; if (!run.legends.includes(u.legend)) run.legends.push(u.legend); break; }
    case 'mod': { run.mods ||= {}; run.mods[u.mod] = Math.min(MODS[u.mod].max, (run.mods[u.mod] || 0) + 1); break; }
  }
}

// 정비소(설계서 7절): 장비 만들기는 재료로, 기능은 화면에 보이지 않음. 수선 도구 유물은 재료 1개 덜 듦
export function gearCost(run, gearId) {
  const r = { ...GEAR[gearId].recipe };
  if (run.relics.includes('sewingKit')) { const k = Object.keys(r).sort((a, b) => r[b] - r[a])[0]; r[k] -= 1; if (r[k] <= 0) delete r[k]; }
  return r;
}
const canPay = (run, cost) => Object.entries(cost).every(([k, v]) => (run.materials[k] || 0) >= v);
const pay = (run, cost) => { for (const [k, v] of Object.entries(cost)) run.materials[k] -= v; };
export function craftGear(run, gearId) {
  const cost = gearCost(run, gearId);
  if (!canPay(run, cost)) return false;
  pay(run, cost); run.gear[GEAR[gearId].slot] = gearId; return true;
}
export function craftItem(run, itemId) {
  const cost = ITEM_RECIPES[itemId];
  if (run.items.length >= run.itemSlots || !canPay(run, cost)) return false;
  pay(run, cost);
  const n = JOBS[run.jobId].traits.includes('extraCraft') ? 2 : 1;
  for (let i = 0; i < n && run.items.length < run.itemSlots; i++) run.items.push(itemId);
  return true;
}
export const UPGRADE_COST = { 2: 10, 3: 25 };
export function upgradeWeapon(run, slot) {
  const w = run.weapons[slot]; if (!w || w.star >= 3) return false;
  const cost = UPGRADE_COST[w.star + 1]; if (run.parts < cost) return false;
  run.parts -= cost; w.star += 1; return true;
}

// 연구 노트 문제는 판의 씨앗값과 지난 노선 수로 정한다(새로고침해도 같은 문제: 되돌려 다시 풀기 방지)
export function pickNote(run, questions) {
  return createRng(run.seed).fork('noteQ' + run.visited.length).int(questions.length);
}

// 공통 무기 강화 올리기(정비소). 1단계 6, 2단계 12, 3단계 20 부품
export function upgradeMod(run, id) {
  run.mods ||= {};
  const lv = (run.mods[id] || 0) + 1, M = MODS[id];
  if (!M || lv > M.max || run.parts < MOD_COST[lv]) return false;
  run.parts -= MOD_COST[lv]; run.mods[id] = lv; return true;
}

// 정비소 무기 만들기: 보통 무기는 부품 6 + 고철 1 + 끈 1, 희귀 무기는 부품 15 + 고철 2 + 유리 1 + 고무 1
export const WEAPON_RECIPES = Object.fromEntries(Object.values(WEAPONS).filter(w => w.id !== 'slingshot').map(w =>
  [w.id, w.rare ? { parts: 15, scrap: 2, glass: 1, rubber: 1 } : { parts: 6, scrap: 1, string: 1 }]));
export function craftWeapon(run, id) {
  const r = WEAPON_RECIPES[id]; if (!r) return false;
  if (run.parts < r.parts || Object.entries(r).some(([k, v]) => k !== 'parts' && (run.materials[k] || 0) < v)) return false;
  run.parts -= r.parts; for (const [k, v] of Object.entries(r)) if (k !== 'parts') run.materials[k] -= v;
  gainWeapon(run, id); return true;
}
