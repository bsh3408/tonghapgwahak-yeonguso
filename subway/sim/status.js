// 상태 이상·방비·소모품·노선 환경 (설계서 7절, 6-1절)
// 몬스터와 환경은 inflict()로 s.pending에 넣고, 여기서 장비·직업 특성을 따져 실제로 건다
import { TICK_HZ, DT, INPUT } from './constants.js';
import { STATUS } from './data/status.js';
import { GEAR } from './data/gear.js';
import { JOBS } from './data/jobs.js';
import { CONSUMABLES } from './data/consumables.js';
import { damagePlayer, gearBlocked } from './combat.js';

const TRAIT_FACTOR = {
  shockImmune: { shock: 0 }, acidImmune: { acidBurn: 0, corrosion: 0 }, poisonImmune: { poison: 0 },
  weatherHalf: { heatstroke: 0.5, frostbite: 0.5, wet: 0.5 }, infectionHalf: { infection: 0.5 },
};

// 남는 비율(0이면 완전히 막힘)과, 막아 준 장비 이름
export function gearFactor(p, id, source = '') {
  let f = 1, by = null;
  for (const t of JOBS[p.jobId].traits) { const v = TRAIT_FACTOR[t]?.[id]; if (v !== undefined) f *= v; }
  if (id === 'infection' && p.relics.includes('vaccine')) f *= 0.5;
  if (f === 0) return { f, by: null };
  for (const g of Object.values(p.gear)) {
    if (!g) continue;
    const G = GEAR[g];
    let v = G.blocks[id];
    if (G.sources && source in G.sources && (id === 'infection' || id === 'poison')) v = G.sources[source];
    if (v !== undefined && v < 1) { f *= v; by = g; }
  }
  return { f, by };
}

export function applyStatus(s, id, opts = {}) {
  const p = s.player, S = STATUS[id];
  if (!S || s.done) return false;
  if (p.immuneT > 0 && id !== 'stolen') return false;   // 의사 백신 주사: 잠깐 상태 이상 면역
  const { f, by } = gearFactor(p, id, opts.source);
  const strength = opts.strength ?? 1;
  if (f === 0) { if (by) gearBlocked(s, by, id); return false; }
  if (by) gearBlocked(s, by, id);
  if (!s.seen.includes(id) && id !== 'stolen') {
    s.seen.push(id); s.codex.status.push(id);
    s.events.push({ type: 'firstStatus', status: id, reason: S.reason, gear: S.gear });
  }
  const dur = t => Math.round(t * s.diff.statusDurMul * TICK_HZ * (f < 1 && id !== 'infection' ? f : 1) * strength);
  switch (id) {
    case 'infection': p.meters.infection = Math.min(150, p.meters.infection + (opts.amount ?? 10) * f * strength); break;
    case 'heatstroke': p.meters.heat = Math.min(100, p.meters.heat + (opts.amount ?? 10) * f * strength); break;
    case 'corrosion': p.maxShield = Math.max(0, p.maxShield - 1); p.shield = Math.min(p.shield, p.maxShield); break;
    case 'stolen': break;
    // 감전 기절은 걸려 있는 동안 다시 걸리지 않고, 풀린 뒤 2초는 걸리지 않는다(감전 웅덩이에 갇혀 계속 기절하던 문제)
    case 'shock': { if (p.status.shock || s.tick < (p.shockFreeUntil || 0)) return false; const t = dur(S.dur); p.status.shock = { t, k: 0 }; p.shockFreeUntil = s.tick + t + 2 * TICK_HZ; break; }
    case 'poison': p.status.poison = { t: dur(S.dur), variant: opts.variant || 'viper', bite: opts.variant === 'wasp' ? 0 : 2 * TICK_HZ }; break;
    default: { const t = dur(S.dur); const cur = p.status[id]; p.status[id] = { t: Math.max(t, cur?.t || 0), k: 0 }; }
  }
  s.events.push({ type: 'status', status: id });
  return true;
}

