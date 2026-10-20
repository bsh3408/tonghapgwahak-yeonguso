// 시작점: 그림을 불러오고 화면 흐름(screens.js)을 연다
// 한 파일판(dist)은 window.__MANIFEST__에 그림이 data URI로 들어 있다
import { boot } from './main.js';
import { startApp } from './screens.js';

let manifest = window.__MANIFEST__, urlOf = window.__ASSET_URL__;
if (!manifest) {
  const base = new URL('../assets/', import.meta.url);
  manifest = await fetch(new URL('manifest.json', base)).then(r => r.json());
  urlOf = p => new URL(p, base).href;
}
await boot(manifest, urlOf);
startApp();
