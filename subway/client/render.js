// 칸 상태를 캔버스에 그린다(그리기만 하고 상태는 바꾸지 않는다)
import { CAR_W, VIEW_W, VIEW_H, Y0, Y1, DT } from '../sim/constants.js';
import { MONSTERS } from '../sim/data/monsters.js';
import { WEAPONS } from '../sim/data/weapons.js';
import { SIDE_DOORS } from '../sim/car.js';

const SHOT_COL = { slingshot: '#9a8a70', crossbow: '#c8b88a', lime: '#f2efe6', coil: '#7fd8ff', net: '#d8d0b0', cool: '#bfe8ff', sprayer: '#8fe0cc', flash: '#fff2a0', water: '#7ec8ff' };
const BEAM_COL = { co2: 'rgba(235,240,245,.5)', led: 'rgba(255,250,210,.32)', solar: 'rgba(255,224,120,.30)' };
const ZONE_COL = { acid: 'rgba(170,210,60,.35)', cloud: 'rgba(140,190,60,.28)', gas: 'rgba(180,170,90,.3)', electric: 'rgba(120,200,255,.3)', ice: 'rgba(200,235,255,.4)', puddle: 'rgba(230,228,215,.45)', disinfect: 'rgba(190,230,200,.25)' };
// 노선마다 바닥·벽 색(테마)
const THEME = {
  1: { wall: '#4a4440', floor: '#8f8670', seat: '#7a5a3a' }, 2: { wall: '#2e3440', floor: '#6f7178', seat: '#3d5a4a' }, 3: { wall: '#34424a', floor: '#6d7a80', seat: '#3d566a' },
  4: { wall: '#3c4038', floor: '#7d806a', seat: '#5a5f3a' }, 5: { wall: '#2c2f36', floor: '#5e6166', seat: '#4a3d4a' }, 6: { wall: '#5a4e3c', floor: '#a08e6a', seat: '#7a6a4a' },
  7: { wall: '#3c4a56', floor: '#a9b8c4', seat: '#4a6a7a' }, 8: { wall: '#334036', floor: '#6f7f60', seat: '#4f6a3a' }, 9: { wall: '#3a4150', floor: '#8a8574', seat: '#5d7a52' },
};
const bgCache = {};
// 노선 색(실제 서울 지하철 노선 색을 따름): 벽의 띠에 칠한다
export const LINE_COLOR = { 1: '#0052A4', 2: '#00A84D', 3: '#EF7C1C', 4: '#00A5DE', 5: '#996CAC', 6: '#CD7C2F', 7: '#747F00', 8: '#E6186C', 9: '#BDB092' };
// 객실 배경: AI로 그린 객실 부품(벽·의자·손잡이·출입문·바닥)을 이어 붙인다. 출입문은 그 위에 따로 그려서 여닫는다
function carBackground(line, boss, A) {
  const key = line + (boss ? 'b' : '');
  if (bgCache[key]) return bgCache[key];
  const S = A.subway, M = S.meta, c = document.createElement('canvas'); c.width = CAR_W; c.height = VIEW_H; const x = c.getContext('2d');
  x.fillStyle = '#1d2026'; x.fillRect(0, 0, CAR_W, VIEW_H);
  for (let X = 0; X < CAR_W; X += M.floor.w) for (let Y = 100; Y < 300; Y += M.floor.h) x.drawImage(S.floor, X, Y);
  if (boss) { // 개찰구: 벽 대신 개찰기 줄
    T_GATES(x);
  } else {
    const wy = 100 - 22 - M.wall.h;   // 벽 아래로 의자가 22칸 들어간다
    x.fillStyle = '#2a2d33'; x.fillRect(0, 0, CAR_W, wy + 2); x.fillStyle = '#e8e2c8'; for (let X = 30; X < CAR_W; X += 120) x.fillRect(X, 6, 60, 3);
    for (let X = -40; X < CAR_W; X += M.wall.w) x.drawImage(S.wall, X, wy);
    x.fillStyle = LINE_COLOR[line] || '#888'; x.fillRect(0, wy + M.wall.stripeY - 1, CAR_W, 3);
    for (let X = 10; X < CAR_W; X += M.handles.w + 20) x.drawImage(S.handles, X, wy - 6);
    for (let X = 0; X < CAR_W; X += M.bench.w) x.drawImage(S.bench, X, 100 - M.bench.h + 6);
    // 가까운 쪽(아래): 의자 등받이와 벽 아랫부분
    x.save(); x.translate(0, 300 + M.bench.h - 6); x.scale(1, -1); for (let X = -60; X < CAR_W; X += M.bench.w) x.drawImage(S.bench, X, 0); x.restore();
    x.fillStyle = '#25282e'; x.fillRect(0, 300 + M.bench.h - 6, CAR_W, VIEW_H); x.fillStyle = LINE_COLOR[line] || '#888'; x.fillRect(0, 338, CAR_W, 3);
    x.drawImage(S.endDoor, 0, 100 - M.endDoor.h); x.drawImage(S.endDoor, CAR_W - M.endDoor.w, 100 - M.endDoor.h);
  }
  bgCache[key] = c; return c;
}
function T_GATES(x) {
  x.fillStyle = '#3a4150'; x.fillRect(0, 0, CAR_W, 100); x.fillStyle = '#2e333d'; x.fillRect(0, 300, CAR_W, 60);
  for (let i = 0; i < 11; i++) { const gx = 40 + i * 92; x.fillStyle = '#9aa1ab'; x.fillRect(gx, 30, 30, 70); x.fillStyle = '#5a6070'; x.fillRect(gx + 4, 34, 22, 10); x.fillStyle = i % 3 ? '#7fd87f' : '#d85a4a'; x.fillRect(gx + 12, 50, 6, 6); }
}
// 출입문(위·아래): 웨이브가 들어올 때 그 문만 잠깐 열린다
function drawDoors(x, s, A, camX, fx) {
  if (s.carType === 'boss') return;
  const S = A.subway, M = S.meta;
  for (const dx of SIDE_DOORS) for (const top of [true, false]) {
    const open = fx.doorOpen?.(dx, top), img = open ? S.doorOpen : S.doorClosed, w = open ? M.doorOpen.w : M.doorClosed.w;
    const X = Math.round(dx - camX - w / 2);
    if (X > VIEW_W || X + w < 0) continue;
    if (top) x.drawImage(img, X, 100 - img.height + 4);
    else { x.save(); x.translate(X, 300 - 4); x.drawImage(img, 0, 0, img.width, 60, 0, 0, img.width, 60); x.restore(); }
  }
}

