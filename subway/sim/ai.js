// 몬스터·특수 몬스터·보스의 행동 (설계서 8절). 상태 이상은 inflict()로 s.pending에 넣고 status.js가 처리한다
import { SPEED_SCALE, DT, TICK_HZ, Y0, Y1, CAR_W } from './constants.js';
import { MONSTERS } from './data/monsters.js';
import { BOSSES } from './data/bosses.js';
import { MATERIALS } from './data/gear.js';
import { damagePlayer, damageMon, monCenter, monRadius, chest } from './combat.js';

const clampX = x => Math.max(12, Math.min(CAR_W - 12, x)), clampY = y => Math.max(Y0, Math.min(Y1, y));
const MATS = Object.keys(MATERIALS).filter(k => k !== 'waterBottle');

export function inflict(s, status, opts = {}) {
  const e = { status, amount: opts.amount, variant: opts.variant, source: opts.source || '', strength: opts.strength ?? 1, tick: s.tick };
  (s.pending ||= []).push(e);
  (s.log ||= []).push(e); if (s.log.length > 200) s.log.shift();
}

export function spawnMon(s, id, x, y, opts = {}) {
  const d = MONSTERS[id];
  const hp = Math.round(opts.hp ?? d.hp * s.diff.hpMul);
  const m = {
    uid: s.nextId++, id, x: clampX(x), y: clampY(y),
    hp, maxHp: hp, atk: d.atk, speed: d.speed * SPEED_SCALE, face: x < s.player.x ? 1 : -1,
    r: d.kind === 'elite' ? 20 : d.fly ? 10 : 14, fly: !!d.fly, elite: d.kind === 'elite',
    t: 0, cd: 1, act: 0, stun: 0, slowT: 0, slowPct: 0, flash: 0, kx: 0, ky: 0, status: {}, born: s.tick,
    frontShield: d.special === 'frontShield', shieldOff: 0, splitDone: 0,
  };
  s.mons.push(m);
  if (d.escort && !opts.noEscort) for (let i = 0; i < d.escort.count; i++) spawnMon(s, d.escort.id, x + (i - 1) * 24, y + 16, { noEscort: true }).mother = m.uid;
  return m;
}

// 보스 칸: 노선 보스를 세운다. 8호선은 웨이브(풀면 2번) 뒤에 나온다
export function setupBoss(s, lineData) {
  const B = lineData.boss, line = lineData.line;
  if (line === 8) {
    const n = s.solved ? 2 : 3;
    s.waves = Array.from({ length: n }, (_, i) => [{ monster: i % 2 ? 'frog' : 'nutria', count: 3 + i }]);
    s.bossPending = true; s.bossHp = B.hp; return;
  }
  spawnBossBody(s, B);
}
function spawnBossBody(s, B) {
  const n = B.count || 1; s.bossSpawned = true;
  for (let i = 0; i < n; i++) {
    const m = { uid: s.nextId++, id: B.id, boss: true, line: B.line, x: CAR_W - 220 + i * 50, y: (Y0 + Y1) / 2 + (i - (n - 1) / 2) * 50, hp: B.hp, maxHp: B.hp, atk: B.atk, speed: B.speed * SPEED_SCALE,
      face: -1, r: n > 1 ? 24 : 44, t: 0, cd: 1, atkCd: 2 + i * 0.7, atkT: 0, acted: false, dash: 0, dashA: 0, chargesLeft: 0, stun: 0, slowT: 0, slowPct: 0, flash: 0, kx: 0, ky: 0, status: {}, phase: 0, splitDone: 0 };
    s.mons.push(m);
  }
}