export function cure(s, itemId) {
  const p = s.player, i = p.items.indexOf(itemId);
  if (i < 0) return false;
  const C = CONSUMABLES[itemId];
  p.items.splice(i, 1);
  for (const st of C.cures) delete p.status[st];
  if (C.infectionMinus) p.meters.infection = Math.max(0, p.meters.infection - C.infectionMinus);
  if (C.heatMinus) p.meters.heat = Math.max(0, p.meters.heat - C.heatMinus);
  if (C.suppress) p.frostFree = C.suppress * TICK_HZ;
  if (C.restoreShield) p.maxShield = p.baseShield ?? p.maxShield;
  s.events.push({ type: 'cure', item: itemId });
  return true;
}

// 소모품 키: 지금 걸린 상태를 고칠 수 있는 소모품을 먼저, 없으면 첫 번째 소모품
function useItem(s, input) {
  const p = s.player;
  if (input & INPUT.ITEM) {
    if (!p.itemHeld && p.items.length) {
      const active = id => (p.status[id] || (id === 'infection' && p.meters.infection >= 50) || (id === 'heatstroke' && p.meters.heat >= 50));
      const pick = p.items.find(it => CONSUMABLES[it].cures.some(active)) || p.items[0];
      cure(s, pick);
    }
    p.itemHeld = true;
  } else p.itemHeld = false;
}

// 노선 환경: 숨겨진 칸을 풀지 않은 칸에서 계속 걸린다
function envTick(s) {
  const e = s.env; if (!e || !e.status) return;
  const k = s.tick, st = e.strength || 1;
  switch (e.status) {
    case 'heatstroke': if (k % 5 === 0) applyStatus(s, 'heatstroke', { amount: 1, strength: st, source: 'env' }); break;
    case 'infection': if (k % TICK_HZ === 0) applyStatus(s, 'infection', { amount: 2, strength: st, source: 'env' }); break;
    case 'wet': if (k % (2 * TICK_HZ) === 0) applyStatus(s, 'wet', { strength: st, source: 'env' }); break;
    case 'corrosion': if (k % (10 * TICK_HZ) === TICK_HZ) applyStatus(s, 'corrosion', { source: 'env' }); break;
    case 'blur': if (k % (6 * TICK_HZ) === TICK_HZ) applyStatus(s, 'blur', { strength: st, source: 'env' }); break;
    case 'frostbite': if (k % (5 * TICK_HZ) === 0 && !(s.player.frostFree > 0)) applyStatus(s, 'frostbite', { strength: st, source: 'env' });
      if (k % (8 * TICK_HZ) === 4 * TICK_HZ) applyStatus(s, 'slip', { source: 'env' }); break;
  }
}

export function statusTick(s, input) {
  const p = s.player;
  for (const e of s.pending || []) applyStatus(s, e.status, e);
  s.pending = [];
  envTick(s);
  useItem(s, input);
  if (p.frostFree > 0) { p.frostFree--; delete p.status.frostbite; }
  for (const [id, v] of Object.entries(p.status)) {
    v.t--; v.k = (v.k || 0) + 1;
    if (id === 'acidBurn' && v.k % TICK_HZ === 0) damagePlayer(s, 1, { kind: 'acidBurn' });
    if (id === 'frostbite' && v.k % (10 * TICK_HZ) === 0) damagePlayer(s, 1, { kind: 'frostbite', direct: true });
    if (id === 'poison' && v.bite > 0 && --v.bite === 0) damagePlayer(s, 1, { kind: 'poison' });
    if (v.t <= 0) delete p.status[id];
  }
  if (p.meters.infection >= 100) { p.infT = (p.infT || 0) + 1; if (p.infT % (2 * TICK_HZ) === 0) damagePlayer(s, 1, { kind: 'infection', direct: true }); } else p.infT = 0;
  if (!(s.env && s.env.status === 'heatstroke')) p.meters.heat = Math.max(0, p.meters.heat - 5 * DT);
}

// 이동 속도 배율과 조작 변화(감전·혼란·미끄러짐)
export function moveRule(s) {
  const p = s.player;
  let mul = 1;
  if (p.status.poison?.variant === 'wasp') mul *= 0.7;
  if (p.meters.heat >= 100) mul *= 0.75;
  if (p.status.frostbite) mul *= 0.8;
  if (s.env?.status === 'wet' && s.line === 3 && p.gear.body !== 'raincoat') mul *= 0.75;
  return { mul, frozen: !!p.status.shock, reverse: !!p.status.confusion, slip: !!p.status.slip };
}