const rot = (x, y, a) => ({ x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) });
function frameOf(p, J, t) {
  if (p.moving) return J.run[Math.floor(t / 0.09) % 4];
  return J.idle[Math.floor(t / 0.5) % 2];
}
function swingOff(p) { if (!(p.swing > 0)) return 0; const k = 1 - p.swing / 8; return -1.4 + 2.6 * (1 - Math.pow(1 - k, 3)); }

export function drawPlayer(x, p, A, t, X, Y, face = p.face, weaponId) {
  const J = A.jobs[p.jobId], f = frameOf(p, J, t), hit = p.invuln > 0 && Math.floor(p.invuln / 2) % 2, pk = o => hit ? o.w : o.s;
  const wId = weaponId || (p.weapons[p.weapon] || p.weapons[0]).id, W = A.weapons[wId], Ar = J.A;
  const la = (face > 0 ? p.aim : Math.PI - p.aim) + swingOff(p);
  const N = { x: 1, y: -J.m.h + f.uy + 39 }, F = { x: -4, y: -J.m.h + f.uy + 37 };
  const h = rot(Ar.near.hand[0] - Ar.near.pivot[0] - (p.recoil || 0), Ar.near.hand[1] - Ar.near.pivot[1], la), H = { x: N.x + h.x, y: N.y + h.y };
  const tt = rot(9, -2, la), T = { x: H.x + tt.x, y: H.y + tt.y };
  const fang = Math.atan2(T.y - F.y, T.x - F.x) - Math.atan2(Ar.far.hand[1] - Ar.far.pivot[1], Ar.far.hand[0] - Ar.far.pivot[0]);
  x.fillStyle = 'rgba(0,0,0,.28)'; x.fillRect(X - 13, Y - 1, 26, 3); x.fillRect(X - 9, Y + 2, 18, 2);
  x.save(); x.translate(X, Y); if (face < 0) x.scale(-1, 1);
  x.save(); x.translate(T.x, T.y); x.rotate(fang); x.drawImage(pk(J.far), -Math.round(Ar.far.hand[0]), -Math.round(Ar.far.hand[1])); x.restore();
  x.drawImage(pk(f), -J.m.w / 2 - 4, -J.m.h);
  x.save(); x.translate(H.x, H.y); x.rotate(la); x.drawImage(pk(W), -Math.round(W.grip[0]), -Math.round(W.grip[1])); x.restore();
  x.save(); x.translate(T.x, T.y); x.rotate(fang); x.drawImage(pk(J.farHand), -Math.round(Ar.far.hand[0] - (Ar.far.w - J.HW)), -Math.round(Ar.far.hand[1])); x.restore();
  x.save(); x.translate(N.x, N.y); x.rotate(la); x.translate(-(p.recoil || 0), 0); x.drawImage(pk(J.near), -Math.round(Ar.near.pivot[0]), -Math.round(Ar.near.pivot[1])); x.restore();
  if (p.swing > 0 && p.swing < 5) { x.strokeStyle = 'rgba(255,255,240,.8)'; x.lineWidth = 3; x.beginPath(); x.arc(N.x, N.y, 50, la - 1.1, la + 0.2); x.stroke(); }
  x.restore();
}