function contact(s, m) {
  const d = MONSTERS[m.id];
  if (!d) return;
  let atk = m.atk;
  const g = d.unguarded, gearOn = g && Object.values(s.player.gear).includes(g.gear);
  if (g && g.atkBonus && !gearOn) atk += g.atkBonus;
  if (atk > 0) damagePlayer(s, atk, { melee: true, mon: m });
  if (d.inflicts && !(d.special === 'steal' || d.special === 'stealWeapon')) {
    let amount = d.inflicts.amount;
    if (g && g.inflictAmount && !gearOn) amount = g.inflictAmount;
    if (!d.inflicts.whenWet || s.player.status.wet) inflict(s, d.inflicts.status, { amount, variant: d.inflicts.variant, source: m.id });
  }
  if (d.special === 'steal' || d.special === 'stealWeapon') steal(s, m, d);
  if (d.special === 'hitAndRun') m.retreat = 1;
}

function steal(s, m, d) {
  if (m.carrying !== undefined) return;
  const p = s.player;
  if (p.relics.includes('lockBag')) { s.events.push({ type: 'relicBlocked', relic: 'lockBag' }); return; }
  if (d.special === 'stealWeapon') {
    if (p.weapons.length <= 1) return;
    const [w] = p.weapons.splice(p.weapon, 1); p.weapon = Math.min(p.weapon, p.weapons.length - 1);
    m.carrying = { weapon: w }; m.stoleAt = s.tick;
  } else {
    m.carrying = { parts: 1 }; s.gained.parts -= 1;
  }
  inflict(s, 'stolen', { source: m.id });
  m.flee = true; m.speed *= 1.2;
}

function shoot(s, m, d, rng) {
  const b = monCenter(m), c = chest(s.player), a = Math.atan2(c.y - b.y, c.x - b.x) + rng.range(-0.08, 0.08);
  const sh = d.shot;
  m.shotN = (m.shotN || 0) + 1;
  const electric = sh.electricEvery && m.shotN % sh.electricEvery === 0;
  s.eshots.push({ x: b.x, y: b.y, vx: Math.cos(a) * sh.speed, vy: Math.sin(a) * sh.speed, life: Math.round(2.2 * TICK_HZ), dmg: m.atk, col: sh.col, src: m.id,
    inflicts: d.inflicts && d.inflicts.status !== 'stolen' ? d.inflicts.status : null, electric, puddle: sh.puddle });
  s.stats.enemyShots = (s.stats.enemyShots || 0) + 1;
}

function addZone(s, z) { s.zones.push({ r: 40, t: 4 * TICK_HZ, ...z }); }

