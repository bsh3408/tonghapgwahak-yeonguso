// 유물 13종 (설계서 11-3절). grade 1~3(★ 개수)
export const RELICS = {
  battery:       { name: '예비 배터리', grade: 1, effect: '최대 에너지 +30' },
  medkit:        { name: '구급 파우치', grade: 1, effect: '최대 체력 +1' },
  lockBag:       { name: '잠금 가방', grade: 1, effect: '도둑맞음에 걸리지 않음' },
  itemPouch:     { name: '응급 주머니', grade: 1, effect: '소모품 1칸 더' },
  magnifier:     { name: '돋보기', grade: 2, effect: '정비소에서 장비가 무엇을 막아 주는지 보임' },
  flashGen:      { name: '손전등 발전기', grade: 2, effect: '정전·어두운 칸이 처음부터 밝음' },
  hazardGlasses: { name: '위험 감지 안경', grade: 2, effect: '적 머리 위에 일으키는 상태 이상 아이콘 표시' },
  sewingKit:     { name: '수선 도구', grade: 2, effect: '정비소에서 장비를 재료 1개 덜 들여 만듦' },
  magnet:        { name: '네오디뮴 자석', grade: 2, effect: '전기 계열 무기 피해 +20%' },
  vaccine:       { name: '백신 키트', grade: 3, effect: '감염 수치 증가 절반' },
  solarPanel:    { name: '휴대용 태양광 패널', grade: 3, effect: '에너지 회복 2배' },
  oldNote:       { name: '낡은 연구 노트', grade: 3, effect: '연구 노트를 틀려도 강화 고르기 (한 판 1회)' },
  buoy:          { name: '해수면 관측 부표', grade: 3, effect: '다음 노선 2개의 위험 표시를 자세히 보여 줌' },
};
for (const [id, r] of Object.entries(RELICS)) r.id = id;