function drawMon(x, m, A, camX, s) {
  const key = m.boss ? m.id : (MONSTERS[m.id]?.sprite || m.id), set = A.mons[m.id === 'thief' ? 'thief' : key];
  if (!set) return;
  const atk = m.boss && m.atkT > 0 && set.atk, fr = atk ? set.atk : set.run;
  const fi = atk ? Math.min(3, Math.floor((1 - m.atkT / 15) * 4)) : m.stun > 0 ? 0 : Math.floor(m.t * (m.boss ? 7 : 10)) % fr.length;
  const F = fr[fi], img = m.flash > 0 ? F.w : F.s, X = Math.round(m.x - camX), Y = Math.round(m.y), base = set.run[0].s.width, lift = m.fly ? 22 + Math.round(Math.sin(m.t * 6) * 2) : 0;
  x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(X - base * 0.35, Y - 1, base * 0.7, 3);
  x.save(); x.translate(X, 0); if (m.face < 0) x.scale(-1, 1); x.drawImage(img, Math.round(base / 2 - img.width), Y - img.height - lift); x.restore();
  const top = Y - set.run[0].s.height - lift;
  if (m.stun > 0) { x.fillStyle = '#7fd8ff'; x.fillRect(X - 2, top - 6, 4, 4); }
  if (m.boss || m.elite) { const W = m.boss ? 80 : 40, hy = top - 8; x.fillStyle = '#1a1410'; x.fillRect(X - W / 2 - 1, hy - 1, W + 2, 5); x.fillStyle = m.boss ? '#d84a3a' : '#e0b04a'; x.fillRect(X - W / 2, hy, Math.max(0, W * m.hp / m.maxHp), 3); }
  if (s.showInflict && MONSTERS[m.id]?.inflicts) { x.font = '10px sans-serif'; x.textAlign = 'center'; x.fillText(ICON[MONSTERS[m.id].inflicts.status] || '', X, top - 12); }
}
const ICON = { infection: '🦠', acidBurn: '🔥', poison: '☠️', wet: '💧', shock: '⚡', blur: '👁️', confusion: '😵', slip: '🧊', fear: '😨', stolen: '🎒' };

