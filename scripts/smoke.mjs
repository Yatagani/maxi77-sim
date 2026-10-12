// Smoke test: build preview must load with no console errors, render the menu,
// start a lesson, sail a few seconds with keys, and save screenshots.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const PORT = 4179;
const CI = !!process.env.CI;
const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 2500));
const errors = [];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: CI ? { width: 1024, height: 640 } : { width: 1440, height: 900 } });
  page.setDefaultTimeout(CI ? 120000 : 30000);
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://localhost:${PORT}/${CI ? '?quality=low' : ''}`);
  await page.waitForSelector('.menu .card');
  mkdirSync('screenshots', { recursive: true });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'screenshots/01-menu.png' });
  const lesson = process.argv[2] ?? 'upwind';
  await page.click(`[data-lesson="${lesson}"]`);
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'screenshots/02-briefing.png' });
  await page.keyboard.press('Enter');
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(800);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: 'screenshots/03-chase.png' });
  await page.keyboard.press('KeyC');
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'screenshots/04-helm.png' });
  await page.keyboard.press('KeyC');
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'screenshots/05-top.png' });
  // side-on beauty shot for comparing the hull/rig profile with photos
  await page.keyboard.press('KeyC');
  await page.evaluate(() => {
    const w = window.__maxi.world;
    const s = window.__maxi.run.sim.state;
    const px = s.x, pz = -s.y;
    const h = s.heading;
    // starboard beam, slightly ahead
    w.camera.position.set(px + Math.cos(h) * 16 + Math.sin(h) * 3, 2.5, pz + Math.sin(h) * 16 - Math.cos(h) * 3);
    w.controls.target.set(px, 3.2, pz);
    w.controls.update();
  });
  await page.waitForTimeout(150);
  await page.screenshot({ path: 'screenshots/06-side.png' });
  const state = await page.evaluate(() => {
    const r = window.__maxi.run;
    return { t: r.sim.t, speed: r.sim.diag.speed, status: r.status };
  });
  console.log('state', JSON.stringify(state));
  if (!(state.t > 2)) errors.push('simulation did not advance');

  // Oslofjord replay with a bundled preset
  await page.keyboard.press('Escape');
  await page.click('nav button[data-tab="replay"]');
  await page.click('input[name=preset][value="1"]');
  await page.selectOption('#r-comp', '120');
  await page.click('#go-replay');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'screenshots/07-replay.png' });

  // Custom date fetched live from Open-Meteo (network); failure must surface as a message, not a crash
  await page.keyboard.press('Escape');
  await page.click('nav button[data-tab="replay"]');
  await page.click('input[name=preset][value="custom"]');
  await page.fill('#r-date', '2025-07-15');
  await page.click('#go-replay');
  const ok = await page
    .waitForSelector('.card-big', { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  const msg = await page.evaluate(() => document.querySelector('#r-err')?.textContent ?? '');
  console.log('custom date', ok ? 'loaded' : `not loaded: ${msg}`);
  if (ok) {
    const title = await page.evaluate(() => window.__maxi.run.lesson.title);
    console.log('custom title', title);
  }
} finally {
  await browser.close();
  server.kill();
}
if (errors.length) {
  console.error('ERRORS:\n' + errors.join('\n'));
  process.exit(1);
}
console.log('smoke ok');
