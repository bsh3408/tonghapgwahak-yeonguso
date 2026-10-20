// 통합과학연구소 연결: 연구소 안(subway/)에서 열리면 로그인·장착 유물·도감·판 기록을 서버와 주고받는다.
// 연구소 밖(혼자 시험)에서는 아무것도 하지 않고 오프라인으로 돈다.
import { setSaveUser } from './save.js';

export const lab = { online: false, student: null, state: null, lastResult: null };

export async function connectLab() {
  if (typeof window.requireLogin !== 'function') return lab;
  const s = window.requireLogin('subway/index.html', '../shinjang_science.html');
  if (!s) return lab;             // 로그인하러 역무실로 이동 중
  lab.online = true; lab.student = s;
  setSaveUser(s.name);
  await refreshState();
  return lab;
}
async function call(fn, params) {
  const out = await window.labRpc(fn, params);
  if (out && out.ok === false && /세션/.test(out.error || '')) { window.clearSessionAndReload('로그인이 풀렸어요. 다시 로그인해 주세요.'); throw new Error(out.error); }
  return out;
}
export async function refreshState() {
  if (!lab.online) return null;
  try { const st = await call('subway_state_get'); if (st?.ok) lab.state = st; } catch (e) { /* 다음에 다시 */ }
  return lab.state;
}
export const equippedRelics = () => (lab.online && lab.state?.equipped) || [];
export const serverCodex = () => (lab.online && lab.state?.codex) || null;

// 판이 끝나면(쓰러짐·탈출) 서버에 기록한다. 서버 검증(입력 다시 돌리기)은 2번 계획에서 붙는다
export async function finishRunOnServer(run) {
  if (!lab.online) return null;
  try {
    const out = await call('subway_run_finish', {
      p_job: run.jobId, p_lines: run.visited.length, p_ticks: run.ticks, p_escaped: !!run.escaped, p_kills: run.kills || 0,
      p_visited: run.visited, p_codex: run.codex,
    });
    if (out?.ok) { lab.state = out; lab.lastResult = out; }
    return out;
  } catch (e) { return null; }
}
export function goHome() { location.href = lab.online ? '../shinjang_science.html' : location.href; }
