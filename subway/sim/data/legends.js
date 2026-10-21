// 전설 강화 7종: 연구 노트에서 운이 좋을 때만(20%) 나오고, 한 판에 종류마다 딱 한 번만 얻는다.
// 들고 있는 모든 총·던지는 무기에 적용된다(교사 제안 2개 + Claude 제안 5개, 2026-10-21)
export const LEGENDS = {
  twin:   { name: '한방에 두 놈', text: '한 번 쏘면 두 발이 나간다(던지는 무기는 두 개)', icon: '✌️' },
  bouncy: { name: '탱탱볼', text: '총알이 벽까지 끝까지 날아가고, 벽에 맞으면 3번까지 튕긴다', icon: '🏀' },
  homing: { name: '유도탄', text: '총알이 가까운 적을 따라 휘어 날아간다', icon: '🎯' },
  split:  { name: '분열탄', text: '처음 맞힌 적에게서 작은 탄 3개로 갈라진다(피해 절반)', icon: '💥' },
  boom:   { name: '폭발탄', text: '맞은 자리에서 작게 터져 주변 적도 다친다(피해 40%)', icon: '🧨' },
  giant:  { name: '거대탄', text: '총알이 2배 커지고 피해 +30%, 대신 조금 느려진다', icon: '🪨' },
  chain:  { name: '연쇄 번개', text: '맞은 적 근처의 적 1마리에게 번개가 튄다(피해 절반)', icon: '⚡' },
};
for (const [id, l] of Object.entries(LEGENDS)) l.id = id;
export const LEGEND_CHANCE = 0.2;
export const hasLegend = (p, id) => !!(p.legends && p.legends.includes(id));
