// 직업 스킬(설계서 9절)과 스킬이 만든 동료(터렛·드론), 유물 효과(설계서 11-3절)
import { INPUT, TICK_HZ, DT } from './constants.js';
import { JOBS } from './data/jobs.js';
import { damageMon, alive, monCenter, chest } from './combat.js';

const sec = n => Math.round(n * TICK_HZ);

export function applyRelics(run) {
  const has = id => run.relics.includes(id);
  if (has('battery')) { run.maxEnergy += 30; run.energy += 30; }
  if (has('medkit')) { run.maxHp += 1; run.hp += 1; }
  if (has('itemPouch')) run.itemSlots += 1;
  run.showGearInfo = has('magnifier');
  run.lit = has('flashGen') || JOBS[run.jobId].traits.includes('darkLit');
  run.showInflict = has('hazardGlasses') || JOBS[run.jobId].traits.includes('showInflict');
  return run;
}

function nearestTo(s, x, y, range) {
  let best = null, bd = range;
  for (const m of alive(s)) { const b = monCenter(m), d = Math.hypot(b.x - x, b.y - y); if (d < bd) { bd = d; best = m; } }
  return best;
}
function allyShot(s, a, dmg, speed, electric) {
  const t = nearestTo(s, a.x, a.y, 320); if (!t) return;
  const b = monCenter(t), ang = Math.atan2(b.y - a.y, b.x - a.x);
  s.shots.push({ weapon: a.kind === 'turret' ? 'coil' : 'flash', ally: true, x: a.x, y: a.y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, life: 27, dmg, size: 3, pierce: 1, hit: [], electric, stun: 0, slow: 0, bounce: 0 });
}

export function useSkill(s) {
  const p = s.player, J = JOBS[p.jobId], sk = J.skill.id;
  if (p.skillCd > 0) return false;
  p.skillCd = sec(J.skill.cooldown);
  s.events.push({ type: 'skill', skill: sk });
  switch (sk) {
    case 'firstAid': p.hp = Math.min(p.maxHp, p.hp + 2); p.status = {}; p.meters.infection = 0; p.meters.heat = 0; break;
    case 'coilTurret': s.allies.push({ kind: 'turret', x: p.x, y: p.y - 20, t: sec(8), cd: 0 }); break;
    case 'forecast': p.forecastT = sec(5); break;
    case 'neutralBomb': {
      const c = chest(p);
      for (const m of alive(s)) { const b = monCenter(m); if (Math.hypot(b.x - c.x, b.y - c.y) < 90) damageMon(s, m, 20, { kx: Math.sign(b.x - c.x) * 8 }); }
      s.zones = s.zones.filter(z => !(z.acid && Math.hypot(z.x - p.x, z.y - p.y) < 90 + z.r));
      s.events.push({ type: 'boom', x: p.x, y: p.y, r: 90, skill: true }); break;
    }
    case 'vines': for (const m of alive(s)) if (Math.hypot(m.x - p.x, m.y - p.y) < 110) { m.stun = Math.max(m.stun, 4); m.rooted = sec(4); } break;
    case 'droneBuddy': s.allies.push({ kind: 'drone', x: p.x - 20, y: p.y - 50, t: sec(15), cd: 0 }); break;
  }
  return true;
}

export function updateJobs(s, input) {
  const p = s.player;
  if (p.skillCd > 0) p.skillCd--;
  if (p.forecastT > 0) p.forecastT--;
  if (input & INPUT.SKILL) { if (!p.skillHeld) useSkill(s); p.skillHeld = true; } else p.skillHeld = false;
  for (const a of s.allies) {
    a.t--; a.cd--;
    if (a.kind === 'drone') { a.x += ((p.x - 24 * p.face) - a.x) * 0.1; a.y += ((p.y - 52) - a.y) * 0.1; if (a.cd <= 0) { allyShot(s, a, 4, 420, false); a.cd = sec(0.5); } }
    else if (a.cd <= 0) { allyShot(s, a, 3, 460, true); a.cd = sec(0.25); }
  }
  s.allies = s.allies.filter(a => a.t > 0);
}
export { DT };
