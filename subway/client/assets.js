// 그림을 불러와 바로 그릴 수 있는 캔버스로 만든다(맞았을 때 쓰는 흰 그림도 함께)
const POSE = {
  idle: [{ by: 0, b: [0, 0], f: [0, 0] }, { by: 1, b: [0, 0], f: [0, 0] }],
  run: [{ by: 1, b: [-3, 0], f: [3, 0] }, { by: 0, b: [0, 0], f: [1, -3] }, { by: 1, b: [3, 0], f: [-3, 0] }, { by: 0, b: [1, -3], f: [0, 0] }],
};
const HAND_W = 7;

function loadImg(src) { return new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error('그림을 못 불러옴: ' + src)); i.src = src; }); }
function toCanvas(img, sx = 0, sy = 0, sw = img.width, sh = img.height) {
  const c = document.createElement('canvas'); c.width = sw; c.height = sh; c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh); return c;
}
function tinted(c, color) {
  const o = document.createElement('canvas'); o.width = c.width; o.height = c.height; const x = o.getContext('2d');
  x.drawImage(c, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = color; x.fillRect(0, 0, o.width, o.height); return o;
}
const pair = c => ({ s: c, w: tinted(c, '#ffffff') });
function glowOf(c) {
  const o = document.createElement('canvas'); o.width = c.width + 2; o.height = c.height + 2; const x = o.getContext('2d'), t = tinted(c, '#fff3a0');
  for (const [dx, dy] of [[0, 1], [2, 1], [1, 0], [1, 2]]) x.drawImage(t, dx, dy); x.drawImage(c, 1, 1); return o;
}

function buildJob(body, far, near, m, arms) {
  const B = toCanvas(body);
  const top = toCanvas(B, 0, 0, m.w, m.legY), bl = toCanvas(B, 0, m.legY, m.split, m.h - m.legY), fl = toCanvas(B, m.split, m.legY, m.w - m.split, m.h - m.legY);
  const frame = p => {
    const c = document.createElement('canvas'); c.width = m.w + 8; c.height = m.h; const x = c.getContext('2d');
    x.drawImage(bl, 4 + p.b[0], m.legY + p.b[1]); x.drawImage(fl, 4 + m.split + p.f[0], m.legY + p.f[1]); x.drawImage(top, 4, p.by);
    return { ...pair(c), uy: p.by };
  };
  const farC = toCanvas(far);
  return { idle: POSE.idle.map(frame), run: POSE.run.map(frame), far: pair(farC), farHand: pair(toCanvas(farC, farC.width - HAND_W, 0, HAND_W, farC.height)), near: pair(toCanvas(near)), m, A: arms, HW: HAND_W };
}

// base: manifest가 있는 폴더 주소. urlOf로 data URI 판(한 파일판)도 그대로 쓸 수 있다
export async function loadAssets(manifest, urlOf = p => p) {
  const L = p => loadImg(urlOf(p));
  const A = { jobs: {}, weapons: {}, mons: {} };
  await Promise.all(Object.entries(manifest.jobs).map(async ([k, j]) => {
    const [b, f, n] = await Promise.all([L(j.body), L(j.far), L(j.near)]);
    A.jobs[k] = buildJob(b, f, n, j.bodyMeta, j.arms);
  }));
  await Promise.all(Object.entries(manifest.weapons).map(async ([k, w]) => { A.weapons[k] = { ...pair(toCanvas(await L(w.img))), grip: w.grip, muzzle: w.muzzle }; }));
  await Promise.all(Object.entries(manifest.mons).map(async ([k, m]) => {
    A.mons[k] = { run: (await Promise.all(m.run.map(L))).map(i => pair(toCanvas(i))) };
    if (m.atk) A.mons[k].atk = (await Promise.all(m.atk.map(L))).map(i => pair(toCanvas(i)));
  }));
  // 지하철 객실·승강장·전동차
  if (manifest.subway) {
    const { meta, ...files } = manifest.subway; A.subway = { meta };
    await Promise.all(Object.entries(files).map(async ([k, p]) => { A.subway[k] = toCanvas(await L(p)); }));
  }
  // 도둑 너구리: 너구리 그림에 빛나는 테두리
  A.mons.thief = { run: A.mons.raccoon.run.map(f => pair(glowOf(f.s))) };
  return A;
}
