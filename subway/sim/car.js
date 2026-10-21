// 칸 하나의 상태를 만들고, 칸 안의 진행(웨이브·연결문)을 다룬다
import { CAR_W, Y0, Y1, DT, TICK_HZ } from './constants.js';
import { createRng } from './rng.js';
import { difficulty } from './run.js';
import { LINES } from './data/lines.js';
import { spawnMon, setupBoss } from './ai.js';

// 실제 전동차처럼 한쪽에 출입문 4개
export const SIDE_DOORS = [110, 256, 402];   // 짧아진 칸: 한쪽에 출입문 3개
const FIRST_WAVE_TICK = 15, WAVE_GAP = 1.5;
export const GANGWAY_IN = 34, GANGWAY_Y = [168, 248];   // 앞 연결 통로: 문이 열리면 이만큼 걸어 들어가야 다음 칸

function playerFrom(run) {
  return {
    x: 60, y: (Y0 + Y1) / 2, vx: 0, vy: 0, face: 1, aim: 0,
    jobId: run.jobId, relics: run.relics,
    hp: run.hp, maxHp: run.maxHp, shield: run.shield, maxShield: run.maxShield, energy: run.energy, maxEnergy: run.maxEnergy,
    weapons: run.weapons.map(w => ({ ...w })), weapon: run.weapon, mods: { ...(run.mods || {}) }, legends: [...(run.legends || [])], quickT: 0, gear: { ...run.gear }, items: [...run.items], itemSlots: run.itemSlots,
    meters: { ...run.meters }, status: {}, baseShield: run.maxShield, cool: 0, recoil: 0, swing: 0, sinceHit: 99, regen: 0, skillCd: 0, beam: false,
    attackHeld: false, swapHeld: false, itemHeld: false, skillHeld: false,
  };
}

// 칸 상태. 모든 값은 JSON으로 저장할 수 있다(난수는 정수 rng로)
export function createCarState(run, lineData, carIndex, opts = {}) {
  const car = lineData.cars[carIndex];
  const boss = opts.boss ? lineData.boss : null;
  const seed = boss ? boss.seed : car.seed;
  const L = LINES[lineData.line];
  const s = {
    v: 1, tick: 0, rng: createRng(seed).state(), line: lineData.line, lineIndex: run.lineIndex,
    carIndex, carType: boss ? 'boss' : car.type, solved: run.solved.includes(lineData.line),
    diff: difficulty(run, boss ? lineData.cars.length : carIndex),
    waves: boss ? [] : car.waves.map(w => w.map(g => ({ ...g }))), waveIndex: 0, waveWait: 0,
    player: playerFrom(run), mons: [], shots: [], eshots: [], zones: [], pickups: [], nextId: 1,
    doorOpen: false, done: null, events: [], gained: { materials: {}, parts: 0, items: [], weapons: [] },
    env: null, stats: { kills: 0, hits: 0 }, codex: { gear: [], status: [], monsters: [] }, seen: [...run.codex.status], pending: [], log: [], allies: [], props: [], drops: [], rewarded: false, lit: !!run.lit, showInflict: !!run.showInflict,
  };
  // 노선 환경(숨겨진 칸을 풀면 사라짐). 9호선은 칸마다 폭염·침수·한파 중 하나를 절반 세기로
  if (!s.solved) {
    if (L.hazard === 'elnino') { const r = createRng(seed).fork('elnino'); s.env = { status: r.pick(L.elninoPool), strength: L.elninoStrength }; }
    else if (L.envStatus) s.env = { status: L.envStatus, strength: s.carType === 'hazard' ? 1.5 : 1 };
    else if (L.hazard === 'dark') s.env = { dark: true, radius: L.darkRadius };
  }
  if (boss) { s.bossLine = lineData.line; setupBoss(s, lineData); }
  placeProps(s, createRng(seed).fork('props'), lineData.line);
  return s;
}

// 몬스터는 문을 열고 들어온다: 옆 출입문 6곳(위·아래)과 양 끝 연결문 2곳이 한꺼번에 열리므로 어느 문에서 나올지 알 수 없다
const ALL_DOORS = [...SIDE_DOORS.flatMap(x => [{ kind: 'side', x, top: true }, { kind: 'side', x, top: false }]), { kind: 'back', x: 16 }, { kind: 'front', x: CAR_W - 16 }];
function spawnWave(s, rng) {
  const wave = s.waves[s.waveIndex++], mid = (Y0 + Y1) / 2;
  for (const g of wave) {
    const d = rng.pick(ALL_DOORS);
    for (let i = 0; i < g.count; i++) {
      if (d.kind === 'side') spawnMon(s, g.monster, d.x + rng.range(-16, 16), d.top ? Y0 : Y1);
      else spawnMon(s, g.monster, d.x, mid + rng.range(-30, 30));
    }
  }
  s.events.push({ type: 'wave', index: s.waveIndex, doors: ALL_DOORS });
}

// 노선마다 놓이는 소품: 부술 수 있는 상자·쓰레기통·의자·폭발 드럼통(파밍), 노선 재난에 맞는 위험 바닥
const HAZARD = { 1: ['heatVent', 'heatstroke'], 2: ['sparkBox', 'shock'], 3: ['puddle', 'wet'], 4: ['acidPool', 'acidBurn'], 5: ['sporeMold', 'infection'],
  6: ['sandPile', 'blur'], 7: ['icePatch', 'slip'], 8: ['poisonPool', 'poison'] };
