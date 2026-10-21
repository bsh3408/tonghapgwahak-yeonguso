// 한 틱(1/30초)을 진행한다. 상태를 그 자리에서 바꾸고, 이번 틱의 사건은 state.events에 남긴다
import { DT, INPUT, SPEED_SCALE, Y0, Y1, CAR_W } from './constants.js';
import { createRng } from './rng.js';
import { updateCar, GANGWAY_IN, GANGWAY_Y } from './car.js';
import { updateMons } from './ai.js';
import { updatePlayerCombat, updateShots } from './combat.js';
import { statusTick, moveRule } from './status.js';
import { updateJobs } from './jobs.js';

const PLAYER_SPEED = 82 * SPEED_SCALE;

function movePlayer(s, input) {
  const p = s.player;
  const rule = moveRule(s);
  let mx = (input & INPUT.RIGHT ? 1 : 0) - (input & INPUT.LEFT ? 1 : 0);
  let my = (input & INPUT.DOWN ? 1 : 0) - (input & INPUT.UP ? 1 : 0);
  if (rule.reverse) { mx = -mx; my = -my; }
  const l = Math.hypot(mx, my); if (l > 1) { mx /= l; my /= l; }
  if (rule.frozen) { p.vx = 0; p.vy = 0; }
  p.running = !!(input & INPUT.RUN) && l > 0;
  const run = p.running ? 1.45 : 1;   // 달리기(왼쪽 Shift): 빨라지지만 그동안은 방어막이 차지 않는다
  if (rule.frozen) {} else if (!(rule.slip && (p.vx || p.vy))) { p.vx = mx * PLAYER_SPEED * rule.mul * run; p.vy = my * PLAYER_SPEED * rule.mul * run; }
  p.x += p.vx * DT; p.y += p.vy * DT;
  const right = s.doorOpen ? CAR_W + GANGWAY_IN + 4 : CAR_W - 12;
  p.x = Math.max(12, Math.min(right, p.x)); p.y = Math.max(Y0, Math.min(Y1, p.y));
  if (p.x > CAR_W - 8) p.y = Math.max(GANGWAY_Y[0], Math.min(GANGWAY_Y[1], p.y));   // 연결 통로는 폭이 좁다
  for (const o of s.props) if (o.solid) { const dx = p.x - o.x, dy = p.y - o.y, d = Math.hypot(dx, dy), min = o.r + 8; if (d < min) { const k = (min - d) / (d || 1); p.x += dx * k || -min; p.y += dy * k; } }
  p.moving = !rule.frozen && (l > 0 || (rule.slip && (p.vx || p.vy)));
}

export function step(s, input) {
  if (s.done) return;
  s.events = [];
  const rng = createRng(s.rng);
  movePlayer(s, input);
  updatePlayerCombat(s, input, rng);
  updateJobs(s, input);
  updateShots(s, rng);
  updateMons(s, rng);
  statusTick(s, input);
  updateCar(s, rng);
  s.tick++;
  s.rng = rng.state();
}
