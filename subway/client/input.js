// 키보드·터치를 틱마다 1바이트 입력으로 바꾼다
import { INPUT, DT } from '../sim/constants.js';

const KEYS = {
  KeyW: INPUT.UP, ArrowUp: INPUT.UP, KeyS: INPUT.DOWN, ArrowDown: INPUT.DOWN,
  KeyA: INPUT.LEFT, ArrowLeft: INPUT.LEFT, KeyD: INPUT.RIGHT, ArrowRight: INPUT.RIGHT,
  KeyJ: INPUT.ATTACK, Space: INPUT.ATTACK, KeyK: INPUT.SKILL, KeyQ: INPUT.SWAP, KeyE: INPUT.ITEM,
};
const MAX_TICKS = 5;

// 터치 막대는 8방향으로 끊는다(가운데 6픽셀 안은 멈춤)
export function touchDir(t) {
  if (!t || Math.hypot(t.dx, t.dy) < 6) return 0;
  const sector = Math.round(Math.atan2(t.dy, t.dx) / (Math.PI / 4));
  const DIRS = { 0: INPUT.RIGHT, 1: INPUT.RIGHT | INPUT.DOWN, 2: INPUT.DOWN, 3: INPUT.LEFT | INPUT.DOWN, 4: INPUT.LEFT, '-4': INPUT.LEFT,
    '-3': INPUT.LEFT | INPUT.UP, '-2': INPUT.UP, '-1': INPUT.RIGHT | INPUT.UP };
  return DIRS[sector];
}

export function encodeInput(keys, touch = null, buttons = {}) {
  let b = 0;
  for (const k of keys) b |= KEYS[k] || 0;
  b |= touchDir(touch);
  if (buttons.attack) b |= INPUT.ATTACK;
  if (buttons.skill) b |= INPUT.SKILL;
  if (buttons.swap) b |= INPUT.SWAP;
  if (buttons.item) b |= INPUT.ITEM;
  if ((b & INPUT.LEFT) && (b & INPUT.RIGHT)) b &= ~(INPUT.LEFT | INPUT.RIGHT);
  if ((b & INPUT.UP) && (b & INPUT.DOWN)) b &= ~(INPUT.UP | INPUT.DOWN);
  return b;
}

// 쌓인 시간으로 이번 프레임에 돌릴 틱 수. 창을 내렸다 올려 시간이 많이 쌓이면 5틱만 돌리고 나머지는 버린다
export function frameTicks(acc) {
  const n = Math.floor(acc / DT + 1e-9);
  if (n >= MAX_TICKS) return { ticks: MAX_TICKS, rest: 0 };
  return { ticks: n, rest: acc - n * DT };
}

export const KEY_CODES = Object.keys(KEYS);
