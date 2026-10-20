// 중간 저장(설계서 12절): 칸 문을 열고 들어갈 때마다, 환승 통로에서 저장한다.
// 지금은 이 기기의 브라우저 저장소에만 둔다(서버 저장은 2번 계획). 저장소를 못 쓰면 조용히 넘어간다
let KEY = 'subwayEscape.v1', CODEX = 'subwayEscape.codex';
// 연구소에서는 같은 기기를 여러 학생이 쓰므로 학생마다 따로 저장한다
export function setSaveUser(name) { KEY = 'subwayEscape.v1__' + name; CODEX = 'subwayEscape.codex__' + name; }
const store = () => { try { return globalThis.localStorage || null; } catch { return null; } };

export function saveCheckpoint(run, lineData, carIndex, phase = 'car', extra = {}) {
  try { store()?.setItem(KEY, JSON.stringify({ v: 1, run, lineData, carIndex, phase, extra, at: Date.now() })); return true; } catch { return false; }
}
export function loadCheckpoint() {
  try {
    const raw = store()?.getItem(KEY); if (!raw) return null;
    const c = JSON.parse(raw);
    if (c?.v !== 1 || !c.run || !c.lineData) return null;
    return c;
  } catch { return null; }
}
export function clearCheckpoint() { try { store()?.removeItem(KEY); } catch { /* 저장소를 못 씀 */ } }

// 도감: 판이 끝나도 남는 기록(장비 기능, 상태 이상, 몬스터)
export function loadCodex() { try { return JSON.parse(store()?.getItem(CODEX) || 'null') || { gear: [], status: [], monsters: [] }; } catch { return { gear: [], status: [], monsters: [] }; } }
export function mergeCodex(c) {
  const all = loadCodex();
  for (const k of ['gear', 'status', 'monsters']) for (const v of c[k] || []) if (!all[k].includes(v)) all[k].push(v);
  try { store()?.setItem(CODEX, JSON.stringify(all)); } catch { /* 저장소를 못 씀 */ }
  return all;
}

// 저장 단계별로 어디서 이어 할지
export function resumePlan(c) {
  if (c.phase === 'cargo') return { kind: 'cargo', carIndex: c.carIndex };
  if (c.phase === 'transfer') return { kind: 'transfer', step: c.extra?.step || 'note', extra: c.extra };
  if (c.phase === 'choose') return { kind: 'choose' };
  return { kind: 'car', carIndex: c.carIndex };
}
