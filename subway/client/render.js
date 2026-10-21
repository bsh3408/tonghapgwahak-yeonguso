// 칸 상태를 캔버스에 그린다(그리기만 하고 상태는 바꾸지 않는다)
import { CAR_W, VIEW_W, VIEW_H, Y0, Y1, DT } from '../sim/constants.js';
import { MONSTERS } from '../sim/data/monsters.js';
import { WEAPONS } from '../sim/data/weapons.js';
import { SIDE_DOORS, GANGWAY_Y } from '../sim/car.js';
import { STATUS } from '../sim/data/status.js';

const SHOT_COL = { slingshot: '#9a8a70', crossbow: '#c8b88a', lime: '#f2efe6', coil: '#7fd8ff', net: '#d8d0b0', cool: '#bfe8ff', sprayer: '#8fe0cc', flash: '#fff2a0', water: '#7ec8ff' };
const BEAM_COL = { co2: 'rgba(235,240,245,.5)', led: 'rgba(255,250,210,.32)', solar: 'rgba(255,224,120,.30)', nitrogen: 'rgba(200,240,255,.55)' };
const ZONE_COL = { acid: 'rgba(170,210,60,.35)', cloud: 'rgba(140,190,60,.28)', gas: 'rgba(180,170,90,.3)', electric: 'rgba(120,200,255,.3)', ice: 'rgba(200,235,255,.4)', puddle: 'rgba(230,228,215,.45)', disinfect: 'rgba(190,230,200,.25)', fire: 'rgba(255,120,40,.38)',
  heatVent: 'rgba(255,140,60,.30)', sparkBox: 'rgba(120,200,255,.30)', acidPool: 'rgba(170,210,60,.45)', vines: 'rgba(70,150,50,.30)', sporeMold: 'rgba(150,190,90,.35)',
  sandPile: 'rgba(210,180,120,.45)', icePatch: 'rgba(210,240,255,.55)', poisonPool: 'rgba(140,80,170,.42)' };
// 노선마다 바닥·벽 색(테마)
const THEME = {
  1: { wall: '#4a4440', floor: '#8f8670', seat: '#7a5a3a' }, 2: { wall: '#2e3440', floor: '#6f7178', seat: '#3d5a4a' }, 3: { wall: '#34424a', floor: '#6d7a80', seat: '#3d566a' },
  4: { wall: '#3c4038', floor: '#7d806a', seat: '#5a5f3a' }, 5: { wall: '#2c2f36', floor: '#5e6166', seat: '#4a3d4a' }, 6: { wall: '#5a4e3c', floor: '#a08e6a', seat: '#7a6a4a' },
  7: { wall: '#3c4a56', floor: '#a9b8c4', seat: '#4a6a7a' }, 8: { wall: '#334036', floor: '#6f7f60', seat: '#4f6a3a' }, 9: { wall: '#3a4150', floor: '#8a8574', seat: '#5d7a52' },
};
const bgCache = {};
const LINE_FILTER = { 1: 'sepia(.6) saturate(1.2) brightness(.92)', 2: 'saturate(.2) brightness(1.2) contrast(1.05)', 3: 'hue-rotate(15deg) saturate(.8) brightness(.82)',
  4: 'sepia(.65) hue-rotate(-25deg) saturate(1.6) brightness(.75)', 5: 'saturate(.3) brightness(1.1)', 6: 'sepia(.75) saturate(1.1) brightness(1.02)',
  7: 'saturate(.4) brightness(1.28) hue-rotate(-12deg)', 8: 'hue-rotate(38deg) saturate(1.2) brightness(.82)', 9: 'contrast(1.25) brightness(.72) saturate(.85)' };