// 화면 효과(불꽃·연기 등). 상태와 따로 클라이언트에서만 움직인다
export function createFx() {
  const parts = [], rings = [], doors = new Map(), zaps = [];
  const puff = (x, y, col, n, sp, sz = 2) => { for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, v = sp * (0.4 + Math.random() * 0.6); parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.25 + Math.random() * 0.3, col, sz: sz + (Math.random() < 0.4) }); } };
  return {
    parts, rings, zaps,
    doorOpen: (x, top) => (doors.get(x + (top ? 't' : 'b')) || 0) > 0,
    feed(s) {
      for (const e of s.events) {
        if (e.type === 'hit') { const m = s.mons.find(o => o.uid === e.uid); if (m) { const h = HIT_FX[e.weapon] || HIT_FX._; puff(m.x, m.y - 14, h[0], h[1], h[2], h[3]); } }
        else if (e.type === 'kill') { puff(e.x, e.y - 14, '#6e5a4a', 14, 100); puff(e.x, e.y - 14, '#d9d4c4', 6, 60); this.shake = Math.max(this.shake || 0, 3); }
        else if (e.type === 'boom') { rings.push({ x: e.x, y: e.y, r: e.r, t: 0.3 }); puff(e.x, e.y, '#f2efe6', 16, 120, 3); this.shake = Math.max(this.shake || 0, 4); }
        else if (e.type === 'hurt') this.shake = Math.max(this.shake || 0, 3);
        else if (e.type === 'zap') zaps.push({ ...e, t: 0.15 });
        else if (e.type === 'bounce') puff(e.x, e.y, '#ffffff', 3, 50);
        else if (e.type === 'wave') for (const d of e.doors || []) doors.set(d.x + (d.top ? 't' : 'b'), 1.6);
      }
    },
    update(dt) {
      for (const p of parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.9; p.vy *= 0.9; p.life -= dt; }
      for (let i = parts.length - 1; i >= 0; i--) if (parts[i].life <= 0) parts.splice(i, 1);
      for (const r of rings) r.t -= dt; for (let i = rings.length - 1; i >= 0; i--) if (rings[i].t <= 0) rings.splice(i, 1);
      this.shake = Math.max(0, (this.shake || 0) - dt * 16);
      for (const [k, v] of doors) doors.set(k, v - dt);
      for (const z of zaps) z.t -= dt; for (let i = zaps.length - 1; i >= 0; i--) if (zaps[i].t <= 0) zaps.splice(i, 1);
    },
  };
}

// 맞은 자리 효과: [색, 개수, 퍼지는 속도, 크기]
const HIT_FX = { _: ['#ffe9a8', 4, 80, 2], slingshot: ['#a8a090', 4, 60, 2], crossbow: ['#e8dcb0', 3, 50, 2], lime: ['#f6f3ea', 8, 70, 3],
  coil: ['#9fe6ff', 6, 120, 2], net: ['#d8d0b0', 6, 60, 2], cool: ['#d8f4ff', 7, 70, 2], sprayer: ['#a8f0dc', 6, 70, 2], flash: ['#fff6b0', 8, 130, 2],
  water: ['#9fd4ff', 7, 90, 2], baton: ['#9fe6ff', 7, 110, 2], pipe: ['#ffe9a8', 5, 90, 2] };

