// 칸 하나의 상태를 만들고, 칸 안의 진행(웨이브·연결문)을 다룬다
import { CAR_W, Y0, Y1, DT, TICK_HZ } from './constants.js';
import { createRng } from './rng.js';
import { difficulty } from './run.js';
import { LINES } from './data/lines.js';
import { spawnMon, setupBoss } from './ai.js';

// 실제 전동차처럼 한쪽에 출입문 4개
export const SIDE_DOORS = [150, 385, 640, 875];
const FIRST_WAVE_TICK = 15, WAVE_GAP = 1.5;

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
    env: null, stats: { kills: 0, hits: 0 }, codex: { gear: [], status: [], monsters: [] }, seen: [...run.codex.status], pending: [], log: [], allies: [], lit: !!run.lit, showInflict: !!run.showInflict,
  };
  // 노선 환경(숨겨진 칸을 풀면 사라짐). 9호선은 칸마다 폭염·침수·한파 중 하나를 절반 세기로
  if (!s.solved) {
    if (L.hazard === 'elnino') { const r = createRng(seed).fork('elnino'); s.env = { status: r.pick(L.elninoPool), strength: L.elninoStrength }; }
    else if (L.envStatus) s.env = { status: L.envStatus, strength: s.carType === 'hazard' ? 1.5 : 1 };
    else if (L.hazard === 'dark') s.env = { dark: true, radius: L.darkRadius };
  }
  if (boss) { s.bossLine = lineData.line; setupBoss(s, lineData); }
  return s;
}

function spawnWave(s, rng) {
  const wave = s.waves[s.waveIndex++], opened = [];
  const p = s.player;
  let doors = SIDE_DOORS.filter(x => Math.abs(x - p.x) >= 150 && Math.abs(x - p.x) <= 650);
  if (!doors.length) doors = SIDE_DOORS;
  for (const g of wave) {
    const dx = rng.pick(doors), top = rng.chance(0.5);
    for (let i = 0; i < g.count; i++) spawnMon(s, g.monster, dx + rng.range(-24, 24), top ? Y0 : Y1);
    opened.push({ x: dx, top });
  }
  s.events.push({ type: 'wave', index: s.waveIndex, doors: opened });
}

// 웨이브와 연결문. 매 틱 step에서 부른다
export function updateCar(s, rng) {
  const alive = s.mons.filter(m => !m.dummy && !m.gone).length;
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
    if (s.player.jobId === 'ecologist') s.player.energy = Math.min(s.player.maxEnergy, s.player.energy + 30);
  }
  if (s.doorOpen && s.player.x >= CAR_W - 30 && !s.done) s.done = 'cleared';
}
export { TICK_HZ };
