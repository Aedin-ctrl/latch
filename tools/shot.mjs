import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
const ROOT = new URL('..', import.meta.url).pathname;
const T = { '.html': 'text/html', '.mjs': 'text/javascript' };
const srv = createServer((q, s) => {
  let p = join(ROOT, decodeURI(q.url.split('?')[0]));
  try { if (statSync(p).isDirectory()) p = join(p, 'index.html'); } catch {}
  if (!existsSync(p)) { s.writeHead(404); return s.end(); }
  s.writeHead(200, { 'Content-Type': T[extname(p)] || 'application/octet-stream' });
  s.end(readFileSync(p));
});
await new Promise((r) => srv.listen(0, r));
const br = await chromium.launch({ channel: 'chrome', headless: true });
const pg = await br.newPage({ viewport: { width: 1100, height: 820 } });
const errs = [];
pg.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
pg.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });
await pg.goto(`http://127.0.0.1:${srv.address().port}/?dev`, { waitUntil: 'load' });
await pg.waitForTimeout(900);
await pg.screenshot({ path: 'out/title.png' });
await pg.keyboard.press('Space');
await pg.waitForTimeout(600);
await pg.screenshot({ path: 'out/room1.png' });
// walk around a bit so a ghost exists for the next shot
for (const k of ['ArrowDown', 'ArrowDown', 'ArrowRight', 'ArrowRight']) {
  await pg.keyboard.down(k); await pg.waitForTimeout(260); await pg.keyboard.up(k);
}
await pg.waitForTimeout(200);
await pg.screenshot({ path: 'out/walking.png' });
// let a whole discharge run out so an afterimage appears
await pg.waitForTimeout(9000);
await pg.screenshot({ path: 'out/dying.png' });
await pg.waitForTimeout(1500);
await pg.screenshot({ path: 'out/ghost.png' });
console.log(await pg.evaluate(() => JSON.stringify({
  room: window.__latch.room, scene: window.__latch.scene,
  tapes: window.__latch.state.tapes.length,
  tick: window.__latch.state.world.tick,
})));
console.log(errs.length ? errs.join('\n') : 'no console errors');
await br.close(); srv.close();
