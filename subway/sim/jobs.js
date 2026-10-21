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
function allyShot(s, a, dmg, speed, electric, zap = false) {
  const t = nearestTo(s, a.x, a.y, 320); if (!t) return;
  const b = monCenter(t), ang = Math.atan2(b.y - a.y, b.x - a.x);
  s.shots.push({ weapon: a.kind === 'turret' ? 'coil' : 'flash', ally: true, x: a.x, y: a.y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, life: 27, dmg, size: 3, pierce: 1, hit: [], electric, stun: electric ? 0.3 : 0, slow: 0, bounce: 0, zap });
}

export function useSkill(s) {
  const p = s.player, J = JOBS[p.jobId], sk = J.skill.id;
  if (p.skillCd > 0) return false;
  p.skillCd = sec(J.skill.cooldown);
  s.events.push({ type: 'skill', skill: sk });
  switch (sk) {
    // 의사: 백신 주사(면역) + 소독 구역
    case 'firstAid': p.hp = Math.min(p.maxHp, p.hp + 3); p.status = {}; p.meters.infection = 0; p.meters.heat = 0; p.immuneT = sec(5);
      s.zones.push({ kind: 'disinfect', x: p.x, y: p.y, r: 90, t: sec(5), dps: 8, friendly: true }); break;
    // 전기공학자: 연쇄 번개 터렛 2대
    case 'coilTurret': for (const dx of [-34, 34]) s.allies.push({ kind: 'turret', x: p.x + dx, y: p.y - 20, t: sec(10), cd: 0 }); break;
    // 기후학자: 극한 한파. 모두 얼리고 적 탄을 지운 뒤 느리게
    case 'forecast': p.forecastT = sec(6); s.eshots = [];
      for (const m of alive(s)) { m.stun = Math.max(m.stun, m.boss ? 1.2 : 2.5); s.events.push({ type: 'freeze', uid: m.uid }); }
      s.events.push({ type: 'blizzard' }); break;
    // 화학자: 큰 중화 폭발. 산성·위험 바닥까지 중화
    case 'neutralBomb': {
      const c = chest(p);
      for (const m of alive(s)) { const b = monCenter(m); if (Math.hypot(b.x - c.x, b.y - c.y) < 120) damageMon(s, m, 35, { kx: Math.sign(b.x - c.x) * 14, ky: Math.sign(b.y - c.y) * 6 }); }
      s.zones = s.zones.filter(z => !((z.acid || z.src === 'env') && Math.hypot(z.x - p.x, z.y - p.y) < 120 + z.r));
      s.props = s.props.filter(o => !(o.hazard && Math.hypot(o.x - p.x, o.y - p.y) < 120 + o.r));
      s.events.push({ type: 'boom', x: p.x, y: p.y, r: 120, skill: true }); break;
    }
    // 생태학자: 덩굴 숲. 묶고, 덩굴이 계속 조이고, 숲의 기운으로 체력 1
    case 'vines': for (const m of alive(s)) if (Math.hypot(m.x - p.x, m.y - p.y) < 160) { m.stun = Math.max(m.stun, m.boss ? 1.5 : 5); m.rooted = sec(5); }
      s.zones.push({ kind: 'vines', x: p.x, y: p.y, r: 160, t: sec(5), dps: 6, friendly: true }); p.hp = Math.min(p.maxHp, p.hp + 1); break;
    // AI 연구원: 드론 편대 3대 + 약점 분석(적이 받는 피해 +30%)
    case 'droneBuddy': for (let i = 0; i < 3; i++) s.allies.push({ kind: 'drone', slot: i, x: p.x - 20, y: p.y - 50, t: sec(12), cd: i * 4 }); p.markT = sec(6); break;
  }
  return true;
}

export function updateJobs(s, input) {
  const p = s.player;
  if (p.skillCd > 0) p.skillCd--;
  if (p.forecastT > 0) p.forecastT--;
  if (p.immuneT > 0) p.immuneT--;
  if (p.markT > 0) p.markT--;
  if (input & INPUT.SKILL) { if (!p.skillHeld) useSkill(s); p.skillHeld = true; } else p.skillHeld = false;
  for (const a of s.allies) {
    a.t--; a.cd--;
    if (a.kind === 'drone') { const ox = [-26, 0, 26][a.slot || 0], oy = [-44, -60, -44][a.slot || 0];
      a.x += ((p.x + ox * p.face) - a.x) * 0.1; a.y += ((p.y + oy) - a.y) * 0.1; if (a.cd <= 0) { allyShot(s, a, 4, 420, false); a.cd = sec(0.4); } }
    else if (a.cd <= 0) { allyShot(s, a, 4, 460, true, true); a.cd = sec(0.3); }
  }
  s.allies = s.allies.filter(a => a.t > 0);
}
export { DT };