function normalAI(s, m, rng) {
  const d = MONSTERS[m.id], p = s.player;
  const dx = p.x - m.x, dy = p.y - m.y, dist = Math.hypot(dx, dy) || 1;
  let sp = m.speed * (m.slowT > 0 ? 1 - (m.slowPct || 0.5) : 1) * (m.howlT > 0 ? 1.5 : 1);
  let tx = dx / dist, ty = dy / dist;
  if (m.stun > 0) sp = 0;
  if (m.flee) {
    m.wpT = (m.wpT ?? 0) - DT;
    if (!m.wp || m.wpT <= 0 || Math.hypot(m.wp.x - m.x, m.wp.y - m.y) < 12) {
      let best = null; for (let k = 0; k < 6; k++) { const c = { x: rng.range(30, CAR_W - 30), y: rng.range(Y0 + 6, Y1 - 6) }; if (Math.hypot(c.x - p.x, c.y - p.y) > 120 && Math.hypot(c.x - m.x, c.y - m.y) > 60) { best = c; break; } best ||= c; }
      m.wp = best; m.wpT = 1.4;
    }
    const wx = m.wp.x - m.x, wy = m.wp.y - m.y, wl = Math.hypot(wx, wy) || 1; tx = wx / wl; ty = wy / wl; sp *= 1.1;
  }
  else if (m.retreat > 0) { m.retreat -= DT; tx = -tx; ty = -ty; }
  else if (d.kind === 'ranged') {
    m.cd -= DT;
    if (d.gas) { if (dist < d.range + 20 && m.cd <= 0) { m.cd = 3.5; addZone(s, { kind: 'gas', status: 'confusion', x: m.x, y: m.y, r: 44, t: 3 * TICK_HZ, dps: 1, src: m.id }); } }
    else {
      if (dist < d.range * 0.6) { tx = -tx; ty = -ty; } else if (dist < d.range) sp = 0;
      if (dist < d.range + 40 && m.cd <= 0 && m.stun <= 0) {
        if (d.shot.burst) { m.burst = d.shot.burst; m.burstT = 0; } else shoot(s, m, d, rng);
        m.cd = 2.2 / s.diff.atkSpeedMul;
      }
      if (m.burst > 0 && --m.burstT <= 0) { shoot(s, m, d, rng); m.burst--; m.burstT = 4; }
    }
  } else if (d.special === 'ambush' && !m.awake) { sp = 0; if (dist < 90) { m.awake = true; m.speed *= 2; } }
  else if (d.special === 'surround') { const off = (m.uid % 2 ? 1 : -1) * 50; tx = dx / dist; ty = (dy + off) / dist; }
  else if (d.special === 'charge') {
    m.dashCd = (m.dashCd ?? 1.5) - DT;
    if (m.dash > 0) { m.dash -= DT; sp = m.speed * 4 * (m.enraged ? 1.5 : 1); tx = Math.cos(m.dashA); ty = Math.sin(m.dashA);
      if (m.x <= 14 || m.x >= CAR_W - 14) { m.dash = 0; m.stun = 2; } }
    else if (m.dashCd <= 0 && dist < 260) { m.dash = 0.7; m.dashA = Math.atan2(dy, dx); m.dashCd = 3; }
  } else if (d.special === 'tongue') {
    m.tongueCd = (m.tongueCd ?? 2) - DT;
    if (m.tongueCd <= 0 && dist < 150) { m.tongueCd = 3; p.x -= (dx / dist) * 40; p.y = clampY(p.y - (dy / dist) * 20); inflict(s, 'wet', { source: m.id }); s.events.push({ type: 'tongue', uid: m.uid }); }
  }
  if (d.special === 'howl') { m.howlCd = (m.howlCd ?? 8) - DT; if (m.howlCd <= 0) { m.howlCd = 8; s.events.push({ type: 'howl', uid: m.uid }); inflict(s, 'fear', { source: m.id });
    for (const o of s.mons) if (o.id === 'dog' && Math.hypot(o.x - m.x, o.y - m.y) < 300) o.howlT = 5; } }
  if (m.howlT > 0) m.howlT -= DT;
  if (d.special === 'spawnAnts') {
    m.layCd = (m.layCd ?? 4) - DT; if (m.layCd <= 0) { m.layCd = 4; for (let i = 0; i < 2; i++) spawnMon(s, 'fireant', m.x + rng.range(-30, 30), m.y + rng.range(-20, 20)); }
    m.acidCd = (m.acidCd ?? 2) - DT; if (m.acidCd <= 0) { m.acidCd = 2; addZone(s, { kind: 'acid', acid: true, status: 'acidBurn', x: m.x, y: m.y, r: 18, t: 5 * TICK_HZ, src: m.id }); }
  }
  if (d.special === 'enrage' && m.hp < m.maxHp / 2) m.enraged = true;
  if (m.carrying?.weapon && s.tick - m.stoleAt > 10 * TICK_HZ) { m.gone = true; m.escaped = true; s.events.push({ type: 'escaped', uid: m.uid }); return; }
  if (d.kind !== 'ranged' && !m.flee && dist < 30) sp = 0;
  m.x = clampX(m.x + tx * sp * DT + m.kx); m.y = clampY(m.y + ty * sp * DT + m.ky); m.kx *= 0.8; m.ky *= 0.8;
  if (Math.abs(dx) > 2) m.face = (m.flee ? tx : dx) > 0 ? 1 : -1;
  // 몸이 닿으면 공격(몬스터마다 1초에 한 번, 칸이 진행될수록 빨라짐)
  if (d.kind !== 'ranged' || d.gas) {
    m.touchCd = (m.touchCd ?? 0) - DT;
    if (dist < 30 + monRadius(m) * 0.5 && m.stun <= 0 && m.touchCd <= 0 && (m.atk > 0 || d.inflicts)) { m.touchCd = 1 / s.diff.atkSpeedMul; contact(s, m); }
  }
}

