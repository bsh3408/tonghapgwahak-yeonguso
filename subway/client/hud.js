// 화면 위 정보(체력·방어막·에너지, 상태 이상, 지금 노선·무기·스킬·소모품)와 아래 안내 한 줄
import { STATUS } from '../sim/data/status.js';
import { WEAPONS } from '../sim/data/weapons.js';
import { JOBS } from '../sim/data/jobs.js';
import { GEAR } from '../sim/data/gear.js';
import { CONSUMABLES } from '../sim/data/consumables.js';
import { LINES } from '../sim/data/lines.js';
import { TICK_HZ } from '../sim/constants.js';

const $ = id => document.getElementById(id);
const josa = (w, a, b) => { const c = w.charCodeAt(w.length - 1); return w + (c >= 0xac00 && c <= 0xd7a3 && (c - 0xac00) % 28 > 0 ? a : b); };
const tipQ = []; let tipT = 0; const evQ = [];
// 틱마다 사건을 모아 둔다(한 프레임에 여러 틱이 돌아도 안내를 놓치지 않게)
export function pushEvents(evs) { evQ.push(...evs); }

export function showTip(text, sec = 5) { tipQ.push({ text, sec }); }
export function setHud(on) { $('hud').hidden = !on; if (!on) $('tip').classList.remove('on'); }

function bar(id, v, max, label) { const el = $(id); el.querySelector('i').style.width = (max ? Math.max(0, v / max * 100) : 0) + '%'; el.querySelector('span').textContent = label; }

export function updateHud(s, run, dt) {
  if (!s) return;
  const p = s.player;
  bar('hpBar', p.hp, p.maxHp, `체력 ${p.hp}/${p.maxHp}`);
  bar('shBar', p.shield, Math.max(1, p.maxShield), `방어막 ${p.shield}/${p.maxShield}`);
  bar('enBar', p.energy, p.maxEnergy, `에너지 ${Math.floor(p.energy)}/${p.maxEnergy}`);
  const chips = [];
  for (const [id, v] of Object.entries(p.status)) chips.push(`${STATUS[id].icon} ${STATUS[id].name} ${Math.ceil(v.t / TICK_HZ)}초`);
  if (p.meters.infection > 0) chips.push(`🦠 감염 ${Math.floor(p.meters.infection)}`);
  if (p.meters.heat > 0) chips.push(`🥵 열 ${Math.floor(p.meters.heat)}`);
  $('statusChips').innerHTML = chips.map(c => `<span class="chip">${c}</span>`).join('');
  const L = LINES[s.line], where = s.carType === 'boss' ? `${L.name} 개찰구` : `${L.name} ${s.carIndex + 1}칸`;
  $('where').textContent = `${where} · 노선 ${run.lineIndex + 1}/9`;
  const w = p.weapons[p.weapon] || p.weapons[0];
  $('weaponChip').textContent = `${WEAPONS[w.id].name} ★${w.star}${p.weapons.length > 1 ? ' (Q 바꾸기)' : ''}`;
  const sk = JOBS[p.jobId].skill;
  $('skillChip').textContent = p.skillCd > 0 ? `${sk.name} ${Math.ceil(p.skillCd / TICK_HZ)}초` : `${sk.name} 준비 (K)`;
  $('itemChip').textContent = p.items.length ? `소모품: ${p.items.map(i => CONSUMABLES[i].name).join(', ')} (E)` : '소모품 없음';
  // 사건 안내
  for (const e of evQ.splice(0)) {
    if (e.type === 'firstStatus') { const S = STATUS[e.status]; showTip(`${S.icon} ${S.name}: ${S.effect}<br><small>${S.reason}</small>`, 7); }
    else if (e.type === 'gearBlocked' && GEAR[e.gear]) showTip(`🛡️ ${josa(GEAR[e.gear].name, '이', '가')} ${josa(e.status === 'melee' ? '근접 피해' : STATUS[e.status]?.name || '', '을', '를')} 막았다! 도감에 기록했다`, 3);
    else if (e.type === 'door') showTip('🚪 연결문이 열렸다. 오른쪽 끝으로 가자', 3);
    else if (e.type === 'returned') showTip('🎒 빼앗긴 무기를 되찾았다', 3);
    else if (e.type === 'escaped') showTip('🦝 도둑 너구리가 무기를 가지고 달아났다', 3);
    else if (e.type === 'phase') showTip(`🌏 약탈자 두목이 ${STATUS[e.status].name} 재난을 불러왔다`, 3);
  }
  tipT -= dt;
  if (tipT <= 0) { const n = tipQ.shift(); if (n) { $('tip').innerHTML = n.text; $('tip').classList.add('on'); tipT = n.sec; } else $('tip').classList.remove('on'); }
}
