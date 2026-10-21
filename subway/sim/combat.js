// 전투: 무기 4종류(쏘기·휘두르기·던지기·줄기), 탄, 피해, 방어막, 에너지
import { DT, INPUT, TICK_HZ, CAR_W, Y0 } from './constants.js';
import { WEAPONS, weaponStat } from './data/weapons.js';
import { LINES } from './data/lines.js';

const AIM_RANGE = 340, INVULN_TICKS = 18, REGEN_WAIT = 3 * TICK_HZ, REGEN_EVERY = 45, SWING_TICKS = 8;

export const monRadius = m => m.r || 14;
export const monCenter = m => ({ x: m.x, y: m.y - (m.fly ? 30 : 0) - monRadius(m) });
export const chest = p => ({ x: p.x, y: p.y - 24 });
export const alive = s => s.mons.filter(m => !m.gone);

export function nearestMon(s, range = AIM_RANGE) {
  const c = chest(s.player); let best = null, bd = range;
  for (const m of alive(s)) { const b = monCenter(m), d = Math.hypot(b.x - c.x, b.y - c.y); if (d < bd) { bd = d; best = m; } }
  return best;
}
export function autoAim(s) {
  const p = s.player, t = nearestMon(s);
  if (t) { const b = monCenter(t), c = chest(p); p.aim = Math.atan2(b.y - c.y, b.x - c.x); }
  else if (p.moving) p.aim = Math.atan2(p.vy, p.vx);
  p.face = Math.cos(p.aim) >= 0 ? 1 : -1;
  return p.aim;
}
const muzzle = p => ({ x: p.x + Math.cos(p.aim) * 16, y: p.y - 24 + Math.sin(p.aim) * 16 });
function angDiff(a, b) { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }

// 같은 무기를 또 주우면 별이 오른다(최대 ★3). 새 무기는 3칸까지, 꽉 차면 지금 든 무기와 바꾼다
export function gainWeapon(p, id) {
  const own = p.weapons.find(w => w.id === id);
  if (own) { own.star = Math.min(3, own.star + 1); return own; }
  const w = { id, star: 1 };
  if (p.weapons.length < 3) p.weapons.push(w); else p.weapons[p.weapon] = w;
  return w;
}

export function damagePlayer(s, amount, src = {}) {
  const p = s.player;
  p.sinceHit = 0; p.regen = 0;
  if (amount <= 0 || s.done) return 0;
  if (p.invuln > 0) return 0;
  let a = amount;
  if (src.melee && p.gear.body === 'armorVest') { a = Math.max(1, a - 1); gearBlocked(s, 'armorVest', 'melee'); }
  if (src.electric && p.status.wet) a *= 2;
  // 감염·동상은 설계서대로 "체력"이 줄어든다(방어막을 건너뜀)
  const fromShield = src.direct ? 0 : Math.min(p.shield, a); p.shield -= fromShield; a -= fromShield;
  p.hp = Math.max(0, p.hp - a); p.invuln = INVULN_TICKS;
  s.events.push({ type: 'hurt', amount, src: src.mon?.id || src.kind || '' });
  if (p.hp <= 0) { s.done = 'dead'; s.events.push({ type: 'dead' }); }
  return amount;
}
export function gearBlocked(s, gear, status) {
  s.events.push({ type: 'gearBlocked', gear, status });
  if (!s.codex.gear.includes(gear)) s.codex.gear.push(gear);
}

export function damageMon(s, m, amount, from = {}) {
  if (m.gone) return;
  let a = amount;
  if (from.electric && s.player.relics.includes('magnet')) a *= 1.2;
  if (m.frontShield && m.shieldOff <= 0 && from.dirX !== undefined && Math.sign(from.dirX) === -m.face) a *= 0.1;
  if (from.wetDouble && m.inWater) a *= 2;
  m.hp -= a; m.flash = 0.08; s.stats.hits++;
  if (from.kx) { m.kx += from.kx * (m.boss ? 0.15 : 1); m.ky += (from.ky || 0) * (m.boss ? 0.15 : 1); }
  if (from.stun) { m.stun = Math.max(m.stun, from.stun); if (m.frontShield) m.shieldOff = 3; }
  if (from.slow) { m.slowT = Math.max(m.slowT, from.slow); m.slowPct = Math.max(m.slowPct || 0, from.slowPct || 0.5); }
  s.events.push({ type: 'hit', uid: m.uid, amount: a, weapon: from.weapon || '' });
  if (m.hp <= 0 && !m.dummy) { m.gone = true; s.stats.kills++; s.events.push({ type: 'kill', uid: m.uid, id: m.id, x: m.x, y: m.y }); }
}

