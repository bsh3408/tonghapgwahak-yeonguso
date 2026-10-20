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
function carBackground(line, boss) {
  const key = line + (boss ? 'b' : '');
  if (bgCache[key]) return bgCache[key];
  const T = THEME[line] || THEME[9], c = document.createElement('canvas'); c.width = CAR_W; c.height = VIEW_H; const x = c.getContext('2d');
  let seed = line * 97; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  x.fillStyle = T.wall; x.fillRect(0, 0, CAR_W, 80); x.fillStyle = 'rgba(0,0,0,.2)'; x.fillRect(0, 0, CAR_W, 6);
  if (boss) { // 개찰구: 벽 대신 개찰기 줄
    for (let i = 0; i < 16; i++) { const gx = 40 + i * 100; x.fillStyle = '#9aa1ab'; x.fillRect(gx, 30, 30, 46); x.fillStyle = '#5a6070'; x.fillRect(gx + 4, 34, 22, 10); x.fillStyle = i % 3 ? '#7fd87f' : '#d85a4a'; x.fillRect(gx + 12, 50, 6, 6); }
  } else {
    for (let i = 0; i < 16; i++) { const wx = 28 + i * 100; x.fillStyle = '#8b93a0'; x.fillRect(wx - 4, 12, 68, 44); x.fillStyle = '#1b2533'; x.fillRect(wx, 16, 60, 36); x.fillStyle = '#2c3a4d'; x.fillRect(wx + 6, 20, 3, 28); }
    for (let i = 0; i < 31; i++) { const hx = 20 + i * 52; x.fillStyle = '#9aa1ab'; x.fillRect(hx, 60, 2, 8); x.fillRect(hx - 3, 68, 8, 2); x.fillRect(hx - 3, 68, 2, 6); x.fillRect(hx + 3, 68, 2, 6); x.fillRect(hx - 3, 72, 8, 2); }
  }
  x.fillStyle = T.seat; x.fillRect(0, 80, CAR_W, 20); x.fillRect(0, 300, CAR_W, 20); x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(0, 96, CAR_W, 4); x.fillRect(0, 300, CAR_W, 4);
  x.fillStyle = T.floor; x.fillRect(0, 100, CAR_W, 200);
  x.fillStyle = 'rgba(0,0,0,.08)'; for (let X = 0; X < CAR_W; X += 32) x.fillRect(X, 100, 1, 200); for (let Y = 100; Y < 300; Y += 32) x.fillRect(0, Y, CAR_W, 1);
  for (let i = 0; i < 400; i++) { x.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,.12)' : 'rgba(255,255,255,.08)'; x.fillRect(rnd() * CAR_W | 0, 102 + rnd() * 196 | 0, 1 + rnd() * 3 | 0, 1); }
  for (let i = 0; i < 24; i++) { const mx = rnd() * CAR_W | 0, my = 120 + rnd() * 160 | 0; x.fillStyle = 'rgba(90,110,60,.6)'; x.fillRect(mx, my, 8, 3); x.fillRect(mx + 2, my - 2, 4, 2); }
  x.fillStyle = '#2e333d'; x.fillRect(0, 320, CAR_W, 40);
  if (!boss) for (const dx of SIDE_DOORS) for (const y of [80, 300]) { x.fillStyle = '#6f7682'; x.fillRect(dx - 22, y, 44, 20); x.fillStyle = '#4a505c'; x.fillRect(dx - 1, y, 2, 20); x.fillStyle = '#c8b040'; x.fillRect(dx - 22, y + (y === 80 ? 17 : 0), 44, 3); }
  bgCache[key] = c; return c;
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
  const parts = [], rings = [];
  const puff = (x, y, col, n, sp, sz = 2) => { for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, v = sp * (0.4 + Math.random() * 0.6); parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.25 + Math.random() * 0.3, col, sz: sz + (Math.random() < 0.4) }); } };
  return {
    parts, rings,
    feed(s) {
      for (const e of s.events) {
        if (e.type === 'hit') { const m = s.mons.find(o => o.uid === e.uid); if (m) puff(m.x, m.y - 14, '#ffe9a8', 4, 80); }
        else if (e.type === 'kill') { puff(e.x, e.y - 14, '#6e5a4a', 14, 100); puff(e.x, e.y - 14, '#d9d4c4', 6, 60); this.shake = Math.max(this.shake || 0, 3); }
        else if (e.type === 'boom') { rings.push({ x: e.x, y: e.y, r: e.r, t: 0.3 }); puff(e.x, e.y, '#f2efe6', 16, 120, 3); this.shake = Math.max(this.shake || 0, 4); }
        else if (e.type === 'hurt') this.shake = Math.max(this.shake || 0, 3);
      }
    },
    update(dt) {
      for (const p of parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.9; p.vy *= 0.9; p.life -= dt; }
      for (let i = parts.length - 1; i >= 0; i--) if (parts[i].life <= 0) parts.splice(i, 1);
      for (const r of rings) r.t -= dt; for (let i = rings.length - 1; i >= 0; i--) if (rings[i].t <= 0) rings.splice(i, 1);
      this.shake = Math.max(0, (this.shake || 0) - dt * 16);
    },
  };
}

export function cameraX(s) { return Math.max(0, Math.min(CAR_W - VIEW_W, s.player.x - VIEW_W / 2)); }

export function drawCar(x, s, A, fx, t) {
  const camX = Math.round(cameraX(s)), p = s.player;
  x.save();
  if (fx.shake > 0) x.translate(Math.round((Math.random() - 0.5) * fx.shake), Math.round((Math.random() - 0.5) * fx.shake));
  x.drawImage(carBackground(s.line, s.carType === 'boss'), camX, 0, VIEW_W, VIEW_H, 0, 0, VIEW_W, VIEW_H);
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
    const col = SHOT_COL[sh.weapon] || '#fff';
    if (sh.weapon === 'crossbow') { x.save(); x.translate(X, sh.y); x.rotate(Math.atan2(sh.vy, sh.vx)); x.fillStyle = col; x.fillRect(-8, -1, 12, 2); x.fillStyle = '#777'; x.fillRect(3, -2, 3, 4); x.restore(); continue; }
    if (sh.weapon === 'net') { x.strokeStyle = col; x.lineWidth = 1; x.strokeRect(Math.round(X) - 5, Math.round(sh.y) - 5, 10, 10); continue; }
    const z = sh.size; x.fillStyle = col; x.globalAlpha = 0.5; x.fillRect(Math.round(X - sh.vx * 0.012) - z / 2, Math.round(sh.y - sh.vy * 0.012) - z / 2, z, z); x.globalAlpha = 1; x.fillRect(Math.round(X) - z / 2, Math.round(sh.y) - z / 2, z, z);
  }
  for (const e of s.eshots) { x.fillStyle = '#2a1a14'; x.fillRect(Math.round(e.x - camX) - 3, Math.round(e.y) - 3, 6, 6); x.fillStyle = e.electric ? '#7fd8ff' : e.col || '#ddd'; x.fillRect(Math.round(e.x - camX) - 2, Math.round(e.y) - 2, 4, 4); }
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