const tintCache = new Map();
function tinted(img, line) {
  let m = tintCache.get(img); if (!m) tintCache.set(img, m = {});
  if (!m[line]) { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.filter = LINE_FILTER[line] || 'none'; x.drawImage(img, 0, 0); m[line] = c; }
  return m[line];
}
const lineParts = (A, line) => Object.fromEntries(Object.entries(A.subway).map(([k, v]) => [k, k === 'meta' ? v : tinted(v, line)]));
// 가까운 쪽(아래) 벽: 카메라가 이 벽 바깥 위에서 내려다보므로 안쪽 면은 안 보이고,
// 좌석 방석·등받이의 윗면 → 벽 윗면(창틀) → 차체 바깥 면(스테인리스·창·노선 띠)이 차례로 보인다
const NEAR_Y = 302;
function nearWall(x, line, seat) {
  const ny = NEAR_Y, inDoor = X => SIDE_DOORS.some(d => Math.abs(X - d) < 34);
  for (let X = 0; X < CAR_W; X += 26) { if (inDoor(X + 13)) continue;
    x.fillStyle = seat; x.fillRect(X + 1, ny - 4, 24, 9); x.fillStyle = 'rgba(255,255,255,.18)'; x.fillRect(X + 2, ny - 3, 22, 2);
    x.fillStyle = 'rgba(0,0,0,.35)'; x.fillRect(X + 1, ny + 5, 24, 5); x.fillStyle = 'rgba(0,0,0,.5)'; x.fillRect(X + 13, ny - 4, 1, 9); }
  x.fillStyle = '#c4cad2'; x.fillRect(0, ny + 10, CAR_W, 3); x.fillStyle = '#7d848d'; x.fillRect(0, ny + 13, CAR_W, 3);
  x.fillStyle = '#8d949c'; x.fillRect(0, ny + 16, CAR_W, VIEW_H - ny - 16);
  for (let X = 8; X < CAR_W - 8; X += 4) if (!inDoor(X)) { x.fillStyle = ((X / 4) | 0) % 9 === 0 ? '#9aa1a9' : '#141a24'; x.fillRect(X, ny + 20, 4, 14); }
  x.fillStyle = 'rgba(160,200,255,.25)'; for (let X = 12; X < CAR_W; X += 40) if (!inDoor(X)) x.fillRect(X, ny + 21, 6, 2);
  x.fillStyle = LINE_COLOR[line] || '#888'; x.fillRect(0, ny + 37, CAR_W, 4);
  x.fillStyle = '#6b7179'; x.fillRect(0, ny + 41, CAR_W, VIEW_H - ny - 41); x.fillStyle = '#4c5158'; for (let X = 0; X < CAR_W; X += 64) x.fillRect(X, ny + 41, 1, 20);
  for (const d of SIDE_DOORS) { x.fillStyle = '#e0b040'; x.fillRect(d - 30, ny + 7, 60, 3); }
}
// 노선 색(실제 서울 지하철 노선 색을 따름): 벽의 띠에 칠한다
export const LINE_COLOR = { 1: '#0052A4', 2: '#00A84D', 3: '#EF7C1C', 4: '#00A5DE', 5: '#996CAC', 6: '#CD7C2F', 7: '#747F00', 8: '#E6186C', 9: '#BDB092' };
// 객실 배경: AI로 그린 객실 부품(벽·의자·손잡이·출입문·바닥)을 이어 붙인다. 출입문은 그 위에 따로 그려서 여닫는다
function carBackground(line, boss, A, variant = 0, hazard = false) {
  const key = line + (boss ? 'b' : '') + ':' + variant + (hazard ? 'h' : '');
  if (bgCache[key]) return bgCache[key];
  const S = lineParts(A, line), M = S.meta, c = document.createElement('canvas'); c.width = CAR_W; c.height = VIEW_H; const x = c.getContext('2d');
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
    nearWall(x, line, (THEME[line] || THEME[2]).seat);
    x.drawImage(S.endDoor, 0, 100 - M.endDoor.h); x.drawImage(S.endDoor, CAR_W - M.endDoor.w, 100 - M.endDoor.h);
    lineDecor(x, line, variant);
    if (hazard) { x.fillStyle = 'rgba(200,40,30,.10)'; x.fillRect(0, 0, CAR_W, VIEW_H); x.fillStyle = '#d83a2a'; for (let X = 60; X < CAR_W; X += 120) x.fillRect(X, 4, 30, 5); }
  }
  bgCache[key] = c; return c;
}
// 호선마다 칸 꾸밈(코드로 찍은 도트). variant(칸 번호)로 자리를 바꿔 칸마다 조금씩 다르게
function lineDecor(x, line, v) {
  let r = (line * 7919 + v * 104729) >>> 0; const rnd = () => ((r = (r * 1103515245 + 12345) >>> 0) / 4294967296);
  const px = (c, X, Y, w, h) => { x.fillStyle = c; x.fillRect(Math.round(X), Math.round(Y), w, h); };
  const FY0 = 100, FY1 = 300;
  if (line === 1) for (let Y = FY0; Y < FY1; Y += 10) { px('rgba(120,78,40,.55)', 0, Y, CAR_W, 9); px('rgba(60,36,18,.6)', 0, Y + 9, CAR_W, 1); for (let X = (Y / 10 % 2) * 40; X < CAR_W; X += 80) px('rgba(60,36,18,.6)', X, Y, 1, 9); }
  if (line === 2) { px('rgba(200,210,225,.18)', 0, FY0, CAR_W, FY1 - FY0); for (let X = 0; X < CAR_W; X += 32) px('rgba(255,255,255,.08)', X, FY0, 1, FY1 - FY0); px('rgba(255,40,40,.08)', 0, 0, CAR_W, VIEW_H); }
  if (line === 3) { px('rgba(60,120,190,.28)', 0, FY0 + 20, CAR_W, FY1 - FY0 - 20); }
  if (line === 5) for (let X = 20; X < CAR_W; X += 70) { x.fillStyle = 'rgba(220,235,240,.28)'; x.fillRect(X, 0, 26, 100); x.fillStyle = 'rgba(255,255,255,.4)'; x.fillRect(X + 3, 0, 1, 100); }
  if (line === 6) { px('rgba(214,184,120,.35)', 0, FY0, CAR_W, FY1 - FY0); }
  if (line === 7) { px('rgba(225,242,255,.30)', 0, FY0, CAR_W, FY1 - FY0); }
  if (line === 8) for (let i = 0; i < 14; i++) { x.fillStyle = 'rgba(80,150,60,.45)'; x.beginPath(); x.ellipse(rnd() * CAR_W, FY0 + 10 + rnd() * 180, 20 + rnd() * 26, 8 + rnd() * 6, 0, 0, 6.283); x.fill(); }
  if (line === 9) { px('rgba(20,10,10,.25)', 0, FY0, CAR_W, FY1 - FY0); for (let i = 0; i < 3; i++) { const X = 60 + rnd() * (CAR_W - 120); x.fillStyle = 'rgba(255,140,40,.18)'; x.beginPath(); x.ellipse(X, FY0 + 40 + rnd() * 120, 46, 20, 0, 0, 6.283); x.fill(); } }
  switch (line) {
    case 1: // 오래된 지상 구간·폭염: 깨진 창으로 들어오는 햇빛 줄기, 금 간 바닥
      for (let i = 0; i < 4; i++) { const X = 40 + rnd() * (CAR_W - 120); x.fillStyle = 'rgba(255,220,120,.13)'; x.beginPath(); x.moveTo(X, 100); x.lineTo(X + 40, 100); x.lineTo(X + 90, 300); x.lineTo(X + 50, 300); x.fill(); }
      for (let i = 0; i < 6; i++) { let X = rnd() * CAR_W, Y = 120 + rnd() * 170; x.strokeStyle = 'rgba(40,30,20,.5)'; x.lineWidth = 1; x.beginPath(); x.moveTo(X, Y); for (let k = 0; k < 4; k++) { X += 6 + rnd() * 8; Y += (rnd() - 0.5) * 10; x.lineTo(X, Y); } x.stroke(); } break;
    case 2: // 도심 순환선·정전: 꺼진 조명, 흩어진 신문지와 깨진 형광등
      x.fillStyle = '#1a1c20'; for (let X = 30; X < CAR_W; X += 120) if (rnd() < 0.6) x.fillRect(X, 6, 60, 3);
      for (let i = 0; i < 7; i++) px('rgba(220,215,200,.55)', rnd() * CAR_W, 120 + rnd() * 170, 7, 5);
      for (let i = 0; i < 3; i++) { const X = rnd() * CAR_W, Y = 130 + rnd() * 150; for (let k = 0; k < 5; k++) px('#cfe6f0', X + k * 3 + rnd() * 2, Y + rnd() * 3, 2, 1); } break;
    case 3: // 강 건너는 구간·침수: 바닥에 고인 물과 물결
      x.fillStyle = 'rgba(80,140,200,.22)'; x.fillRect(0, 230, CAR_W, 70);
      for (let i = 0; i < 18; i++) px('rgba(200,230,255,.45)', rnd() * CAR_W, 236 + rnd() * 60, 6 + rnd() * 6, 1);
      for (let i = 0; i < 4; i++) { x.fillStyle = 'rgba(80,140,200,.25)'; x.beginPath(); x.ellipse(rnd() * CAR_W, 140 + rnd() * 80, 18 + rnd() * 14, 6, 0, 0, 6.283); x.fill(); } break;
    case 4: // 매연 구간·산성비: 녹물 자국, 바닥의 매연 얼룩
      for (let i = 0; i < 8; i++) { const X = rnd() * CAR_W; x.fillStyle = 'rgba(150,90,40,.45)'; x.fillRect(X, 40 + rnd() * 30, 3, 20 + rnd() * 30); }
      for (let i = 0; i < 6; i++) { x.fillStyle = 'rgba(60,70,40,.25)'; x.beginPath(); x.ellipse(rnd() * CAR_W, 130 + rnd() * 160, 20 + rnd() * 20, 8 + rnd() * 6, 0, 0, 6.283); x.fill(); } break;
    case 5: // 깊은 지하·감염병: 곰팡이 얼룩과 출입 통제 테이프
      for (let i = 0; i < 9; i++) { const X = rnd() * CAR_W, Y = rnd() < 0.5 ? 20 + rnd() * 70 : 120 + rnd() * 170; for (let k = 0; k < 6; k++) px(k % 2 ? 'rgba(120,160,70,.55)' : 'rgba(110,80,130,.5)', X + (rnd() - 0.5) * 14, Y + (rnd() - 0.5) * 8, 3, 3); }
      { const X = 60 + rnd() * (CAR_W - 200); for (let k = 0; k < 24; k++) px(k % 2 ? '#1c1c1c' : '#e8c830', X + k * 5, 70 + k * 1.2, 5, 4); } break;
    case 6: // 지상 환기구·모래 폭풍: 벽 쪽에 쌓인 모래 더미
      for (let i = 0; i < 7; i++) { x.fillStyle = 'rgba(214,184,120,.55)'; x.beginPath(); x.ellipse(rnd() * CAR_W, rnd() < 0.5 ? 122 : 292, 30 + rnd() * 30, 10, 0, 0, 6.283); x.fill(); }
      for (let i = 0; i < 40; i++) px('rgba(230,200,140,.5)', rnd() * CAR_W, 120 + rnd() * 175, 2, 1); break;
    case 7: // 냉동 창고·한파: 벽에 낀 성에, 천장의 고드름, 얼어붙은 바닥
      x.fillStyle = 'rgba(230,245,255,.35)'; x.fillRect(0, 0, CAR_W, 12);
      for (let X = 4; X < CAR_W; X += 9 + rnd() * 10) { const h = 4 + rnd() * 14; x.fillStyle = 'rgba(220,240,255,.85)'; x.beginPath(); x.moveTo(X, 12); x.lineTo(X + 4, 12); x.lineTo(X + 2, 12 + h); x.fill(); }
      for (let i = 0; i < 5; i++) { x.fillStyle = 'rgba(220,240,255,.28)'; x.beginPath(); x.ellipse(rnd() * CAR_W, 130 + rnd() * 160, 26 + rnd() * 20, 9, 0, 0, 6.283); x.fill(); } break;
    case 8: // 생태 공원 연결: 벽을 타고 오르는 덩굴과 바닥의 풀
      for (let i = 0; i < 6; i++) { let X = rnd() * CAR_W, Y = 96; x.strokeStyle = '#3f7a32'; x.lineWidth = 2; x.beginPath(); x.moveTo(X, Y); for (let k = 0; k < 7; k++) { X += (rnd() - 0.5) * 12; Y -= 10; x.lineTo(X, Y); px('#5fae48', X - 2, Y, 4, 3); } x.stroke(); }
      for (let i = 0; i < 26; i++) { const X = rnd() * CAR_W, Y = rnd() < 0.5 ? 118 + rnd() * 10 : 286 + rnd() * 10; px('#4f9a3c', X, Y - 4, 1, 4); px('#6cc052', X + 2, Y - 6, 1, 6); } break;
    case 9: // 급행·약탈자: 벽 낙서와 바닥에 그린 경고선
      for (let i = 0; i < 5; i++) { const X = 20 + rnd() * (CAR_W - 60), c = ['#e0483a', '#e8c830', '#58b8e8', '#d060c0'][i % 4]; x.strokeStyle = c; x.lineWidth = 2; x.beginPath(); x.moveTo(X, 60); for (let k = 0; k < 5; k++) x.lineTo(X + k * 7, 52 + (k % 2) * 14); x.stroke(); }
      for (let k = 0; k < 20; k++) px(k % 2 ? '#1c1c1c' : '#e8c830', 40 + k * 22, 206, 12, 3); break;
  }
}
function T_GATES(x) {
  x.fillStyle = '#3a4150'; x.fillRect(0, 0, CAR_W, 100); x.fillStyle = '#2e333d'; x.fillRect(0, 300, CAR_W, 60);
  for (let i = 0; i < 11; i++) { const gx = 40 + i * 92; x.fillStyle = '#9aa1ab'; x.fillRect(gx, 30, 30, 70); x.fillStyle = '#5a6070'; x.fillRect(gx + 4, 34, 22, 10); x.fillStyle = i % 3 ? '#7fd87f' : '#d85a4a'; x.fillRect(gx + 12, 50, 6, 6); }
}
// 출입문(위·아래): 웨이브가 들어올 때 그 문만 잠깐 열린다
function drawDoors(x, s, A, camX, fx) {
  if (s.carType === 'boss') return;
  const S = lineParts(A, s.line), M = S.meta;
  for (const dx of SIDE_DOORS) for (const top of [true, false]) {
    const open = fx.doorOpen?.(dx, top), img = open ? S.doorOpen : S.doorClosed, w = open ? M.doorOpen.w : M.doorClosed.w;
    const X = Math.round(dx - camX - w / 2);
    if (X > VIEW_W || X + w < 0) continue;
    if (top) x.drawImage(img, X, 100 - img.height + 4);
    else { const cx = Math.round(dx - camX), y0 = NEAR_Y + 16, sh = open ? 18 : 0;
      x.fillStyle = '#14161a'; x.fillRect(cx - 24, y0, 48, VIEW_H - y0);
      for (const sd of [-1, 1]) { const px0 = sd < 0 ? cx - 24 - sh : cx + sh; x.fillStyle = '#a9b0b8'; x.fillRect(px0, y0, 24, VIEW_H - y0); x.fillStyle = '#5a616b'; x.fillRect(sd < 0 ? px0 + 23 : px0, y0, 1, VIEW_H - y0);
        x.fillStyle = '#1c2430'; x.fillRect(px0 + 6, y0 + 4, 12, 16); x.fillStyle = '#e0b040'; x.fillRect(px0, VIEW_H - 6, 24, 2); } }
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
  if (m.elite) { const g = x.createRadialGradient(X, Y - 10, 4, X, Y - 10, base * 0.8); g.addColorStop(0, 'rgba(255,150,40,.45)'); g.addColorStop(1, 'rgba(255,120,30,0)'); x.fillStyle = g; x.fillRect(X - base, Y - 10 - base, base * 2, base * 2); }
  x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(X - base * 0.35, Y - 1, base * 0.7, 3);
  x.save(); x.translate(X, 0); if (m.face < 0) x.scale(-1, 1); x.drawImage(img, Math.round(base / 2 - img.width), Y - img.height - lift); x.restore();
  const top = Y - set.run[0].s.height - lift;
  if (m.stun > 0) { x.fillStyle = '#7fd8ff'; x.fillRect(X - 2, top - 6, 4, 4); }
  if (m.windT > 0 || (m.boss && m.atkT > 0)) { x.font = 'bold 16px sans-serif'; x.textAlign = 'center'; x.lineWidth = 3; x.strokeStyle = '#000'; x.strokeText('!', X, top - 8); x.fillStyle = '#ff3a2a'; x.fillText('!', X, top - 8); }
  if (m.boss || m.elite) { const W = m.boss ? 80 : 40, hy = top - 8; x.fillStyle = '#1a1410'; x.fillRect(X - W / 2 - 1, hy - 1, W + 2, 5); x.fillStyle = m.boss ? '#d84a3a' : '#e0b04a'; x.fillRect(X - W / 2, hy, Math.max(0, W * m.hp / m.maxHp), 3); }
  if (m.windT > 0 && !m.boss) { const p = s.player, a = MONSTERS[m.id]?.kind === 'ranged' ? Math.atan2(p.y - 24 - (Y - 20 - lift), p.x - camX - X) : m.dashA, L = MONSTERS[m.id]?.kind === 'ranged' ? 180 : 120;
    x.save(); x.strokeStyle = `rgba(255,50,40,${0.35 + 0.4 * Math.abs(Math.sin(m.windT * 30))})`; x.lineWidth = 2; x.setLineDash([6, 4]); x.beginPath(); x.moveTo(X, Y - 20 - lift); x.lineTo(X + Math.cos(a) * L, Y - 20 - lift + Math.sin(a) * L); x.stroke(); x.restore(); }
  if (s.showInflict && MONSTERS[m.id]?.inflicts) { x.font = '10px sans-serif'; x.textAlign = 'center'; x.fillText(ICON[MONSTERS[m.id].inflicts.status] || '', X, top - 12); }
}
const STATUS_COL = { infection: '#a8e05a', acidBurn: '#ff8a3a', poison: '#c070e0', wet: '#7ec8ff', shock: '#ffe84a', blur: '#d8c890', confusion: '#ff80c0', slip: '#bfe8ff', fear: '#ffb0a0', heatstroke: '#ff6a3a', frostbite: '#a8d8ff', corrosion: '#c8e060' };
const ICON = { infection: '🦠', acidBurn: '🔥', poison: '☠️', wet: '💧', shock: '⚡', blur: '👁️', confusion: '😵', slip: '🧊', fear: '😨', stolen: '🎒' };

// 화면 효과(불꽃·연기 등). 상태와 따로 클라이언트에서만 움직인다
export function createFx() {
  const parts = [], rings = [], doors = new Map(), zaps = [], nums = [], pops = [], dot = new Map();
  const puff = (x, y, col, n, sp, sz = 2) => { for (let i = 0; i < n; i++) { const a = Math.random() * 6.283, v = sp * (0.4 + Math.random() * 0.6); parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.25 + Math.random() * 0.3, col, sz: sz + (Math.random() < 0.4) }); } };
  return {
    parts, rings, zaps, nums, pops,
    doorOpen: (x, top) => (doors.get(x + (top ? 't' : 'b')) || 0) > 0,
    feed(s) {
      for (const e of s.events) {
        if (e.type === 'hit') { const m = s.mons.find(o => o.uid === e.uid); if (m) {
          // 줄기 무기처럼 틱마다 조금씩 들어가는 피해는 모았다가 1 이상이 되면 숫자로 띄운다
          const acc = (dot.get(m.uid) || 0) + e.amount; if (acc >= 1) { const v = Math.floor(acc); dot.set(m.uid, acc - v); nums.push({ x: m.x + (Math.random() - 0.5) * 26, y: m.y - (m.fly ? 30 : 0) - 2 * (m.r || 14) - 4 - Math.random() * 10, text: String(v), col: v >= 15 ? '#ffd04a' : '#ffffff', big: v >= 15, t: 0.7, T: 0.7 }); } else dot.set(m.uid, acc);
          if (e.amount >= 1 || Math.random() < 0.2) { const h = HIT_FX[e.weapon] || HIT_FX._; puff(m.x, m.y - 14, h[0], h[1], h[2], h[3]); } } }
        else if (e.type === 'kill') { puff(e.x, e.y - 14, '#6e5a4a', 14, 100); puff(e.x, e.y - 14, '#d9d4c4', 6, 60); this.shake = Math.max(this.shake || 0, 3); }
        else if (e.type === 'boom') { rings.push({ x: e.x, y: e.y, r: e.r, t: 0.3 }); puff(e.x, e.y, { co2: '#ffffff', electric: '#9fe6ff', ice: '#c8ecff' }[e.kind] || '#f2efe6', e.kind ? 30 : 16, 120, 3); this.shake = Math.max(this.shake || 0, 4); }
        else if (e.type === 'parry') { puff(e.x, e.y, '#ffffff', 10 + e.n * 3, 150, 2); rings.push({ x: e.x, y: e.y + 24, r: 18, t: 0.2 }); }
        else if (e.type === 'enrage') { this.shake = Math.max(this.shake || 0, 8); this.enrage = 1; }
        else if (e.type === 'hurt') { this.shake = Math.max(this.shake || 0, 3); nums.push({ x: s.player.x, y: s.player.y - 44, text: '-' + e.amount, col: '#ff5a4a', big: true, t: 0.8, T: 0.8 }); }
        else if (e.type === 'status' && STATUS[e.status] && e.status !== 'stolen') { if (!pops.some(q => q.key === e.status && q.t > 0.6)) pops.push({ key: e.status, text: `${STATUS[e.status].icon} ${STATUS[e.status].name}!`, col: STATUS_COL[e.status] || '#fff', t: 1.4, T: 1.4, row: pops.filter(q => q.t > 0).length % 3 }); }
        else if (e.type === 'blizzard') this.blizzard = 0.7;
        else if (e.type === 'freeze') { const m = s.mons.find(o => o.uid === e.uid); if (m) puff(m.x, m.y - 14, '#d8f4ff', 8, 70); }
        else if (e.type === 'zap') zaps.push({ ...e, t: 0.15 });
        else if (e.type === 'bounce') puff(e.x, e.y, '#ffffff', 3, 50);
        else if (e.type === 'wave') for (const d of e.doors || []) { if (d.kind === 'back' || d.kind === 'front') doors.set(d.kind + 't', 1.6); else if (d.kind === 'side') doors.set(d.x + (d.top ? 't' : 'b'), 1.6); }
        else if (e.type === 'propBreak') { puff(e.x, e.y - 12, '#b9844a', 12, 90, 3); this.shake = Math.max(this.shake || 0, 2); }
        else if (e.type === 'land') puff(e.x, e.y, '#9a9384', 8, 60);
      }
    },
    update(dt) {
      for (const p of parts) { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.9; p.vy *= 0.9; p.life -= dt; }
      for (let i = parts.length - 1; i >= 0; i--) if (parts[i].life <= 0) parts.splice(i, 1);
      for (const r of rings) r.t -= dt; for (let i = rings.length - 1; i >= 0; i--) if (rings[i].t <= 0) rings.splice(i, 1);
      this.shake = Math.max(0, (this.shake || 0) - dt * 16);
      for (const [k, v] of doors) doors.set(k, v - dt);
      for (const L of [nums, pops]) { for (const n of L) n.t -= dt; for (let i = L.length - 1; i >= 0; i--) if (L[i].t <= 0) L.splice(i, 1); }
      this.slide = Math.max(0, (this.slide || 0) - dt / 0.55); this.blizzard = Math.max(0, (this.blizzard || 0) - dt); this.enrage = Math.max(0, (this.enrage || 0) - dt);
      for (const z of zaps) z.t -= dt; for (let i = zaps.length - 1; i >= 0; i--) if (zaps[i].t <= 0) zaps.splice(i, 1);
    },
  };
}

