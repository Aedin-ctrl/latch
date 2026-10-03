// The things headless simulation cannot test: the loop, the canvas, the audio graph, and whether
// anything leaks over a long session.
//
//   node tools/robust.mjs            # this game
//   node tools/robust.mjs <url>      # a live one
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
const base = process.argv[2] || `http://127.0.0.1:${srv.address().port}/`;

const br = await chromium.launch({ channel: 'chrome', headless: true });
const pg = await br.newPage({ viewport: { width: 1100, height: 760 } });
const errs = [];
pg.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
pg.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });

await pg.goto(base, { waitUntil: 'load' });
await pg.waitForTimeout(800);
await pg.keyboard.press('Space');
await pg.waitForTimeout(600);

const play = async (ms) => {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    await pg.keyboard.down('ArrowRight'); await pg.waitForTimeout(220);
    await pg.keyboard.up('ArrowRight');
    await pg.keyboard.down('ArrowDown'); await pg.waitForTimeout(200);
    await pg.waitForTimeout(220);
    await pg.keyboard.up('ArrowDown'); await pg.keyboard.press('KeyQ');
    await pg.waitForTimeout(200);
  }
};

const audioNodes = () => pg.evaluate(() => {
  // count live oscillators/sources by patching the prototypes once and keeping a tally
  return window.__nodeTally ?? null;
});
await pg.evaluate(() => {
  window.__nodeTally = { made: 0, ended: 0 };
  const AC = window.AudioContext || window.webkitAudioContext;
  for (const kind of ['createOscillator', 'createBufferSource']) {
    const orig = AC.prototype[kind];
    AC.prototype[kind] = function (...a) {
      const n = orig.apply(this, a);
      window.__nodeTally.made++;
      n.addEventListener('ended', () => { window.__nodeTally.ended++; });
      return n;
    };
  }
});

console.log('playing...');
await play(8000);
const t1 = await audioNodes();

console.log('restarting ten times...');
for (let i = 0; i < 10; i++) { await pg.keyboard.press('KeyR'); await pg.waitForTimeout(220); await play(400); }

console.log('resizing...');
for (const [w, h] of [[320, 240], [1, 1], [200, 180], [1600, 1000], [900, 400], [1100, 760]]) {
  await pg.setViewportSize({ width: Math.max(1, w), height: Math.max(1, h) });
  await pg.waitForTimeout(150);
}

console.log('backgrounding...');
await pg.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await pg.waitForTimeout(500);
await pg.evaluate(() => window.dispatchEvent(new Event('blur')));
await pg.waitForTimeout(300);
await pg.keyboard.press('Space');
await play(4000);

console.log('muting and unmuting...');
for (let i = 0; i < 6; i++) { await pg.keyboard.press('KeyM'); await pg.waitForTimeout(120); }
await play(3000);

const t2 = await audioNodes();
const heap = await pg.evaluate(() => performance.memory ? performance.memory.usedJSHeapSize : 0);
const canvas = await pg.evaluate(() => {
  const c = document.getElementById('screen');
  return { w: c.width, h: c.height, cssW: c.style.width, cssH: c.style.height };
});

console.log(`\naudio nodes made ${t2.made}, ended ${t2.ended}, live ${t2.made - t2.ended}` +
            `  (was ${t1.made - t1.ended} after the first burst)`);
console.log(`canvas ${canvas.w}x${canvas.h} shown at ${canvas.cssW} x ${canvas.cssH}`);
console.log(`heap ${(heap / 1048576).toFixed(1)} MB`);
console.log(errs.length ? '\n' + errs.slice(0, 10).join('\n') : '\nno errors through any of that');
await br.close(); srv.close();
process.exit(errs.length ? 1 : 0);