// 무기마다 다른 투사체 모양(그리기만, 게임 규칙은 같음). 날아간 프레임 수는 게임 상태에 쓰지 않고 여기에만 둔다
const SHOT_AGE = new WeakMap();
function drawShot(x, sh, X, t) {
  const Y = sh.y, a = Math.atan2(sh.vy, sh.vx), age = SHOT_AGE.get(sh) + 1 || 1, R = Math.round; SHOT_AGE.set(sh, age);
  const back = k => ({ x: X - Math.cos(a) * k, y: Y - Math.sin(a) * k });
  switch (sh.weapon) {
    case 'slingshot': { // 돌멩이: 회색 조약돌, 흙먼지 꼬리
      x.fillStyle = 'rgba(150,140,120,.45)'; const b = back(6); x.fillRect(R(b.x) - 1, R(b.y) - 1, 2, 2);
      x.fillStyle = '#5a554c'; x.fillRect(R(X) - 2, R(Y) - 2, 5, 5); x.fillStyle = '#9a9384'; x.fillRect(R(X) - 2, R(Y) - 2, 3, 3); return; }
    case 'crossbow': { x.save(); x.translate(X, Y); x.rotate(a); x.fillStyle = '#c8b88a'; x.fillRect(-10, -1, 14, 2); x.fillStyle = '#e04a3a'; x.fillRect(-11, -2, 3, 4); x.fillStyle = '#9aa0a8'; x.fillRect(4, -2, 4, 4); x.restore(); return; }
    case 'lime': { // 석회 가루: 날아갈수록 퍼지는 하얀 가루 구름
      const r = 2 + Math.min(6, age * 0.5); x.fillStyle = 'rgba(246,243,234,.75)';
      for (let i = 0; i < 4; i++) { const o = (i * 2.3 + age * 0.7); x.fillRect(R(X + Math.cos(o) * r * 0.6) - 2, R(Y + Math.sin(o) * r * 0.6) - 2, 4, 4); }
      x.fillStyle = '#ffffff'; x.fillRect(R(X) - 1, R(Y) - 1, 3, 3); return; }
    case 'coil': { // 전기탄: 지그재그 번개 꼬리
      x.strokeStyle = '#7fd8ff'; x.lineWidth = 2; x.beginPath(); x.moveTo(X, Y);
      for (let i = 1; i <= 4; i++) { const b = back(i * 5), j = ((age + i) % 2 ? 3 : -3); x.lineTo(b.x - Math.sin(a) * j, b.y + Math.cos(a) * j); }
      x.stroke(); x.fillStyle = '#ffffff'; x.fillRect(R(X) - 2, R(Y) - 2, 4, 4); return; }
    case 'net': { // 감전 그물: 날아가며 펼쳐지는 그물, 네 귀퉁이 추
      const h = Math.min(9, 3 + age * 0.6); x.strokeStyle = '#d8d0b0'; x.lineWidth = 1; x.strokeRect(R(X - h), R(Y - h), h * 2, h * 2);
      x.beginPath(); x.moveTo(X - h, Y); x.lineTo(X + h, Y); x.moveTo(X, Y - h); x.lineTo(X, Y + h); x.stroke();
      x.fillStyle = '#5a5f66'; for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) x.fillRect(R(X + dx * h) - 1, R(Y + dy * h) - 1, 3, 3);
      if (age % 4 < 2) { x.fillStyle = '#7fd8ff'; x.fillRect(R(X) - 1, R(Y) - 1, 2, 2); } return; }
    case 'cool': { // 냉각 스프레이: 얼음 결정, 서리 꼬리
      x.fillStyle = 'rgba(220,245,255,.6)'; for (let i = 1; i <= 3; i++) { const b = back(i * 5); x.fillRect(R(b.x), R(b.y), 1, 1); }
      x.save(); x.translate(X, Y); x.rotate(a + Math.PI / 4); x.fillStyle = '#bfe8ff'; x.fillRect(-3, -3, 6, 6); x.fillStyle = '#ffffff'; x.fillRect(-1, -1, 2, 2); x.restore(); return; }
    case 'sprayer': { // 소독 분무기: 옥색 물방울과 안개
      x.fillStyle = 'rgba(143,224,204,.35)'; for (let i = 1; i <= 2; i++) { const b = back(i * 6); x.fillRect(R(b.x) - 1, R(b.y) - 1, 3, 3); }
      x.fillStyle = '#5ec2a8'; x.fillRect(R(X) - 2, R(Y) - 1, 4, 3); x.fillStyle = '#d8fff4'; x.fillRect(R(X) - 1, R(Y) - 2, 2, 2); return; }
    case 'flash': { // 손전등 섬광: 빛 구슬과 둥근 빛무리
      const g = x.createRadialGradient(X, Y, 0, X, Y, 10); g.addColorStop(0, 'rgba(255,250,200,.9)'); g.addColorStop(1, 'rgba(255,240,150,0)');
      x.fillStyle = g; x.fillRect(X - 10, Y - 10, 20, 20); x.fillStyle = '#ffffff'; x.fillRect(R(X) - 2, R(Y) - 2, 4, 4); return; }
    case 'water': { // 물총: 길쭉한 물줄기, 흔들리는 물방울
      const w = Math.sin(age * 0.8) * 1.5; x.save(); x.translate(X, Y + w); x.rotate(a);
      x.fillStyle = 'rgba(126,200,255,.5)'; x.fillRect(-9, -1, 8, 2); x.fillStyle = '#7ec8ff'; x.fillRect(-2, -2, 5, 4); x.fillStyle = '#e8f6ff'; x.fillRect(1, -1, 1, 1); x.restore(); return; }
    default: { const z = sh.size || 3; x.fillStyle = SHOT_COL[sh.weapon] || '#fff'; x.fillRect(R(X) - z / 2, R(Y) - z / 2, z, z); }
  }
}