// 맞은 자리 효과: [색, 개수, 퍼지는 속도, 크기]
const HIT_FX = { _: ['#ffe9a8', 4, 80, 2], slingshot: ['#a8a090', 4, 60, 2], crossbow: ['#e8dcb0', 3, 50, 2], lime: ['#f6f3ea', 8, 70, 3],
  coil: ['#9fe6ff', 6, 120, 2], net: ['#d8d0b0', 6, 60, 2], cool: ['#d8f4ff', 7, 70, 2], sprayer: ['#a8f0dc', 6, 70, 2], flash: ['#fff6b0', 8, 130, 2],
  water: ['#9fd4ff', 7, 90, 2], bash: ['#ffffff', 9, 140, 2], baton: ['#9fe6ff', 7, 110, 2], pipe: ['#ffe9a8', 5, 90, 2] };

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
    case 'railgun': { // 레일건: 길게 늘어지는 파란 섬광
      x.save(); x.translate(X, Y); x.rotate(a); x.fillStyle = 'rgba(120,200,255,.45)'; x.fillRect(-40, -2, 40, 4); x.fillStyle = '#e8f8ff'; x.fillRect(-14, -1, 18, 2); x.restore(); return; }
    case 'sonic': { // 음파 대포: 퍼지는 고리
      const r0 = 5 + Math.min(10, age * 0.8); x.strokeStyle = 'rgba(200,230,255,.8)'; x.lineWidth = 2; x.beginPath(); x.arc(X - Math.cos(a) * r0, Y - Math.sin(a) * r0, r0, a - 0.9, a + 0.9); x.stroke(); return; }
    case 'missile': { // 미사일: 빨간 탄두와 연기
      x.fillStyle = 'rgba(200,200,200,.5)'; for (let i = 1; i <= 3; i++) { const b = back(i * 5); x.fillRect(R(b.x) - 1, R(b.y) - 1, 3, 3); }
      x.save(); x.translate(X, Y); x.rotate(a); x.fillStyle = '#ddd'; x.fillRect(-5, -2, 8, 4); x.fillStyle = '#d83a2a'; x.fillRect(3, -2, 3, 4); x.fillStyle = '#ffb040'; x.fillRect(-7, -1, 2, 2); x.restore(); return; }
    case 'laser': { // 레이저: 빨간 광선 토막
      x.save(); x.translate(X, Y); x.rotate(a); x.fillStyle = 'rgba(255,60,60,.5)'; x.fillRect(-18, -2, 20, 4); x.fillStyle = '#ffd0d0'; x.fillRect(-16, -1, 18, 2); x.restore(); return; }
    case 'sticky': { // 점착 폭탄: 초록 젤 덩어리, 붙으면 깜박임
      const blink = sh.fuse !== undefined && Math.floor(sh.fuse / 4) % 2; x.fillStyle = '#1c2a10'; x.fillRect(R(X) - 4, R(Y) - 4, 8, 8); x.fillStyle = blink ? '#ff5040' : '#8ad040'; x.fillRect(R(X) - 3, R(Y) - 3, 6, 6); return; }
    case 'water': { // 물총: 길쭉한 물줄기, 흔들리는 물방울
      const w = Math.sin(age * 0.8) * 1.5; x.save(); x.translate(X, Y + w); x.rotate(a);
      x.fillStyle = 'rgba(126,200,255,.5)'; x.fillRect(-9, -1, 8, 2); x.fillStyle = '#7ec8ff'; x.fillRect(-2, -2, 5, 4); x.fillStyle = '#e8f6ff'; x.fillRect(1, -1, 1, 1); x.restore(); return; }
    default: { const z = sh.size || 3; x.fillStyle = SHOT_COL[sh.weapon] || '#fff'; x.fillRect(R(X) - z / 2, R(Y) - z / 2, z, z); }
  }
}