function bossAI(s, m, rng) {
  const p = s.player, B = BOSSES[m.line], dx = p.x - m.x, dy = p.y - m.y, dist = Math.hypot(dx, dy) || 1;
  let sp = m.stun > 0 ? 0 : m.speed * (m.slowT > 0 ? 1 - (m.slowPct || 0.5) : 1);
  m.atkCd -= DT;
  if (m.dash > 0) {
    m.dash -= DT; m.x = clampX(m.x + Math.cos(m.dashA) * m.speed * 4 * DT); m.y = clampY(m.y + Math.sin(m.dashA) * m.speed * 4 * DT);
    if (dist < m.r + 16) damagePlayer(s, m.atk, { melee: true, mon: m });
    if (m.dash <= 0 && m.chargesLeft > 0) { m.chargesLeft--; m.dash = 0.6; m.dashA = Math.atan2(p.y - m.y, p.x - m.x); }
    else if (m.dash <= 0) s.events.push({ type: 'boom', x: m.x, y: m.y, r: 60, boss: true });
    return;
  }
  if (m.atkT > 0) {
    m.atkT--; sp = 0;
    if (!m.acted && m.atkT <= 7) { m.acted = true; bossAct(s, m, B, rng); }
  } else if (m.atkCd <= 0 && dist < 340 && m.stun <= 0) { m.atkT = 15; m.acted = false; m.atkCd = 2.6 + rng.range(0, 0.8); }
  if (dist < m.r + 20) sp = 0;
  m.x = clampX(m.x + (dx / dist) * sp * DT + m.kx); m.y = clampY(m.y + (dy / dist) * sp * DT + m.ky); m.kx *= 0.8; m.ky *= 0.8;
  if (Math.abs(dx) > 2) m.face = dx > 0 ? 1 : -1;
  m.touchCd = (m.touchCd ?? 0) - DT;
  if (dist < m.r + 14 && m.touchCd <= 0) { m.touchCd = 1.2; damagePlayer(s, Math.max(1, m.atk - 1), { melee: true, mon: m }); }
  // 9호선 약탈자 두목: 체력 2/3, 1/3에서 폭염·침수·한파 중 하나를 절반 세기로 불러온다
  if (B.phases) { const ph = m.hp < m.maxHp / 3 ? 2 : m.hp < m.maxHp * 2 / 3 ? 1 : 0;
    if (ph > m.phase) { m.phase = ph; s.env = { status: rng.pick(['heatstroke', 'wet', 'frostbite']), strength: 0.5 }; s.events.push({ type: 'phase', status: s.env.status }); } }
  // 거대 시궁쥐 왕: 25%마다 쥐 4마리
  if (B.act === 'cloud') splitCheck(s, m, 'rat');
}

