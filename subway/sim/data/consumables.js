// 응급 소모품 8종 (설계서 7절). 기본 3개까지 들고 다닌다
export const CONSUMABLES = {
  disinfectant: { name: '소독약', cures: ['infection'], infectionMinus: 50 },
  sodaOintment: { name: '베이킹소다 연고', cures: ['acidBurn'] },
  antidote:     { name: '해독 응급 키트', cures: ['poison'] },
  towel:        { name: '마른 수건', cures: ['wet'] },
  eyewash:      { name: '세척수', cures: ['blur'] },
  waterBottle:  { name: '물병', cures: ['heatstroke'], heatMinus: 60 },
  handWarmer:   { name: '손난로', cures: ['frostbite'], suppress: 10 },
  neutralSpray: { name: '중화 스프레이', cures: ['corrosion'], restoreShield: true },
};
for (const [id, c] of Object.entries(CONSUMABLES)) c.id = id;
export const ITEM_SLOTS = 3;
// 정비소에서 소모품을 만드는 재료(설계서 7절: 재료는 상자·몬스터에게서 얻음)
export const ITEM_RECIPES = {
  disinfectant: { glass: 1, cloth: 1 }, sodaOintment: { glass: 1, vinyl: 1 }, antidote: { glass: 1, string: 1 }, towel: { cloth: 1 },
  eyewash: { glass: 1 }, waterBottle: { vinyl: 1 }, handWarmer: { scrap: 1, cloth: 1 }, neutralSpray: { vinyl: 1, filter: 1 },
};
