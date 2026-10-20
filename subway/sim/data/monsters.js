// 몬스터 (설계서 8-1 일반 13, 8-2 원거리 8, 8-3 특수 8, 그리고 엄마 멧돼지의 새끼)
// speed는 설계서 값(느림 30 / 보통 50 / 빠름 75 / 매우 빠름 100), 실제 이동에는 SPEED_SCALE을 곱한다
// lines: 주로 나오는 호선('all'은 전체), inflicts: 맞으면 거는 상태 이상, unguarded: 해당 장비가 없을 때 더 세짐
// range: 원거리 사거리(중간 160 / 김 240 / 짧음 90), sprite: 그림 이름(없으면 id)
const S = 30, N = 50, F = 75, VF = 100;
const RANGE = { mid: 160, long: 240, short: 90 };
export const MONSTERS = {
  // 8-1 일반(근접)
  rat:      { name: '시궁쥐', kind: 'melee', hp: 6, atk: 1, speed: F, swarm: 3, inflicts: { status: 'infection', amount: 10 }, lines: 'all', weight5: 3 },
  roach:    { name: '바퀴벌레', kind: 'melee', hp: 4, atk: 1, speed: VF, swarm: 4, inflicts: { status: 'infection', amount: 5 }, lines: [2, 5] },
  mosquito: { name: '모기', kind: 'melee', hp: 3, atk: 1, speed: F, swarm: 5, fly: true, inflicts: { status: 'infection', amount: 15 }, unguarded: { gear: 'longSleeves', inflictAmount: 25 }, lines: [5, 8] },
  fireant:  { name: '불개미', kind: 'melee', hp: 5, atk: 1, speed: N, swarm: 4, inflicts: { status: 'acidBurn' }, unguarded: { gear: 'thickBoots', atkBonus: 1 }, lines: [4] },
  wasp:     { name: '말벌', kind: 'melee', hp: 10, atk: 2, speed: F, fly: true, special: 'hitAndRun', inflicts: { status: 'poison', variant: 'wasp' }, lines: [1, 8] },
  viper:    { name: '살모사', kind: 'melee', hp: 12, atk: 2, speed: N, special: 'ambush', inflicts: { status: 'poison', variant: 'viper' }, unguarded: { gear: 'thickBoots', atkBonus: 1 }, lines: [6, 8] },
  bat:      { name: '박쥐', kind: 'melee', hp: 5, atk: 1, speed: F, swarm: 3, fly: true, darkOnly: true, inflicts: { status: 'infection', amount: 10 }, lines: [2] },
  dog:      { name: '들개', kind: 'melee', hp: 14, atk: 1, speed: F, swarm: 2, special: 'surround', lines: [1, 6, 7] },
  raccoon:  { name: '너구리', kind: 'melee', hp: 12, atk: 0, speed: F, special: 'steal', inflicts: { status: 'stolen', what: 'part' }, lines: 'all' },
  boar:     { name: '멧돼지', kind: 'melee', hp: 24, atk: 2, speed: N, special: 'charge', lines: [1, 7] },
  nutria:   { name: '뉴트리아', kind: 'melee', hp: 16, atk: 1, speed: N, swarm: 2, inflicts: { status: 'infection', amount: 10 }, lines: [3, 8] },
  frog:     { name: '황소개구리', kind: 'melee', hp: 14, atk: 1, speed: N, special: 'tongue', inflicts: { status: 'wet' }, lines: [3, 8] },
  looter:   { name: '약탈자', kind: 'melee', hp: 24, atk: 2, speed: N, special: 'enrage', lines: 'all' },
  // 8-2 원거리
  pigeon:     { name: '비둘기', kind: 'ranged', hp: 6, atk: 1, speed: F, swarm: 3, fly: true, range: RANGE.mid, shot: { col: '#e8e4d4', speed: 110, puddle: 'slip' }, inflicts: { status: 'slip' }, lines: [1, 4] },
  crow:       { name: '까마귀', kind: 'ranged', hp: 8, atk: 1, speed: F, fly: true, range: RANGE.mid, shot: { col: '#8a8a8a', speed: 170 }, inflicts: { status: 'stolen', what: 'part' }, lines: [1, 6] },
  monkey:     { name: '탈출한 원숭이', kind: 'ranged', hp: 14, atk: 1, speed: N, range: RANGE.mid, shot: { col: '#b08a50', speed: 180, burst: 3 }, lines: [6, 7] },
  cobra:      { name: '침 뱉는 코브라', kind: 'ranged', hp: 16, atk: 1, speed: S, range: RANGE.long, shot: { col: '#9ad04a', speed: 200 }, inflicts: { status: 'blur' }, lines: [6] },
  archerfish: { name: '물총고기', kind: 'ranged', hp: 8, atk: 1, speed: S, range: RANGE.mid, shot: { col: '#7ec8ff', speed: 190 }, inflicts: { status: 'wet' }, lines: [3] },
  skunk:      { name: '스컹크', kind: 'ranged', hp: 12, atk: 1, speed: N, range: RANGE.short, gas: true, inflicts: { status: 'confusion' }, lines: [5, 8] },
  slinger:    { name: '새총 약탈자', kind: 'ranged', hp: 18, atk: 1, speed: N, range: RANGE.long, shot: { col: '#9a8a70', speed: 220, burst: 3 }, lines: 'all' },
  drone:      { name: '경비 드론', kind: 'ranged', hp: 16, atk: 1, speed: N, fly: true, range: RANGE.long, shot: { col: '#ff5a4a', speed: 230, electricEvery: 3 }, inflicts: { status: 'shock', whenWet: true }, lines: [2, 9] },
  // 8-3 특수(3번째 칸부터, 부품을 떨어뜨림)
  alpha:     { name: '들개 우두머리', kind: 'elite', hp: 60, atk: 2, speed: F, special: 'howl', inflicts: { status: 'fear' }, lines: 'all' },
  queenant:  { name: '여왕개미', kind: 'elite', hp: 60, atk: 1, speed: S, special: 'spawnAnts', inflicts: { status: 'acidBurn' }, lines: 'all' },
  momboar:   { name: '엄마 멧돼지', kind: 'elite', hp: 70, atk: 3, speed: N, special: 'charge', escort: { id: 'piglet', count: 3 }, lines: 'all' },
  infmosq:   { name: '감염 모기 떼', kind: 'elite', hp: 40, atk: 1, speed: F, fly: true, special: 'scatter', inflicts: { status: 'infection', amount: 25 }, lines: 'all' },
  ratking:   { name: '시궁쥐 왕', kind: 'elite', hp: 80, atk: 1, speed: N, special: 'split', inflicts: { status: 'infection', amount: 15 }, lines: 'all' },
  thief:     { name: '도둑 너구리', kind: 'elite', hp: 30, atk: 0, speed: VF, special: 'stealWeapon', inflicts: { status: 'stolen', what: 'weapon' }, sprite: 'raccoon', glow: true, lines: 'all' },
  infected:  { name: '감염된 약탈자', kind: 'elite', hp: 40, atk: 2, speed: N, special: 'deathCloud', inflicts: { status: 'infection', amount: 20 }, lines: 'all' },
  shieldbot: { name: '방패 경비 로봇', kind: 'elite', hp: 50, atk: 1, speed: S, special: 'frontShield', inflicts: { status: 'shock' }, lines: 'all' },
  // 엄마 멧돼지와 함께만 나온다
  piglet:    { name: '새끼 멧돼지', kind: 'melee', hp: 8, atk: 1, speed: F, hidden: true, lines: [] },
};
for (const [id, m] of Object.entries(MONSTERS)) { m.id = id; m.sprite = m.sprite || id; }