export function cameraX(s) { return Math.max(0, Math.min(CAR_W - VIEW_W, s.player.x - VIEW_W / 2)); }

export function drawCar(x, s, A, fx, t) {
  const camX = Math.round(cameraX(s)), p = s.player;
  x.save();
  if (fx.shake > 0) x.translate(Math.round((Math.random() - 0.5) * fx.shake), Math.round((Math.random() - 0.5) * fx.shake));
  x.drawImage(carBackground(s.line, s.carType === 'boss', A), camX, 0, VIEW_W, VIEW_H, 0, 0, VIEW_W, VIEW_H);
  drawDoors(x, s, A, camX, fx);
  // 연결문: 잠기면 빨강, 열리면 초록
  if (s.carType !== 'boss') { const dx = CAR_W - camX - 12; x.fillStyle = '#6f7682'; x.fillRect(dx, 100, 12, 200); x.fillStyle = s.doorOpen ? '#5ad86a' : '#d85a4a'; x.fillRect(dx + 3, 190, 6, 20);
    x.fillStyle = '#6f7682'; x.fillRect(-camX, 100, 12, 200); }
  for (const z of s.zones) { x.fillStyle = ZONE_COL[z.kind] || 'rgba(200,200,200,.25)'; x.beginPath(); x.ellipse(z.x - camX, z.y, z.r, z.r * 0.55, 0, 0, 6.283); x.fill(); }
  for (const r of fx.rings) { x.strokeStyle = 'rgba(240,240,230,.8)'; x.lineWidth = 3; x.globalAlpha = r.t / 0.3; const k = 1.2 - (r.t / 0.3) * 0.6; x.beginPath(); x.ellipse(r.x - camX, r.y, r.r * k, r.r * 0.55 * k, 0, 0, 6.283); x.stroke(); x.globalAlpha = 1; }
  const list = [...s.mons.filter(m => !m.gone).map(m => ({ y: m.y, d: () => drawMon(x, m, A, camX, s) })), { y: p.y, d: () => drawPlayer(x, p, A, t, Math.round(p.x - camX), Math.round(p.y)) }];
  list.sort((a, b) => a.y - b.y).forEach(o => o.d());
  for (const a of s.allies) { const X = a.x - camX; if (a.kind === 'drone') { const f = A.mons.drone.run[Math.floor(t * 10) % 4].s; x.drawImage(f, Math.round(X - f.width / 2), Math.round(a.y - f.height / 2)); }
    else { x.fillStyle = '#5a5f66'; x.fillRect(X - 6, a.y - 4, 12, 18); x.fillStyle = '#c8783a'; x.fillRect(X - 4, a.y - 10, 8, 8); x.fillStyle = '#7fd8ff'; x.fillRect(X - 1, a.y - 8, 2, 2); } }
  if (p.beam) { const B = WEAPONS[p.beam], ox = p.x - camX + Math.cos(p.aim) * 16, oy = p.y - 24 + Math.sin(p.aim) * 16, ang = B.ang, len = B.len;
    x.fillStyle = BEAM_COL[p.beam]; x.beginPath(); x.moveTo(ox, oy); x.lineTo(ox + Math.cos(p.aim - ang) * len, oy + Math.sin(p.aim - ang) * len); x.lineTo(ox + Math.cos(p.aim + ang) * len, oy + Math.sin(p.aim + ang) * len); x.closePath(); x.fill(); }
  for (const sh of s.shots) {
    const X = sh.x - camX;
    if (sh.th) { const W = A.weapons[sh.weapon].s, z = Math.sin(Math.min(1, sh.t / sh.T) * Math.PI) * 40; x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(X - 4, sh.y, 8, 2);
      x.save(); x.translate(Math.round(X), Math.round(sh.y - z)); x.rotate(sh.t * 0.4); x.drawImage(W, -W.width / 2, -W.height / 2); x.restore(); continue; }
    drawShot(x, sh, X, t);
  }
  for (const e of s.eshots) { x.fillStyle = '#2a1a14'; x.fillRect(Math.round(e.x - camX) - 3, Math.round(e.y) - 3, 6, 6); x.fillStyle = e.electric ? '#7fd8ff' : e.col || '#ddd'; x.fillRect(Math.round(e.x - camX) - 2, Math.round(e.y) - 2, 4, 4); }
  // 연쇄 번개: 맞은 적에서 옆 적으로 튀는 지그재그 선
  for (const z of fx.zaps) { x.strokeStyle = '#bfefff'; x.lineWidth = 2; x.beginPath(); x.moveTo(z.x1 - camX, z.y1);
    for (let i = 1; i < 5; i++) { const k = i / 5; x.lineTo(z.x1 + (z.x2 - z.x1) * k - camX + (i % 2 ? 4 : -4), z.y1 + (z.y2 - z.y1) * k); } x.lineTo(z.x2 - camX, z.y2); x.stroke(); }
  for (const q of fx.parts) { x.globalAlpha = Math.min(1, q.life * 4); x.fillStyle = q.col; x.fillRect(Math.round(q.x - camX), Math.round(q.y), q.sz, q.sz); } x.globalAlpha = 1;
  x.restore();
  drawEnv(x, s, camX, t);
}

