// A picture of every room, by jumping straight to it.
//
// The solver proves each room can be finished. It says nothing about whether the room can be READ:
// whether the plates are distinguishable, whether a door looks like a door, whether the thing you
// are supposed to notice is visible at all. That needs an eye, and an eye needs a picture.
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
const pg = await br.newPage({ viewport: { width: 560, height: 560 } });
const errs = [];
pg.on('pageerror', (e) => errs.push(e.message));
await pg.goto(`http://127.0.0.1:${srv.address().port}/?dev`, { waitUntil: 'load' });
await pg.waitForTimeout(500);
await pg.keyboard.press('Space');
await pg.waitForTimeout(400);

const n = await pg.evaluate(() => window.__latch.LEVELS.length);
for (let i = 0; i < n; i++) {
  const name = await pg.evaluate((k) => {
    // jump to the room by driving the same path the game uses
    const d = window.__latch;
    while (d.room < k) { d.state.over = 'win'; }
    return d.LEVELS[k].name;
  }, i).catch(() => null);
  await pg.waitForTimeout(200);
  await pg.screenshot({ path: `out/room-${i + 1}.png`, clip: { x: 0, y: 0, width: 560, height: 560 } });
}
console.log(errs.length ? errs.join('\n') : 'no errors');
await br.close(); srv.close();
