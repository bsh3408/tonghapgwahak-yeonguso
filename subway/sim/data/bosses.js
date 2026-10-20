// 노선 보스 9 (설계서 8-4절). hp는 첫 노선 기준, 노선 순서마다 +20%
// act: 공격 방식, needGear: 갖추면 핵심 패턴이 약해지는 방비, solvedEffect: 숨겨진 칸을 풀었을 때
export const BOSSES = {
  1: { id: 'b_boar', name: '더위에 날뛰는 멧돼지 우두머리', hp: 300, atk: 3, speed: 40, act: 'charge', chargeCount: 3, needGear: ['coolVest'], solvedEffect: '돌진이 2연속으로 줄어듦' },
  2: { id: 'b_cleaner', name: '고장 난 대형 청소 로봇', hp: 320, atk: 2, speed: 30, act: 'spread', needGear: ['rubberBoots'], solvedEffect: '조명이 켜져 약점(배터리 칸)이 드러남' },
  3: { id: 'b_croc', name: '동물원을 탈출한 악어', hp: 340, atk: 3, speed: 33, act: 'bite', needGear: ['raincoat', 'rubberBoots'], solvedEffect: '물이 빠져 잠수 불가' },
  4: { id: 'b_queen', name: '거대 여왕개미', hp: 360, atk: 2, speed: 20, act: 'spawn', needGear: ['thickBoots'], solvedEffect: '웅덩이가 생기지 않음' },
  5: { id: 'b_ratking', name: '시궁쥐 왕 (거대)', hp: 380, atk: 2, speed: 30, act: 'cloud', needGear: ['mask', 'gasMask'], solvedEffect: '감염 구름 없음' },
  6: { id: 'b_hyena', name: '모래바람 속 하이에나 무리', hp: 130, atk: 2, speed: 63, act: 'charge', chargeCount: 1, count: 3, needGear: ['goggles'], solvedEffect: '모래바람이 걷혀 숨지 못함' },
  7: { id: 'b_bear', name: '굶주린 반달가슴곰', hp: 420, atk: 3, speed: 37, act: 'smash', needGear: ['winterCoat', 'gripShoes'], solvedEffect: '추위로 체력을 회복하지 못함' },
  8: { id: 'b_frog', name: '거대 황소개구리', hp: 300, atk: 2, speed: 40, act: 'tongue', waves: 3, needGear: ['longSleeves', 'mask'], solvedEffect: '웨이브가 2번으로 줄어듦' },
  9: { id: 'b_looter', name: '약탈자 두목', hp: 500, atk: 3, speed: 33, act: 'rifle', phases: true, needGear: [], solvedEffect: '다음 단계의 재난을 미리 알 수 있음' },
};
