// 씨앗값으로 만드는 결정적 난수(mulberry32). 게임 규칙 안에서는 이것만 쓴다.
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
export function createRng(seed) {
  let s = seed >>> 0;
  const r = {
    next() {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    int(n) { return Math.floor(r.next() * n); },
    range(a, b) { return a + r.next() * (b - a); },
    pick(arr) { return arr[r.int(arr.length)]; },
    chance(p) { return r.next() < p; },
    fork(tag) { return createRng((s ^ hash(String(tag))) >>> 0); },
    state() { return s; },
  };
  return r;
}