function currentWeapon(p) {
  const w = p.weapons[p.weapon] || p.weapons[0];
  let st = weaponStat(w.id, w.star);
  if (st.type !== 'beam' && p.energy < (st.energy || 0)) { const sl = p.weapons.find(x => x.id === 'slingshot'); st = weaponStat('slingshot', sl ? sl.star : 1); }
  return st;
}

export function fire(s, rng) {
  const p = s.player;
  let st = currentWeapon(p);
  if (st.type === 'beam') {
    const cost = (st.energyPerSec || 0) * DT;
    if (p.energy < cost) st = weaponStat('slingshot', 1);
    else { p.energy -= cost; p.beam = st.id; beamTick(s, st); return; }
  }
  if (p.cool > 0) return;
  const fear = p.status.fear ? 2 : 1;
  p.cool = Math.max(1, Math.round(TICK_HZ / st.rate * fear));
  p.energy -= st.energy || 0;
  if (st.selfDisinfect) p.meters.infection = Math.max(0, p.meters.infection - st.selfDisinfect);
  const m = muzzle(p);
  if (st.type === 'melee') { p.swing = SWING_TICKS; p.swingStat = st.id; p.swingStar = (p.weapons[p.weapon] || {}).star || 1; p.swingCount = (p.swingCount || 0) + 1; return; }
  if (st.type === 'throw') {
    const t = alive(s).length ? s.mons.find(x => x === nearestMonWithin(s, 260)) : null;
    const tx = t ? t.x : p.x + Math.cos(p.aim) * 150, ty = t ? t.y : p.y + Math.sin(p.aim) * 150;
    s.shots.push({ th: true, weapon: st.id, sx: m.x, sy: m.y, x: m.x, y: m.y, tx, ty: Math.max(Y0, ty), t: 0, T: Math.round(0.55 * TICK_HZ), dmg: st.dmg, radius: st.radius * (st.radiusMul || 1) });
    p.recoil = 3; return;
  }
  const n = st.count || 1;
  for (let i = 0; i < n; i++) {
    const a = p.aim + (n > 1 ? (i - (n - 1) / 2) * 0.12 : 0) + rng.range(-0.03, 0.03);
    s.shots.push({ weapon: st.id, x: m.x, y: m.y, vx: Math.cos(a) * st.speed, vy: Math.sin(a) * st.speed, life: Math.round((st.life || 0.9) * (st.lifeMul || 1) * TICK_HZ),
      dmg: st.dmg, size: st.size || 3, pierce: st.pierce || 1, hit: [], electric: !!st.electric, stun: st.stun || st.freeze || 0, slow: st.slow || 0, bounce: st.bounce || 0, wetDouble: !!st.wetDouble, knock: !!st.knock, chain: st.chain || 0 });
  }
  p.recoil = 4; p.flash = 2;
}
function nearestMonWithin(s, r) { return nearestMon(s, r); }

function beamTick(s, st) {
  const p = s.player, m = muzzle(p);
  const len = st.len * (st.lenMul || 1), ang = st.ang * (st.angMul || 1);
  let dps = st.rate ? st.dmg * st.rate : st.dmg;
  if (st.undergroundMul && !LINES[s.line].above) dps *= st.undergroundMul;
  for (const mo of alive(s)) {
    const b = monCenter(mo), d = Math.hypot(b.x - m.x, b.y - m.y), a = Math.atan2(b.y - m.y, b.x - m.x);
    if (d < len + monRadius(mo) && Math.abs(angDiff(a, p.aim)) < ang + 0.1) {
      damageMon(s, mo, dps * DT, { slow: st.slowPct ? 0.3 : 0, slowPct: st.slowPct });
    }
  }
  if (st.coolsHeat) p.meters.heat = Math.max(0, p.meters.heat - 20 * DT);
}

