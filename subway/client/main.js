// 게임 루프: 고정 틱으로 sim을 돌리고, 매 프레임 그린다. 화면 전환은 screens.js가 맡는다
import { DT, VIEW_W, VIEW_H } from '../sim/constants.js';
import { step } from '../sim/step.js';
import { encodeInput, frameTicks, KEY_CODES } from './input.js';
import { loadAssets } from './assets.js';
import { drawCar, createFx } from './render.js';

export const game = { assets: null, state: null, fx: createFx(), keys: new Set(), touch: null, buttons: {}, mouse: {}, acc: 0, t: 0, paused: true, onCarEnd: null, onFrame: null, inputs: [] };

const cv = document.getElementById('game'), ctx = cv.getContext('2d');
ctx.imageSmoothingEnabled = false;

addEventListener('keydown', e => { if (KEY_CODES.includes(e.code)) { game.keys.add(e.code); if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault(); } });
addEventListener('keyup', e => game.keys.delete(e.code));
addEventListener('blur', () => game.keys.clear());

// 휴대폰: 화면 왼쪽 절반을 끌면 이동, 오른쪽 버튼으로 공격·스킬·무기·소모품
const stick = { id: null, ox: 0, oy: 0 };
function canvasPos(t) { const r = cv.getBoundingClientRect(); return { x: (t.clientX - r.left) / r.width * VIEW_W, y: (t.clientY - r.top) / r.height * VIEW_H }; }
function onTouch(e) {
  e.preventDefault(); game.touch = null;
  for (const t of e.touches) {
    if (t.identifier !== stick.id && stick.id !== null) continue;
    const p = canvasPos(t);
    if (stick.id === null) { if (p.x > VIEW_W / 2) continue; stick.id = t.identifier; stick.ox = p.x; stick.oy = p.y; }
    game.touch = { dx: p.x - stick.ox, dy: p.y - stick.oy, ox: stick.ox, oy: stick.oy };
  }
  if (![...e.touches].some(t => t.identifier === stick.id)) { stick.id = null; game.touch = null; }
}
['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach(n => cv.addEventListener(n, onTouch, { passive: false }));
for (const b of document.querySelectorAll('[data-btn]')) {
  const k = b.dataset.btn, on = e => { e.preventDefault(); game.buttons[k] = true; b.classList.add('down'); }, off = e => { e.preventDefault(); game.buttons[k] = false; b.classList.remove('down'); };
  b.addEventListener('touchstart', on, { passive: false }); b.addEventListener('touchend', off, { passive: false }); b.addEventListener('touchcancel', off, { passive: false });
  b.addEventListener('mousedown', on); b.addEventListener('mouseup', off); b.addEventListener('mouseleave', off);
}

// 마우스: 왼쪽 버튼을 누르고 있으면 공격, 오른쪽 버튼은 스킬(소울나이트처럼)
const stage = document.getElementById('stage');
stage.addEventListener('contextmenu', e => e.preventDefault());
cv.addEventListener('mousedown', e => { if (e.button === 0) game.mouse.attack = true; if (e.button === 2) game.mouse.skill = true; });
addEventListener('mouseup', e => { if (e.button === 0) game.mouse.attack = false; if (e.button === 2) game.mouse.skill = false; });
addEventListener('blur', () => { game.mouse.attack = game.mouse.skill = false; for (const k in game.buttons) game.buttons[k] = false; });

export function fit() {
  const wrap = document.getElementById('stage'), w = wrap.clientWidth, h = wrap.clientHeight;
  const s = Math.max(1, Math.min(w / VIEW_W, h / VIEW_H)), si = s >= 1.5 ? Math.floor(s) : s;
  cv.style.width = VIEW_W * si + 'px'; cv.style.height = VIEW_H * si + 'px';
}
addEventListener('resize', fit);

export function startCar(state) { game.state = state; game.inputs = []; game.acc = 0; game.paused = false; }

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.25, Math.max(0, (now - last) / 1000)); last = now; game.t += dt;
  const s = game.state;
  if (s && !game.paused) {
    const { ticks, rest } = frameTicks(game.acc + dt); game.acc = rest;
    for (let i = 0; i < ticks && !s.done; i++) {
      const b = game.buttons, m = game.mouse, inp = encodeInput(game.keys, game.touch, { attack: b.attack || m.attack, skill: b.skill || m.skill, swap: b.swap, item: b.item, run: b.run });
      game.inputs.push(inp); step(s, inp); game.fx.feed(s); game.onTick?.(s);
    }
    if (s.done && game.onCarEnd) { game.paused = true; const cb = game.onCarEnd; setTimeout(() => cb(s), s.done === 'dead' ? 900 : 200); }
  }
  game.fx.update(dt);
  ctx.fillStyle = '#111'; ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  if (s && game.assets) drawCar(ctx, s, game.assets, game.fx, game.t);
  if (game.touch) { ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(game.touch.ox, game.touch.oy, 28, 0, 6.283); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.35)'; const k = Math.min(1, 28 / (Math.hypot(game.touch.dx, game.touch.dy) || 1)); ctx.beginPath(); ctx.arc(game.touch.ox + game.touch.dx * k, game.touch.oy + game.touch.dy * k, 12, 0, 6.283); ctx.fill(); }
  game.onFrame?.(s, dt);
  requestAnimationFrame(frame);
}

export async function boot(manifest, urlOf) {
  fit();
  game.assets = await loadAssets(manifest, urlOf);
  requestAnimationFrame(t => { last = t; frame(t); });
}
export { DT };
