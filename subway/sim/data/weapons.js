// 무기 17종 (설계서 10절). type: gun 쏘기, melee 휘두르기, throw 던지기, beam 줄기(누르고 있는 동안)
// energy: 한 번 쓸 때 드는 에너지(beam은 energyPerSec). extra: ★2·★3에서 바뀌는 값
export const WEAPONS = {
  pipe:        { name: '쇠파이프', type: 'melee', dmg: [5, 7, 9], rate: 1.6, energy: 0, reach: 62, extra: { 2: { reachMul: 1.3 }, 3: { reachMul: 1.3, knockEvery: 3 } } },
  slingshot:   { name: '새총', type: 'gun', dmg: [2, 3, 4], rate: 4, energy: 0, speed: 380, size: 3, extra: { 2: { count: 2 }, 3: { count: 2, bounce: 1 } } },
  crossbow:    { name: '석궁', type: 'gun', dmg: [8, 11, 15], rate: 0.8, energy: 1, speed: 520, size: 2, extra: { 2: { pierce: 2 }, 3: { pierce: 3 } } },
  lime:        { name: '석회 분사기', type: 'gun', dmg: [3, 4, 5], rate: 5, energy: 1, speed: 330, size: 3, life: 0.45, clearsAcid: true, extra: { 2: { lifeMul: 1.3 }, 3: { lifeMul: 1.3, slow: 1 } } },
  limegrenade: { name: '소석회 수류탄', type: 'throw', dmg: [12, 17, 22], rate: 0.5, energy: 5, radius: 46, clearsAcid: true, extra: { 2: { radiusMul: 1.3 }, 3: { radiusMul: 1.3, safeZone: 3 } } },
  sodabomb:    { name: '베이킹소다 폭탄', type: 'throw', dmg: [8, 11, 14], rate: 0.7, energy: 4, radius: 40, slow: 2, extra: { 2: { slow: 3 }, 3: { slow: 3, foamZone: 3 } } },
  coil:        { name: '코일 건', type: 'gun', dmg: [3, 4, 6], rate: 6, energy: 1, speed: 460, size: 3, electric: true, extra: { 2: { chain: 1 }, 3: { chain: 2 } } },
  baton:       { name: '전기 충격봉', type: 'melee', dmg: [6, 8, 11], rate: 1.8, energy: 1, reach: 56, electric: true, stun: 0.5, extra: { 2: { stun: 0.8 }, 3: { stun: 1.2 } } },
  net:         { name: '감전 그물', type: 'gun', dmg: [10, 14, 18], rate: 0.4, energy: 6, speed: 250, size: 7, electric: true, stun: 1, wetDouble: true, extra: { 2: { stun: 1.5 }, 3: { stun: 2 } } },
  co2:         { name: '이산화 탄소 소화기', type: 'beam', dmg: [2, 3, 4], rate: 10, energyPerSec: 10 / 3, len: 95, ang: 0.38, slowPct: 0.3, coolsHeat: true, extra: { 2: { slowPct: 0.4 }, 3: { slowPct: 0.5, angMul: 1.3 } } },
  cool:        { name: '냉각 스프레이', type: 'gun', dmg: [3, 4, 5], rate: 5, energy: 1, speed: 400, size: 3, extra: { 2: { iceTrail: true }, 3: { iceTrail: true, freezeAfter: 3 } } },
  sprayer:     { name: '소독 분무기', type: 'gun', dmg: [3, 4, 6], rate: 5, energy: 1, speed: 420, size: 3, selfDisinfect: 1, extra: { 2: { selfDisinfect: 2 }, 3: { selfDisinfect: 2, clearCloudOnKill: true } } },
  smoke:       { name: '소독 연막탄', type: 'throw', dmg: [5, 7, 9], rate: 0.33, energy: 6, radius: 52, cloud: 3, disinfectZone: true, extra: { 2: { cloud: 4 }, 3: { cloud: 5 } } },
  flash:       { name: '손전등 섬광', type: 'gun', dmg: [4, 5, 7], rate: 2, energy: 1, speed: 520, size: 5, freeze: 0.5, extra: { 2: { freeze: 0.8 }, 3: { freeze: 1, dropsBats: true } } },
  led:         { name: 'LED 탐조등', type: 'beam', dmg: [8, 11, 15], energyPerSec: 4, len: 150, ang: 0.28, lights: true, repels: ['bat', 'roach'], extra: { 2: { lenMul: 1.2 }, 3: { lenMul: 1.2, angMul: 1.4 } } },
  solar:       { name: '태양광 반사판', type: 'beam', dmg: [10, 14, 18], energyPerSec: 0, len: 130, ang: 0.22, undergroundMul: 0.5, extra: { 2: { lenMul: 1.3 }, 3: { lenMul: 1.3, undergroundMul: 0.75 } } },
  water:       { name: '물총', type: 'gun', dmg: [1, 1, 2], rate: 6, energy: 0, speed: 400, size: 3, washesAcid: true, extra: { 2: { knock: true }, 3: { knock: true, pierce: 99 } } },
};
for (const [id, w] of Object.entries(WEAPONS)) w.id = id;
// 별(★)에 맞춘 값 하나를 꺼낸다: 기본값 위에 ★2, ★3의 extra를 차례로 덮어쓴다
export function weaponStat(id, star) {
  const w = WEAPONS[id], out = { ...w, dmg: w.dmg[star - 1] };
  for (let s = 2; s <= star; s++) Object.assign(out, w.extra[s] || {});
  return out;
}