function bossAct(s, m, B, rng) {
  const p = s.player, dist = Math.hypot(p.x - m.x, p.y - m.y);
  const guarded = B.needGear.some(g => Object.values(p.gear).includes(g));
  s.events.push({ type: 'bossAct', act: B.act, uid: m.uid });
  switch (B.act) {
    case 'charge': m.dash = 0.6; m.dashA = Math.atan2(p.y - m.y, p.x - m.x); m.chargesLeft = (B.chargeCount || 1) - 1 - (s.solved && B.chargeCount > 1 ? 1 : 0); break;
    case 'spread': for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; s.eshots.push({ x: m.x, y: m.y - 30, vx: Math.cos(a) * 150, vy: Math.sin(a) * 150, life: 75, dmg: 1, col: '#c8c070', src: m.id }); }
      if (!guarded) addZone(s, { kind: 'electric', status: 'shock', x: m.x, y: m.y, r: 60, t: 2 * TICK_HZ, src: m.id }); break;
    case 'bite': if (dist < 110) { damagePlayer(s, m.atk, { melee: true, mon: m }); if (!s.solved) inflict(s, 'wet', { source: m.id }); } break;
    case 'spawn': for (let i = 0; i < 3; i++) spawnMon(s, 'fireant', m.x + rng.range(-60, 60), m.y + rng.range(-40, 40));
      if (!s.solved) addZone(s, { kind: 'acid', acid: true, status: 'acidBurn', x: p.x, y: p.y, r: 40, t: 5 * TICK_HZ, src: m.id }); break;
    case 'cloud': if (!s.solved) addZone(s, { kind: 'cloud', status: 'infection', perSec: 20, x: m.x + m.face * 50, y: m.y, r: 60, t: 4 * TICK_HZ, src: m.id }); break;
    case 'smash': { const x = m.x + m.face * 40; s.events.push({ type: 'boom', x, y: m.y, r: 70, boss: true }); if (Math.hypot(p.x - x, p.y - m.y) < 80) damagePlayer(s, m.atk, { melee: true, mon: m });
      addZone(s, { kind: 'ice', status: 'slip', x, y: m.y, r: 60, t: 4 * TICK_HZ, src: m.id }); break; }
    case 'tongue': if (dist < 240) { const k = 70 / (dist || 1); p.x -= (p.x - m.x) * k; p.y = clampY(p.y - (p.y - m.y) * k * 0.5); damagePlayer(s, m.atk, { mon: m }); inflict(s, 'wet', { source: m.id }); } break;
    case 'rifle': m.burst = 3; m.burstT = 0; break;
  }
}

function splitCheck(s, m, into) {
  const lost = 1 - m.hp / m.maxHp, n = Math.min(3, Math.floor(lost / 0.25));
  while (m.splitDone < n) { m.splitDone++; for (let i = 0; i < 4; i++) spawnMon(s, into, m.x + (i - 1.5) * 20, m.y + 12); s.events.push({ type: 'split', uid: m.uid }); }
}

function onDeath(s, m, rng) {
  const d = MONSTERS[m.id];
  if (m.carrying?.weapon) { s.player.weapons.push(m.carrying.weapon); s.events.push({ type: 'returned' }); }
  if (m.carrying?.parts) s.gained.parts += m.carrying.parts;
  if (d?.special === 'deathCloud') addZone(s, { kind: 'cloud', status: 'infection', perSec: 20, x: m.x, y: m.y, r: 56, t: 4 * TICK_HZ, src: m.id });
  if (m.boss) return;
  // 특수 몬스터는 부품 2개와 재료 1개, 일반 몬스터는 25% 확률로 재료 1개
  if (m.elite) { s.gained.parts += 2; give(s, rng.pick(MATS)); }
  else if (rng.chance(0.25)) give(s, rng.pick(MATS));
}
function give(s, mat) { s.gained.materials[mat] = (s.gained.materials[mat] || 0) + 1; s.events.push({ type: 'drop', material: mat }); }

// 구름·웅덩이·전기 바닥 같은 자리 효과
function updateZones(s) {
  const p = s.player;
  for (const z of s.zones) {
    z.t--;
    const inP = Math.hypot(p.x - z.x, p.y - z.y) < z.r;
    if (z.friendly) {
      if (inP && z.kind === 'disinfect') p.meters.infection = Math.max(0, p.meters.infection - 10 * DT);
      for (const m of s.mons) if (!m.gone && Math.hypot(m.x - z.x, m.y - z.y) < z.r + monRadius(m)) damageMon(s, m, z.dps * DT);
    } else if (inP) {
      z.tickN = (z.tickN || 0) + 1;
      if (z.status === 'infection') inflict(s, 'infection', { amount: (z.perSec || 10) * DT, source: z.src, quiet: true });
      else if (z.tickN % 15 === 1) inflict(s, z.status, { source: z.src });
      if (z.dps && z.tickN % TICK_HZ === 1) damagePlayer(s, z.dps, { kind: z.kind });
    }
  }
  s.zones = s.zones.filter(z => z.t > 0);
}

