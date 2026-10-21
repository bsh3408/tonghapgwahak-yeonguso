// 무기 강화 10종: 한 번 올리면 들고 있는 모든 무기에 함께 적용되고, 판이 끝나면 사라진다(교사 결정 2026-10-21)
// ★등급(무기 하나씩)과 따로 간다. 정비소에서 부품으로 올리고, 연구 노트 강화 후보로도 나온다
export const MODS = {
  power:    { name: '공격력 강화', max: 3, text: l => `피해 +${10 * l}%` },
  rate:     { name: '연사 강화', max: 3, text: l => `공격 속도 +${8 * l}%` },
  saver:    { name: '에너지 절약', max: 3, text: l => `쓰는 에너지 −${15 * l}%` },
  velocity: { name: '탄속 강화', max: 3, text: l => `투사체 속도 +${15 * l}%, 사거리 +${10 * l}%` },
  pierce:   { name: '관통탄', max: 2, text: l => `투사체가 적 ${l}마리 더 뚫고 나감` },
  crit:     { name: '치명타', max: 3, text: l => `${10 + 7 * (l - 1)}% 확률로 피해 2배` },
  knock:    { name: '밀쳐내기', max: 2, text: l => `맞은 적이 ${1 + 0.5 * l}배 더 밀려남` },
  area:     { name: '범위 확대', max: 3, text: l => `폭발·휘두르기·빛 줄기 범위 +${15 * l}%` },
  leech:    { name: '에너지 흡수', max: 3, text: l => `적을 쓰러뜨리면 에너지 +${3 * l}` },
  quick:    { name: '빠른 교체', max: 1, text: () => '무기를 바꾼 뒤 2초 동안 공격 속도 +30%' },
};
for (const [id, m] of Object.entries(MODS)) m.id = id;
export const MOD_COST = { 1: 6, 2: 12, 3: 20 };   // 그 단계로 올리는 데 드는 부품
export const modLv = (p, id) => (p.mods && p.mods[id]) || 0;
