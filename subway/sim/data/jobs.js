// 직업 6명 (설계서 9절). 체력/방어막/에너지, 스킬(쿨타임 초), 특성, 시작 무기
export const JOBS = {
  doctor:    { id: 'doctor', name: '의사', hp: 7, shield: 3, energy: 150, skill: { id: 'firstAid', name: '응급 처치', cooldown: 25 }, traits: ['infectionHalf', 'extraItemSlot'], startWeapon: 'sprayer', unit: '감염병' },
  electric:  { id: 'electric', name: '전기공학자', hp: 5, shield: 4, energy: 220, skill: { id: 'coilTurret', name: '코일 터렛', cooldown: 20 }, traits: ['shockImmune', 'darkLit'], startWeapon: 'coil', unit: '전자기 유도, 발전' },
  climate:   { id: 'climate', name: '기후학자', hp: 6, shield: 4, energy: 180, skill: { id: 'forecast', name: '기후 예측', cooldown: 22 }, traits: ['weatherHalf', 'lineInfoDetail'], startWeapon: 'cool', unit: '엘니뇨, 지구 온난화' },
  chemist:   { id: 'chemist', name: '화학자', hp: 5, shield: 5, energy: 180, skill: { id: 'neutralBomb', name: '중화 폭탄', cooldown: 18 }, traits: ['acidImmune', 'extraCraft'], startWeapon: 'lime', unit: '산·염기, 중화 반응' },
  ecologist: { id: 'ecologist', name: '생태학자', hp: 6, shield: 4, energy: 160, skill: { id: 'vines', name: '덩굴 소환', cooldown: 20 }, traits: ['poisonImmune', 'clearEnergy30'], startWeapon: 'pipe', unit: '생태계, 사막화' },
  ai:        { id: 'ai', name: 'AI 연구원', hp: 5, shield: 3, energy: 200, skill: { id: 'droneBuddy', name: '드론 동료', cooldown: 30 }, traits: ['showInflict', 'clueGlow'], startWeapon: 'flash', unit: 'AI, 빅데이터' },
};
export const JOB_ORDER = ['doctor', 'electric', 'climate', 'chemist', 'ecologist', 'ai'];
// 직업 특성 설명(직업 고르기 화면)
export const TRAIT_TEXT = {
  infectionHalf: '감염 수치가 절반만 오른다', extraItemSlot: '소모품을 1개 더 들 수 있다',
  shockImmune: '감전 기절에 걸리지 않는다', darkLit: '정전 칸이 처음부터 밝다',
  weatherHalf: '열사병·동상·젖음 효과가 절반이다', lineInfoDetail: '다음 노선의 위험을 자세히 본다',
  acidImmune: '개미산 화상·부식에 걸리지 않는다', extraCraft: '정비소에서 소모품을 1개 더 만든다',
  poisonImmune: '독에 걸리지 않는다', clearEnergy30: '칸을 정리할 때마다 에너지 +30',
  showInflict: '적이 일으키는 상태 이상이 머리 위에 보인다', clueGlow: '숨겨진 칸 단서가 반짝인다',
};
export const SKILL_TEXT = {
  firstAid: '체력 2 회복, 걸린 상태 이상 모두 해제', coilTurret: '8초간 전기탄을 자동으로 쏘는 터렛',
  forecast: '5초간 모든 적과 탄이 절반 속도', neutralBomb: '주변 범위 피해 20, 산성 웅덩이 제거',
  vines: '4초간 범위 안 적을 묶음', droneBuddy: '15초간 따라다니며 공격하는 드론',
};
