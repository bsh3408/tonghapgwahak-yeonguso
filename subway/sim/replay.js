// 칸을 입력 기록으로 처음부터 다시 돌리고, 상태를 문자열로 저장·복원한다(서버 검증용, 설계서 12절)
import { step } from './step.js';
import { createCarState } from './car.js';

export function serialize(state) {
  return JSON.stringify(state, (k, v) => (k === 'events' ? undefined : v));
}
export function deserialize(str) {
  const s = JSON.parse(str); s.events = []; return s;
}
export function hashState(state) {
  const str = serialize(state);
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// inputs: 틱마다 1바이트(INPUT 비트). 칸이 끝나면(cleared/dead) 남은 입력은 버린다
export function runCar(run, lineData, carIndex, inputs, opts = {}) {
  const s = createCarState(run, lineData, carIndex, opts);
  let ticks = 0;
  for (const i of inputs) { if (s.done) break; step(s, i); ticks++; }
  const p = s.player;
  return { done: s.done, ticks, hp: p.hp, shield: p.shield, energy: Math.round(p.energy * 1000) / 1000, gained: s.gained, hash: hashState(s) };
}