// 칸 양 끝: 실제 전동차처럼 주름 통로(밸로스)로 옆 칸과 이어진다. 통로 너머로 옆 칸이 어둡게 보인다
// 몬스터가 들어올 때 양 끝 문이 열리고, 앞쪽 문 불빛은 잠김(빨강)/열림(초록)
const GAP = 52, PY0 = GANGWAY_Y[0] - 18, PY1 = GANGWAY_Y[1] + 14;
function drawLinks(x, s, A, camX, fx, bg) {
  if (s.carType === 'boss') return;
  for (const side of [-1, 1]) {   // 옆 칸(같은 노선, 어둡게)
    const X = side < 0 ? -camX - GAP - CAR_W : -camX + CAR_W + GAP;
    if (X > VIEW_W || X + CAR_W < 0) continue;
    x.drawImage(bg, X, 0); x.fillStyle = 'rgba(8,10,14,.55)'; x.fillRect(X, 0, CAR_W, VIEW_H);
  }
  for (const [gx, kind] of [[-GAP, 'back'], [CAR_W, 'front']]) {
    const X = Math.round(gx - camX); if (X > VIEW_W || X + GAP < 0) continue;
    x.fillStyle = '#121418'; x.fillRect(X, 0, GAP, VIEW_H);
    for (let i = 0; i < GAP; i += 4) { const c = (i / 4) % 2 ? '#3d424b' : '#2a2d34'; x.fillStyle = c; x.fillRect(X + i, 58, 4, PY0 - 58); x.fillRect(X + i, PY1, 4, 330 - PY1); }
    x.fillStyle = '#596069'; x.fillRect(X, PY0 - 4, GAP, 4); x.fillRect(X, PY1, GAP, 4);
    x.fillStyle = '#6b717b'; x.fillRect(X, PY0, GAP, PY1 - PY0);
    x.fillStyle = '#545a64'; for (let y = PY0 + 4; y < PY1 - 2; y += 7) for (let k = ((y / 7) | 0) % 2 ? 3 : 0; k < GAP - 2; k += 7) x.fillRect(X + k, y, 3, 2);
    x.fillStyle = '#c8b040'; x.fillRect(X, PY0, GAP, 2); x.fillRect(X, PY1 - 2, GAP, 2);
  }
  // 칸 끝 문틀: 닫히면 문짝, 열리면 통로가 보인다
  for (const [ex, kind] of [[0, 'back'], [CAR_W, 'front']]) {
    const open = fx.doorOpen?.(kind, true) || (kind === 'front' && s.doorOpen), X = Math.round(ex - camX) + (kind === 'back' ? -6 : 0);
    x.fillStyle = '#8a919b'; x.fillRect(X, PY0 - 22, 6, PY1 - PY0 + 26); x.fillStyle = '#2a2d33'; x.fillRect(X, PY0 - 26, 6, 4);
    if (!open) { const dx = kind === 'back' ? X - 14 : X + 6; x.fillStyle = '#9aa1ab'; x.fillRect(dx, PY0 - 18, 14, PY1 - PY0 + 18); x.fillStyle = '#2c3440'; x.fillRect(dx + 3, PY0 - 10, 8, 26); x.fillStyle = '#4a5260'; x.fillRect(dx + 4, PY0 - 9, 3, 24); }
    x.fillStyle = kind === 'front' ? (s.doorOpen ? '#5ad86a' : '#d85a4a') : '#c8b040'; x.fillRect(X + 1, PY0 - 34, 4, 6);
  }
}
// 소품(코드로 찍은 도트): 나무 상자, 쓰레기통, 부서진 의자, 폭발 드럼통
function drawProp(x, o, camX, A) {
  const X = Math.round(o.x - camX), Y = Math.round(o.y), f = o.flash > 0, R = (c, a, b, w, h) => { x.fillStyle = f ? '#fff' : c; x.fillRect(X + a, Y + b, w, h); };
  x.fillStyle = 'rgba(0,0,0,.28)'; x.fillRect(X - o.r, Y - 1, o.r * 2, 3);
  if (o.kind === 'crate') { R('#2a1c10', -13, -24, 26, 24); R('#9a6a3a', -12, -23, 24, 22); R('#7a5028', -12, -16, 24, 3); R('#7a5028', -12, -8, 24, 3); R('#b9844a', -10, -22, 3, 20); R('#b9844a', 7, -22, 3, 20); }
  else if (o.kind === 'bin') { R('#1c2024', -10, -22, 20, 22); R('#5a7088', -9, -21, 18, 20); R('#46586c', -9, -14, 18, 2); R('#8aa0b8', -10, -24, 20, 4); }
  else if (o.kind === 'seat') { const b = A?.subway?.bench; if (b) { x.save(); if (f) x.filter = 'brightness(3)'; x.drawImage(b, 0, 0, 58, b.height, X - 29, Y - b.height + 6, 58, b.height); x.restore(); } else R('#4a7a78', -24, -14, 48, 14); }
  else if (o.kind === 'woodPile') { R('#2a1a0c', -16, -26, 32, 26); R('#8a5a2a', -15, -25, 14, 12); R('#9a6a34', 1, -25, 14, 12); R('#7a4c22', -12, -13, 26, 12); R('#5a3818', -12, -8, 26, 2); R('#b9844a', -14, -24, 12, 2); }
  else if (o.kind === 'adBoard') { R('#1c1f24', -18, -22, 36, 22); R('#30394a', -16, -20, 32, 16); R('#5a7ab0', -14, -18, 12, 6); R('#e08a3a', 0, -14, 12, 6); R('#d8e4f0', -6, -20, 1, 16); R('#d8e4f0', -6, -12, 10, 1); R('#3a3e46', -16, -4, 32, 4); }
  else if (o.kind === 'junkPile') { R('#22262a', -17, -14, 34, 14); R('#3a6a9a', -15, -18, 12, 10); R('#d8d8c8', -4, -22, 8, 12); R('#7a9a3a', 4, -16, 12, 10); R('#c84a3a', -10, -10, 8, 6); R('#e8e0a0', 8, -8, 6, 5); }
  else if (o.kind === 'rustPanel') { R('#2a160c', -17, -30, 34, 30); R('#8a4a22', -16, -29, 32, 28); R('#a8622c', -16, -29, 32, 3); R('#5a2e14', -6, -22, 10, 14); for (const [a, b] of [[-13, -26], [11, -26], [-13, -5], [11, -5]]) R('#c8a070', a, b, 2, 2); }
  else if (o.kind === 'vinylCurtain') { R('#5a616b', -17, -36, 2, 36); R('#5a616b', 15, -36, 2, 36); R('#5a616b', -17, -36, 34, 2); x.fillStyle = f ? '#fff' : 'rgba(210,235,245,.55)'; x.fillRect(X - 15, Y - 34, 30, 32); R('#e8c830', -15, -20, 30, 3); R('#1c1c1c', -9, -20, 4, 3); R('#1c1c1c', 1, -20, 4, 3); R('#1c1c1c', 11, -20, 4, 3); }
  else if (o.kind === 'sandbag') { for (const [a, b] of [[-17, -10], [-5, -10], [7, -10], [-11, -19], [1, -19]]) { R('#6a5a3a', a, b, 12, 9); R('#c8ae78', a + 1, b + 1, 10, 6); R('#a88e58', a + 1, b + 5, 10, 1); } }
  else if (o.kind === 'iceBlock') { x.fillStyle = f ? '#fff' : 'rgba(190,230,255,.85)'; x.fillRect(X - 15, Y - 26, 30, 26); R('#e8f8ff', -13, -24, 10, 3); R('#e8f8ff', -13, -24, 3, 10); x.fillStyle = 'rgba(120,180,220,.8)'; x.fillRect(X - 15, Y - 4, 30, 4); R('#ffffff', 6, -18, 2, 2); }
  else if (o.kind === 'bush') { for (const [a, b, w] of [[-17, -16, 16], [-6, -26, 16], [3, -16, 15], [-12, -10, 26]]) { R('#1e3a16', a - 1, b - 1, w + 2, 14); R('#3f7a32', a, b, w, 12); R('#5fae48', a + 2, b + 1, w - 6, 4); } R('#c84a5a', -2, -20, 3, 3); }
  else if (o.kind === 'tireWall') { for (const [a, b] of [[-17, -12], [-3, -12], [-10, -22], [4, -22]]) { R('#0c0c0e', a, b, 14, 11); R('#2a2a2e', a + 2, b + 2, 10, 7); R('#0c0c0e', a + 5, b + 4, 4, 3); } R('#e8c830', -18, -27, 36, 3); R('#1c1c1c', -12, -27, 5, 3); R('#1c1c1c', 2, -27, 5, 3); }
  else if (o.kind === 'pole') { R('#7a808a', -2, 100 - Y, 5, Y - 100); R('#e4e8ee', -1, 100 - Y, 1, Y - 100); R('#4a4f58', -4, -3, 9, 4); }
  else if (o.kind === 'rubble') { R('#3a3a3c', -18, -12, 36, 12); R('#6a6660', -15, -18, 14, 10); R('#7d786f', -2, -22, 16, 14); R('#55524c', 6, -10, 10, 8); R('#8a857a', -10, -14, 6, 4); R('#4a4f58', -20, -6, 8, 5); }
  else if (o.kind === 'co2Ext') { R('#2a0c0c', -6, -28, 12, 28); R('#d8302a', -5, -26, 10, 25); R('#f06a5a', -4, -25, 3, 22); R('#1c1c1c', -3, -31, 6, 5); R('#1c1c1c', 2, -30, 6, 2); R('#e8e8e8', -4, -16, 8, 5); R('#2a5ac8', -2, -15, 4, 3); }
  else if (o.kind === 'battery') { R('#1c1c1c', -11, -20, 22, 20); R('#e8c830', -10, -19, 20, 18); R('#1c1c1c', -10, -12, 20, 3); R('#1c1c1c', -6, -23, 4, 3); R('#1c1c1c', 2, -23, 4, 3); R('#1c1c1c', -1, -18, 3, 5); R('#1c1c1c', -3, -14, 3, 2); R('#1c1c1c', 0, -9, 3, 6); }
  else if (o.kind === 'coolant') { R('#0c1c2a', -9, -26, 18, 26); R('#4a9ad8', -8, -25, 16, 24); R('#8ad0ff', -7, -24, 3, 22); R('#d8d8d8', -4, -29, 8, 4); R('#ffffff', -1, -18, 2, 8); R('#ffffff', -4, -15, 8, 2); R('#ffffff', -3, -17, 1, 1); R('#ffffff', 2, -13, 1, 1); }
  else if (o.kind === 'barrel') { R('#2a1010', -11, -26, 22, 26); R('#b8382a', -10, -25, 20, 24); R('#e0c040', -10, -17, 20, 4); R('#1c1c1c', -4, -13, 8, 6); R('#e0c040', -2, -12, 4, 4); }
  if (o.hp !== undefined && o.hp < o.maxHp) { x.fillStyle = '#111'; x.fillRect(X - 12, Y - 32, 24, 4); x.fillStyle = '#e0b04a'; x.fillRect(X - 11, Y - 31, 22 * Math.max(0, o.hp) / o.maxHp, 2); }
}