const LOOT_PROPS = { crate: { hp: 6, r: 14 }, bin: { hp: 4, r: 11 }, seat: { hp: 8, r: 14 }, barrel: { hp: 3, r: 12 } };
function placeProps(s, rng, line) {
  if (s.carType === 'boss') { s.layout = 'gate'; return; }
  const n = 3 + rng.int(3), taken = [], mid = (Y0 + Y1) / 2;
  // 칸마다 배치가 다르다: 손잡이 기둥 칸, 짐 바리케이드 칸, 천장이 무너진 칸, 평범한 객실
  s.layout = s.carType === 'hazard' ? 'debris' : rng.pick(['seats', 'poles', 'barricade', 'debris']);
  const add = (kind, x, y, o = {}) => { taken.push({ x, y }); s.props.push({ uid: s.nextId++, kind, x, y, solid: true, ...o }); };
  if (s.layout === 'poles') [0.3, 0.5, 0.7].forEach((k, i) => add('pole', Math.round(CAR_W * k), mid + (i % 2 ? 34 : -34), { r: 6 }));
  else if (s.layout === 'barricade') { const bx = Math.round(rng.range(230, 300)); for (const y of [Y0 + 24, mid + 6, Y1 - 14]) add('crate', bx + rng.range(-8, 8), y, { hp: 6, maxHp: 6, r: 14 }); }
  else if (s.layout === 'debris') for (let i = 0; i < 2; i++) add('rubble', Math.round(rng.range(160, CAR_W - 120)), Math.round(rng.range(Y0 + 30, Y1 - 20)), { r: 18 });
  const spot = () => { for (let k = 0; k < 20; k++) { const x = rng.range(110, CAR_W - 50), y = rng.range(Y0 + 18, Y1 - 6);
    if (taken.every(t => Math.hypot(t.x - x, t.y - y) > 44)) { taken.push({ x, y }); return { x, y }; } } return { x: rng.range(110, CAR_W - 50), y: rng.range(Y0 + 18, Y1 - 6) }; };
  for (let i = 0; i < n; i++) {
    const kind = rng.pick(['crate', 'crate', 'bin', 'seat', 'barrel']), P = LOOT_PROPS[kind], p = spot();
    if (kind === 'seat') p.y = rng.chance(0.5) ? Y0 + 4 : Y1 - 2;   // 의자는 벽 쪽에 붙어 있다
    s.props.push({ uid: s.nextId++, kind, x: p.x, y: p.y, hp: P.hp, maxHp: P.hp, r: P.r, solid: true });
  }
  const hz = HAZARD[line === 9 ? rng.pick([1, 3, 7]) : line];
  if (hz && !s.solved) for (let i = 0; i < 1 + rng.int(2); i++) { const p = spot();
    s.props.push({ uid: s.nextId++, kind: hz[0], x: p.x, y: p.y, r: 26, hazard: hz[1] });
    s.zones.push({ kind: hz[0], status: hz[1], x: p.x, y: p.y, r: 26, t: 1e9, src: 'env', perSec: 4 }); }
}

// 웨이브와 연결문. 매 틱 step에서 부른다
export function updateCar(s, rng) {
  for (const o of s.props) if (o.flash > 0) o.flash = Math.max(0, o.flash - DT);
  // 천장에서 떨어지는 몬스터: 그림자(경고) 뒤에 내려온다
  for (const d of s.drops) if (--d.t <= 0) { spawnMon(s, d.id, d.x, d.y); s.events.push({ type: 'land', x: d.x, y: d.y }); }
  s.drops = s.drops.filter(d => d.t > 0);
  const alive = s.mons.filter(m => !m.dummy && !m.gone).length + s.drops.length;
  if (s.waveIndex < s.waves.length) {
    if (s.waveIndex === 0) { if (s.tick >= FIRST_WAVE_TICK) spawnWave(s, rng); }
    else if (alive <= 2) { s.waveWait += DT; if (s.waveWait >= WAVE_GAP) { s.waveWait = 0; spawnWave(s, rng); } }
  }
  if (s.carType === 'boss') {
    if (s.bossSpawned && !s.bossPending && !s.mons.some(m => m.boss && !m.gone) && !s.done) { s.done = 'cleared'; s.events.push({ type: 'bossDown' }); }
    return;
  }
  if (!s.doorOpen && s.waveIndex >= s.waves.length && alive === 0) {
    s.doorOpen = true; s.events.push({ type: 'door' });
    // 칸 보상 상자: 재료 2개와 부품 3개(무기·장비를 만들 거리)
    if (s.carType !== 'cargo' && !s.rewarded) { s.rewarded = true; s.gained.parts += 3; const mats = ['cloth', 'vinyl', 'rubber', 'glass', 'filter', 'leather', 'string', 'scrap'];
      const got = [rng.pick(mats), rng.pick(mats)]; for (const m of got) s.gained.materials[m] = (s.gained.materials[m] || 0) + 1; s.events.push({ type: 'reward', materials: got, parts: 3 }); }
    if (s.player.jobId === 'ecologist') s.player.energy = Math.min(s.player.maxEnergy, s.player.energy + 30);
  }
  if (s.doorOpen && s.player.x >= CAR_W + GANGWAY_IN && !s.done) s.done = 'cleared';
}
export { TICK_HZ };