function resolveSwing(s) {
  const p = s.player, st = weaponStat(p.swingStat, p.swingStar), reach = st.reach * (st.reachMul || 1), c = chest(p);
  for (const m of alive(s)) {
    const b = monCenter(m), d = Math.hypot(b.x - c.x, b.y - c.y), a = Math.atan2(b.y - c.y, b.x - c.x);
    if (d < reach + monRadius(m) && Math.abs(angDiff(a, p.aim)) < 1.4) {
      const knock = st.knockEvery && p.swingCount % st.knockEvery === 0 ? 14 : 6;
      damageMon(s, m, st.dmg, { weapon: st.id, kx: Math.cos(a) * knock, ky: Math.sin(a) * knock, stun: st.stun || 0, electric: !!st.electric, dirX: Math.cos(a) });
    }
  }
}

export function updateShots(s) {
  for (const sh of s.shots) {
    if (sh.th) {
      sh.t++; const k = Math.min(1, sh.t / sh.T); sh.x = sh.sx + (sh.tx - sh.sx) * k; sh.y = sh.sy + (sh.ty - sh.sy) * k;
      if (k >= 1) {
        sh.dead = true; s.events.push({ type: 'boom', x: sh.tx, y: sh.ty, r: sh.radius, weapon: sh.weapon });
        const st = weaponStat(sh.weapon, 1);
        for (const m of alive(s)) if (Math.hypot(m.x - sh.tx, m.y - sh.ty) < sh.radius + monRadius(m))
          damageMon(s, m, sh.dmg, { weapon: sh.weapon, kx: (m.x - sh.tx) * 0.1, ky: (m.y - sh.ty) * 0.1, slow: st.slow || 0 });
        if (st.clearsAcid) s.zones = s.zones.filter(z => !(z.acid && Math.hypot(z.x - sh.tx, z.y - sh.ty) < sh.radius + z.r));
        if (st.cloud) s.zones.push({ kind: 'disinfect', x: sh.tx, y: sh.ty, r: sh.radius, t: Math.round(st.cloud * TICK_HZ), dps: sh.dmg, friendly: true });
      }
      continue;
    }
    sh.x += sh.vx * DT; sh.y += sh.vy * DT; sh.life--;
    for (const m of alive(s)) {
      if (sh.hit.includes(m.uid)) continue;
      const b = monCenter(m);
      if (Math.hypot(sh.x - b.x, sh.y - b.y) < monRadius(m) + sh.size) {
        sh.hit.push(m.uid);
        damageMon(s, m, sh.dmg, { weapon: sh.weapon, kx: sh.vx * 0.012 * (sh.knock ? 3 : 1), ky: sh.vy * 0.012 * (sh.knock ? 3 : 1), stun: sh.stun, electric: sh.electric, wetDouble: sh.wetDouble, dirX: sh.vx, slow: sh.slow });
        if (--sh.pierce <= 0) { sh.dead = true; break; }
      }
    }
    if (sh.y < Y0 - 40 || sh.y > 320 || sh.x < 0 || sh.x > CAR_W) { if (sh.bounce > 0 && sh.y < Y0 - 40) { sh.vy = -sh.vy; sh.bounce--; } else sh.dead = true; }
    if (sh.life <= 0) sh.dead = true;
  }
  s.shots = s.shots.filter(x => !x.dead);
}

// 매 틱: 조준, 공격 입력, 무기 바꾸기, 방어막·에너지 회복
export function updatePlayerCombat(s, input, rng) {
  const p = s.player;
  p.beam = false; p.flash = Math.max(0, (p.flash || 0) - 1); p.recoil = Math.max(0, p.recoil - 1);
  if (p.cool > 0) p.cool--; if (p.invuln > 0) p.invuln--;
  if (input & INPUT.SWAP) { if (!p.swapHeld && p.weapons.length > 1) p.weapon = (p.weapon + 1) % p.weapons.length; p.swapHeld = true; } else p.swapHeld = false;
  if (p.swing <= 0) autoAim(s);
  const attacking = !!(input & INPUT.ATTACK) && !(p.status.shock);
  if (attacking) fire(s, rng);
  if (p.swing > 0) { p.swing--; if (p.swing === SWING_TICKS / 2) resolveSwing(s); }
  if (!attacking) p.energy = Math.min(p.maxEnergy, p.energy + 2 * DT * (p.relics.includes('solarPanel') ? 2 : 1));
  p.sinceHit++;
  const regenBlocked = p.meters.heat >= 100;
  if (p.sinceHit > REGEN_WAIT && p.shield < p.maxShield && !regenBlocked) { p.regen++; if (p.regen >= REGEN_EVERY) { p.shield++; p.regen = 0; } }
}
export { WEAPONS };