export const SPRITE_SCALE = 0.85;   // 캐릭터·몬스터 크기(2026-10-21 교사 요청으로 조금 작게)
export function cameraX(s, slide = 0) { if (CAR_W <= VIEW_W) return (CAR_W - VIEW_W) / 2 - slide * 220; return Math.max(0, Math.min(CAR_W - VIEW_W, s.player.x - VIEW_W / 2)); }

export function drawCar(x, s, A, fx, t) {
  const k = fx.slide || 0, camX = Math.round(cameraX(s, k * k * (3 - 2 * k))), p = s.player;
  x.save();
  if (fx.shake > 0) x.translate(Math.round((Math.random() - 0.5) * fx.shake), Math.round((Math.random() - 0.5) * fx.shake));
  x.fillStyle = '#0d0f12'; x.fillRect(0, 0, VIEW_W, VIEW_H);
  const bg = carBackground(s.line, s.carType === 'boss', A, s.carIndex % 4, s.carType === 'hazard');
  drawLinks(x, s, A, camX, fx, bg);
  x.drawImage(bg, -camX, 0);
  drawDoors(x, s, A, camX, fx);
  // 연결문: 잠기면 빨강, 열리면 초록
  for (const z of s.zones) { x.fillStyle = ZONE_COL[z.kind] || 'rgba(200,200,200,.25)'; x.beginPath(); x.ellipse(z.x - camX, z.y, z.r, z.r * 0.55, 0, 0, 6.283); x.fill(); }
  for (const r of fx.rings) { x.strokeStyle = 'rgba(240,240,230,.8)'; x.lineWidth = 3; x.globalAlpha = r.t / 0.3; const k = 1.2 - (r.t / 0.3) * 0.6; x.beginPath(); x.ellipse(r.x - camX, r.y, r.r * k, r.r * 0.55 * k, 0, 0, 6.283); x.stroke(); x.globalAlpha = 1; }
  // 천장 환기구에서 떨어질 자리: 커지는 그림자와 느낌표
  for (const d of s.drops) { const k = 1 - d.t / 24, X = d.x - camX; x.fillStyle = `rgba(0,0,0,${0.2 + 0.35 * k})`; x.beginPath(); x.ellipse(X, d.y, 6 + 10 * k, 3 + 4 * k, 0, 0, 6.283); x.fill();
    x.fillStyle = '#ffd04a'; x.font = 'bold 14px sans-serif'; x.textAlign = 'center'; x.fillText('!', X, d.y - 26 - 6 * Math.sin(t * 20)); }
  const small = (X, Y, f, k = 1) => { x.save(); x.translate(X, Y); x.scale(SPRITE_SCALE * k, SPRITE_SCALE * k); x.translate(-X, -Y); f(); x.restore(); };
  const list = [...s.props.filter(o => !o.hazard).map(o => ({ y: o.y, d: () => drawProp(x, o, camX, A) })), ...s.mons.filter(m => !m.gone).map(m => ({ y: m.y, d: () => small(Math.round(m.x - camX), Math.round(m.y), () => drawMon(x, m, A, camX, s), m.elite ? 1.3 : 1) })), { y: p.y, d: () => small(Math.round(p.x - camX), Math.round(p.y), () => drawPlayer(x, p, A, t, Math.round(p.x - camX), Math.round(p.y))) }];
  list.sort((a, b) => a.y - b.y).forEach(o => o.d());
  for (const a of s.allies) { const X = a.x - camX; if (a.kind === 'drone') { const f = A.mons.drone.run[Math.floor(t * 10) % 4].s; x.drawImage(f, Math.round(X - f.width / 2), Math.round(a.y - f.height / 2)); }
    else { x.fillStyle = '#5a5f66'; x.fillRect(X - 6, a.y - 4, 12, 18); x.fillStyle = '#c8783a'; x.fillRect(X - 4, a.y - 10, 8, 8); x.fillStyle = '#7fd8ff'; x.fillRect(X - 1, a.y - 8, 2, 2); } }
  if (p.beam) { const B = WEAPONS[p.beam], ox = p.x - camX + Math.cos(p.aim) * 16, oy = p.y - 24 + Math.sin(p.aim) * 16, ang = B.ang, len = B.len;
    x.fillStyle = BEAM_COL[p.beam]; x.beginPath(); x.moveTo(ox, oy); x.lineTo(ox + Math.cos(p.aim - ang) * len, oy + Math.sin(p.aim - ang) * len); x.lineTo(ox + Math.cos(p.aim + ang) * len, oy + Math.sin(p.aim + ang) * len); x.closePath(); x.fill(); }
  for (const sh of s.shots) {
    const X = sh.x - camX;
    if (sh.th) { const W = A.weapons[sh.weapon].s, z = Math.sin(Math.min(1, sh.t / sh.T) * Math.PI) * (sh.weapon === 'mortar' ? 110 : 40);
      if (sh.weapon === 'mortar') { x.strokeStyle = 'rgba(255,80,60,.7)'; x.lineWidth = 1; x.beginPath(); x.ellipse(sh.tx - camX, sh.ty, sh.radius, sh.radius * 0.5, 0, 0, 6.283); x.stroke(); } x.fillStyle = 'rgba(0,0,0,.25)'; x.fillRect(X - 4, sh.y, 8, 2);
      x.save(); x.translate(Math.round(X), Math.round(sh.y - z)); x.rotate(sh.t * 0.4); x.drawImage(W, -W.width / 2, -W.height / 2); x.restore(); continue; }
    drawShot(x, sh, X, t);
  }
  for (const e of s.eshots) { x.fillStyle = '#2a1a14'; x.fillRect(Math.round(e.x - camX) - 3, Math.round(e.y) - 3, 6, 6); x.fillStyle = e.electric ? '#7fd8ff' : e.col || '#ddd'; x.fillRect(Math.round(e.x - camX) - 2, Math.round(e.y) - 2, 4, 4); }
  // 연쇄 번개: 맞은 적에서 옆 적으로 튀는 지그재그 선
  for (const z of fx.zaps) { x.strokeStyle = '#bfefff'; x.lineWidth = 2; x.beginPath(); x.moveTo(z.x1 - camX, z.y1);
    for (let i = 1; i < 5; i++) { const k = i / 5; x.lineTo(z.x1 + (z.x2 - z.x1) * k - camX + (i % 2 ? 4 : -4), z.y1 + (z.y2 - z.y1) * k); } x.lineTo(z.x2 - camX, z.y2); x.stroke(); }
  for (const q of fx.parts) { x.globalAlpha = Math.min(1, q.life * 4); x.fillStyle = q.col; x.fillRect(Math.round(q.x - camX), Math.round(q.y), q.sz, q.sz); } x.globalAlpha = 1;
  x.textAlign = 'center'; x.lineJoin = 'round';
  for (const n of fx.nums) { const a = Math.min(1, n.t * 3), up = (n.T - n.t) * 26; x.globalAlpha = a; x.font = `bold ${n.big ? 13 : 10}px sans-serif`; x.lineWidth = 3; x.strokeStyle = '#000';
    x.strokeText(n.text, Math.round(n.x - camX), Math.round(n.y - up)); x.fillStyle = n.col; x.fillText(n.text, Math.round(n.x - camX), Math.round(n.y - up)); }
  for (const n of fx.pops) { const a = Math.min(1, n.t * 2.5), up = (n.T - n.t) * 14; x.globalAlpha = a; x.font = 'bold 16px sans-serif'; x.lineWidth = 4; x.strokeStyle = '#000';
    const X = Math.round(p.x - camX), Y = Math.round(p.y - 62 - up - n.row * 18); x.strokeText(n.text, X, Y); x.fillStyle = n.col; x.fillText(n.text, X, Y); }
  x.globalAlpha = 1;
  if (fx.enrage > 0) { x.fillStyle = `rgba(220,30,20,${fx.enrage * 0.3})`; x.fillRect(-20, -20, VIEW_W + 40, VIEW_H + 40); }
  if (fx.blizzard > 0) { x.fillStyle = `rgba(210,235,255,${fx.blizzard * 0.6})`; x.fillRect(-20, -20, VIEW_W + 40, VIEW_H + 40); }
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
