// 방비 장비 13종 (설계서 7절). blocks: 상태 이상별로 남는 비율(0=완전히 막음, 0.5=절반)
// sources: 특정 몬스터가 거는 상태 이상만 막음, melee: 근접 피해에 더하는 값. 화면에는 기능을 보여 주지 않는다
export const GEAR = {
  mask:        { name: '마스크', slot: 'head', blocks: { infection: 0.5 }, recipe: { cloth: 2 } },
  gasMask:     { name: '방독면', slot: 'head', blocks: { confusion: 0, infection: 0.3 }, recipe: { filter: 1, rubber: 1 } },
  goggles:     { name: '고글', slot: 'head', blocks: { blur: 0 }, recipe: { glass: 1, string: 1 } },
  sunHat:      { name: '챙 모자', slot: 'head', blocks: { heatstroke: 0.5 }, recipe: { cloth: 1 } },
  earplugs:    { name: '귀마개', slot: 'head', blocks: { fear: 0 }, recipe: { rubber: 1 } },
  raincoat:    { name: '우비', slot: 'body', blocks: { wet: 0, corrosion: 0 }, recipe: { vinyl: 2 } },
  winterCoat:  { name: '방한복', slot: 'body', blocks: { frostbite: 0 }, recipe: { cloth: 2, vinyl: 1 } },
  coolVest:    { name: '냉각 조끼', slot: 'body', blocks: { heatstroke: 0 }, recipe: { cloth: 1, waterBottle: 1 } },
  longSleeves: { name: '방충 긴소매', slot: 'body', blocks: {}, sources: { mosquito: 0, infmosq: 0, wasp: 0 }, recipe: { cloth: 2 } },
  armorVest:   { name: '방호 조끼', slot: 'body', blocks: { melee: -1 }, recipe: { cloth: 1, rubber: 2, scrap: 2 } },
  rubberBoots: { name: '고무장화', slot: 'feet', blocks: { shock: 0, wet: 0.5 }, recipe: { rubber: 2 } },
  thickBoots:  { name: '두꺼운 장화', slot: 'feet', blocks: { acidBurn: 0 }, sources: { viper: 0 }, recipe: { leather: 1, rubber: 1 } },
  gripShoes:   { name: '미끄럼 방지 신발', slot: 'feet', blocks: { slip: 0 }, recipe: { rubber: 1, string: 1 } },
};
for (const [id, g] of Object.entries(GEAR)) g.id = id;
export const MATERIALS = { cloth: '천', vinyl: '비닐', rubber: '고무', glass: '유리', filter: '필터', leather: '가죽', string: '끈', scrap: '고철', waterBottle: '물병' };
export const SLOT_NAME = { head: '머리', body: '몸', feet: '발' };
