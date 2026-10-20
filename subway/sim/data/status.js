// 상태 이상 13종 (설계서 7절). reason은 설계서 "과학 근거" 원문. gear는 막아 주는 장비, cure는 치료 소모품
// dur: 기본 지속 시간(초). 감염·열사병은 수치형이라 지속 시간 대신 수치로 다룬다
export const STATUS = {
  infection:  { name: '감염', icon: '🦠', kind: 'meter', cause: '시궁쥐, 모기, 감염된 약탈자, 5호선', effect: '감염 수치가 쌓여 100이 되면 2초마다 체력 1 감소', gear: ['mask', 'gasMask', 'longSleeves'], cure: 'disinfectant', reason: '병원체는 매개체(쥐·모기)와 비말로 옮는다' },
  acidBurn:   { name: '개미산 화상', icon: '🔥', dur: 3, cause: '불개미, 여왕개미 웅덩이', effect: '3초간 초당 피해 1', gear: ['thickBoots'], cure: 'sodaOintment', reason: '개미산(폼산)은 산이라 염기로 중화한다' },
  poison:     { name: '독', icon: '☠️', dur: 5, cause: '살모사, 말벌', effect: '뱀: 2초 뒤 피해 1 추가 / 말벌: 부어올라 5초간 이동 −30%', gear: ['thickBoots', 'longSleeves'], cure: 'antidote', reason: '독이 몸에 퍼지는 동안 움직임이 둔해진다' },
  wet:        { name: '젖음', icon: '💧', dur: 5, cause: '물총고기, 침수 구간(3호선), 비', effect: '5초간 받는 전기 피해 2배, 전기 공격에 맞으면 1초 기절', gear: ['raincoat', 'rubberBoots'], cure: 'towel', reason: '물에 녹은 이온 때문에 젖은 몸은 전기가 잘 통한다' },
  shock:      { name: '감전 기절', icon: '⚡', dur: 1.5, cause: '전기 함정, 젖은 상태에서 전기 공격', effect: '1~2초 움직이지 못함', gear: ['rubberBoots'], cure: null, reason: '고무는 전기가 잘 통하지 않는 절연체' },
  blur:       { name: '시야 흐림', icon: '👁️', dur: 4, cause: '침 뱉는 코브라 독침, 모래 폭풍(6호선)', effect: '4초간 화면이 흐려지고 시야 반경 절반', gear: ['goggles'], cure: 'eyewash', reason: '눈을 막아 주는 투명한 막' },
  confusion:  { name: '혼란', icon: '😵', dur: 2, cause: '스컹크 가스', effect: '2초간 이동 방향이 뒤집힘', gear: ['gasMask'], cure: null, reason: '방독면의 활성탄이 냄새 분자를 흡착한다' },
  slip:       { name: '미끄러짐', icon: '🧊', dur: 2, cause: '비둘기 배설물, 얼음 바닥(7호선)', effect: '2초간 멈추지 못하고 미끄러짐', gear: ['gripShoes'], cure: null, reason: '접지면의 마찰력' },
  heatstroke: { name: '열사병', icon: '🥵', kind: 'meter', cause: '폭염 구간(1호선)', effect: '열 수치가 차면 이동 −25%, 방어막 회복 멈춤', gear: ['coolVest', 'sunHat'], cure: 'waterBottle', reason: '땀(물)이 증발하며 열을 빼앗는다' },
  frostbite:  { name: '동상', icon: '🥶', dur: 12, cause: '한파 구간(7호선)', effect: '이동 −20%, 10초마다 체력 1 감소', gear: ['winterCoat'], cure: 'handWarmer', reason: '갇힌 공기가 열 이동을 막는다(단열) / 철의 산화는 발열 반응' },
  corrosion:  { name: '부식', icon: '🧪', dur: 0, cause: '산성비(4호선), 산성 웅덩이', effect: '방어막 최대치가 1씩 줄어듦(최소 0)', gear: ['raincoat'], cure: 'neutralSpray', reason: '산이 금속·장비를 부식시킨다' },
  fear:       { name: '겁먹음', icon: '😨', dur: 2, cause: '들개 우두머리의 울부짖음', effect: '2초간 공격 속도 −50%', gear: ['earplugs'], cure: null, reason: '큰 소리 자극' },
  stolen:     { name: '도둑맞음', icon: '🎒', dur: 0, cause: '너구리, 까마귀', effect: '부품이나 무기 1개를 빼앗김', gear: [], cure: null, reason: '쫓아가서 쓰러뜨리면 돌려받는다' },
};
for (const [id, s] of Object.entries(STATUS)) s.id = id;