// 노선 환경 화면 효과: 정전(어둠), 시야 흐림, 폭염·한파 색, 비·모래
function drawEnv(x, s, camX, t) {
  const p = s.player, px = p.x - camX, py = p.y - 24, e = s.env;
  if (e?.dark && !s.lit) {
    const r = p.beam === 'led' ? 200 : 120, g = x.createRadialGradient(px, py, r * 0.4, px, py, r);
    g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.92)'); x.fillStyle = g; x.fillRect(0, 0, VIEW_W, VIEW_H);
  }
  if (p.status.blur) { const g = x.createRadialGradient(px, py, 40, px, py, 160); g.addColorStop(0, 'rgba(120,140,90,0)'); g.addColorStop(1, 'rgba(110,130,80,.85)'); x.fillStyle = g; x.fillRect(0, 0, VIEW_W, VIEW_H); }
  if (e?.status === 'heatstroke') { x.fillStyle = `rgba(255,140,40,${0.05 + p.meters.heat / 100 * 0.18})`; x.fillRect(0, 0, VIEW_W, VIEW_H); }
  if (e?.status === 'frostbite') { x.fillStyle = 'rgba(170,210,255,.12)'; x.fillRect(0, 0, VIEW_W, VIEW_H); }
  if (e?.status === 'wet' || e?.status === 'corrosion') { x.fillStyle = e.status === 'wet' ? 'rgba(160,200,255,.35)' : 'rgba(190,220,120,.35)';
    for (let i = 0; i < 40; i++) { const rx = (i * 97 + t * 300) % VIEW_W, ry = (i * 53 + t * 500) % VIEW_H; x.fillRect(rx, ry, 1, 6); } }
  if (e?.status === 'blur') { x.fillStyle = 'rgba(190,160,110,.18)'; x.fillRect(0, 0, VIEW_W, VIEW_H); x.fillStyle = 'rgba(210,180,120,.4)'; for (let i = 0; i < 50; i++) x.fillRect((i * 131 - t * 400) % VIEW_W + VIEW_W, (i * 37) % VIEW_H, 3, 1); }
}
export { DT, Y0, Y1 };