function updateEnemyShots(s) {
  const p = s.player, c = chest(p);
  const slow = p.forecastT > 0 ? 0.5 : 1;
  for (const e of s.eshots) {
    e.x += e.vx * DT * slow; e.y += e.vy * DT * slow; e.life--;
    if (Math.hypot(e.x - c.x, e.y - c.y) < 14) {
      e.life = 0; damagePlayer(s, e.dmg, { mon: { id: e.src }, electric: e.electric });
      if (e.inflicts) inflict(s, e.inflicts, { source: e.src });
      if (e.electric && p.status.wet) inflict(s, 'shock', { source: e.src });
    }
    if (e.life <= 0 && e.puddle) addZone(s, { kind: 'puddle', status: e.puddle, x: e.x, y: Math.max(Y0, e.y), r: 20, t: 6 * TICK_HZ, src: e.src });
  }
  s.eshots = s.eshots.filter(e => e.life > 0 && e.x > 0 && e.x < CAR_W && e.y > 60 && e.y < 330);
}

export function updateMons(s, rng) {
  const vinesSlow = s.player.forecastT > 0 ? 0.5 : 1;
  for (const m of s.mons) {
    if (m.dummy || m.gone) continue;
    if (m.hp <= 0) { m.gone = true; continue; }
    m.t += DT; m.flash = Math.max(0, m.flash - DT); m.stun = Math.max(0, m.stun - DT); m.slowT = Math.max(0, m.slowT - DT); m.shieldOff = Math.max(0, (m.shieldOff || 0) - DT);
    if (vinesSlow < 1) { m.slowT = Math.max(m.slowT, DT); m.slowPct = Math.max(m.slowPct, 0.5); }
    if (m.boss) {
      bossAI(s, m, rng);
      if (m.burst > 0 && --m.burstT <= 0) { m.burst--; m.burstT = 4; s.eshots.push((() => { const b = monCenter(m), c = chest(s.player), a = Math.atan2(c.y - b.y, c.x - b.x) + rng.range(-0.1, 0.1);
        return { x: b.x + m.face * 26, y: b.y, vx: Math.cos(a) * 260, vy: Math.sin(a) * 260, life: 60, dmg: 1, col: '#ffd04a', src: m.id }; })()); }
    } else {
      normalAI(s, m, rng);
      const d = MONSTERS[m.id];
      if (d?.special === 'split') splitCheck(s, m, 'rat');
      if (d?.special === 'scatter' && !m.scattered && m.hp <= m.maxHp / 2) { m.scattered = true; for (let i = 0; i < 3; i++) spawnMon(s, 'mosquito', m.x + (i - 1) * 30, m.y); }
    }
  }
  // 새끼 멧돼지를 공격하면 엄마 멧돼지가 더 빨리 돌진한다
  for (const e of s.events) if (e.type === 'hit') { const m = s.mons.find(x => x.uid === e.uid); if (m?.mother) { const mo = s.mons.find(x => x.uid === m.mother); if (mo) mo.enraged = true; } }
  updateEnemyShots(s);
  updateZones(s);
  for (const m of s.mons) if (m.gone && !m.handled) { m.handled = true; if (!m.escaped) onDeath(s, m, rng); }
  s.mons = s.mons.filter(m => !m.gone);
  // 8호선: 웨이브가 끝나면 거대 황소개구리
  if (s.bossPending && s.waveIndex >= s.waves.length && !s.mons.some(m => !m.gone)) { s.bossPending = false; spawnBossBody(s, { ...BOSSES[s.line], line: s.line, hp: s.bossHp }); }
}
