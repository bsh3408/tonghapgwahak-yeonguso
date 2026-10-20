// 노선 1~9 (설계서 6-1절). envStatus: 숨겨진 칸을 풀지 않았을 때 걸리는 환경 상태 이상
// hazardIcons: 환승 통로 표지판에 붙는 위험 표시(그 노선에서 자주 걸리는 상태 이상)
export const LINES = {
  1: { name: '1호선', theme: '오래된 지상 구간', hazard: 'heat', hazardName: '폭염', envStatus: 'heatstroke', above: true, hazardIcons: ['heatstroke', 'poison'] },
  2: { name: '2호선', theme: '도심 순환선', hazard: 'dark', hazardName: '정전', envStatus: null, darkRadius: 80, hazardIcons: ['shock', 'infection'] },
  3: { name: '3호선', theme: '강 건너는 구간', hazard: 'flood', hazardName: '침수', envStatus: 'wet', moveMul: 0.75, hazardIcons: ['wet', 'shock'] },
  4: { name: '4호선', theme: '매연 구간', hazard: 'acidRain', hazardName: '산성비', envStatus: 'corrosion', hazardIcons: ['corrosion', 'acidBurn'] },
  5: { name: '5호선', theme: '깊은 지하 구간', hazard: 'epidemic', hazardName: '감염병', envStatus: 'infection', hazardIcons: ['infection', 'confusion'] },
  6: { name: '6호선', theme: '지상 환기구 구간', hazard: 'sand', hazardName: '모래 폭풍', envStatus: 'blur', above: true, hazardIcons: ['blur', 'poison'] },
  7: { name: '7호선', theme: '냉동 창고 지역', hazard: 'cold', hazardName: '한파', envStatus: 'frostbite', hazardIcons: ['frostbite', 'slip'] },
  8: { name: '8호선', theme: '생태 공원 연결', hazard: 'eco', hazardName: '생태계 교란', envStatus: null, invaders: ['nutria', 'frog'], hazardIcons: ['wet', 'infection'] },
  9: { name: '9호선', theme: '급행', hazard: 'elnino', hazardName: '슈퍼 엘니뇨', envStatus: null, elninoPool: ['heatstroke', 'wet', 'frostbite'], elninoStrength: 0.5, hazardIcons: ['heatstroke', 'wet', 'frostbite'] },
};
