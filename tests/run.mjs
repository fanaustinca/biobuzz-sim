// Headless test suite. It serves the repo root, loads index.html?headless in Chromium (SwiftShader WebGL) and drives window.BIOBUZZ.
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const shots = path.join(root, 'tests', 'screenshots');
fs.mkdirSync(shots, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.png': 'image/png' };

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      const file = path.join(root, url === '/' ? 'index.html' : url);
      if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}
function findBrowser() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const pw = path.join(os.homedir(), '.cache', 'ms-playwright');
  if (fs.existsSync(pw)) for (const d of fs.readdirSync(pw).filter((d) => d.startsWith('chromium-')).sort().reverse())
    for (const sub of ['chrome-linux-arm64/chrome', 'chrome-linux/chrome', 'chrome-linux64/chrome']) { const p = path.join(pw, d, sub); if (fs.existsSync(p)) return p; }
  for (const p of ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable']) if (fs.existsSync(p)) return p;
  throw new Error('No Chromium found. Set CHROME_PATH.');
}

let passed = 0, failed = 0;
async function test(name, fn) {
  const t0 = Date.now();
  try { await fn(); passed++; console.log(`  ✓ ${name} (${Date.now() - t0}ms)`); }
  catch (e) { failed++; console.log(`  ✗ ${name}\n      ${String(e.message).split('\n').join('\n      ')}`); }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };

const srv = await serve();
const url = `http://127.0.0.1:${srv.address().port}/index.html?headless`;
const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: true,
  args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'], protocolTimeout: 600000 });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); if (process.env.VERBOSE) console.log('   [page]', m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.setDefaultTimeout(600000);
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.BIOBUZZ && window.BIOBUZZ.ready, { timeout: 120000, polling: 200 });
await page.evaluate(() => BIOBUZZ.pause(true));
const ev = (fn, ...a) => page.evaluate(fn, ...a);
const shot = async (name, cam) => { await ev((c) => { BIOBUZZ.settings.cam = c; for (let i = 0; i < 40; i++) BIOBUZZ.render(); }, cam); await page.screenshot({ path: path.join(shots, name) }); };

console.log('BIOBUZZ simulator tests');

await test('boots with all 56 scoring elements staged', async () => {
  const s = await ev(() => BIOBUZZ.state());
  const total = s.balls.field + s.balls.held + s.balls.queue;
  assert(total === 56, `expected 56 balls, got ${total} (${JSON.stringify(s.balls)})`);
  assert(s.balls.queue === 10, 'expected 10 NECTAR with the human players');
  assert(errors.length === 0, errors.join('\n'));
});

await ev(() => Object.assign(BIOBUZZ.settings.ctl, { R2: 'off', B1: 'off', B2: 'off' }));
await test('field elements settle: flowers hold their POLLEN, hives rest at ±30°', async () => {
  const r = await ev(() => {
    BIOBUZZ.startFree(); BIOBUZZ.advance(3);
    const S = BIOBUZZ.sim;
    const perFlower = S.flowers.map((f) => S.balls.filter((b) => b.state === 'field' && b.kind === 'pollen' && f.inTube(b.p)).length);
    return { perFlower, hives: S.hives.map((h) => h.theta * 180 / Math.PI) };
  });
  assert(r.perFlower.every((n) => n === 4), `flower stacks: ${r.perFlower}`);
  assert(Math.abs(r.hives[0] + 30) < 1.5 && Math.abs(r.hives[1] - 30) < 1.5, `hive angles ${r.hives}`);
});

// HIVE calibration per Field Setup Guide §12.3
async function cellTrial(nP, nN, clearNectar) {
  return ev((nP, nN, clearNectar) => {
    BIOBUZZ.startFree();
    const S = BIOBUZZ.sim, h = S.hives[1];
    for (const r of S.robots) r.enabled = false;
    if (clearNectar) for (const b of S.balls) if (b.state === 'field' && h.inCell(b.p, h.upSign())) b.release({ x: 1.5, y: 0.1, z: 1.5 - b.id * 0.1 }, { x: 0, y: 0, z: 0 });
    BIOBUZZ.advance(0.5);
    // fillCell places the new elements beside whatever is already in the CELL
    const placed = BIOBUZZ.fillCell('blue', nP, nN);
    for (let i = 0; i < 4 * 120; i++) BIOBUZZ.advance(1 / 120);
    return { placed, tips: h.tips, theta: h.theta * 180 / Math.PI };
  }, nP, nN, clearNectar);
}
await test('HIVE: staged 3 NECTAR + 2 POLLEN does NOT tip', async () => { const r = await cellTrial(2, 0, false); assert(r.tips === 0, JSON.stringify(r)); });
await test('HIVE: staged 3 NECTAR + 3 POLLEN tips', async () => { const r = await cellTrial(3, 0, false); assert(r.tips === 1, JSON.stringify(r)); });
await test('HIVE: 7 POLLEN does NOT tip', async () => { const r = await cellTrial(7, 0, true); assert(r.tips === 0, JSON.stringify(r)); });
await test('HIVE: 6 POLLEN + a 7th tossed in does NOT tip', async () => {
  const r = await ev(() => {
    BIOBUZZ.startFree(); const S = BIOBUZZ.sim, h = S.hives[1];
    for (const b of S.balls) if (b.state === 'field' && h.inCell(b.p, h.upSign())) b.release({ x: 1.5, y: 0.1, z: 1.5 - b.id * 0.1 }, { x: 0, y: 0, z: 0 });
    BIOBUZZ.advance(0.5); BIOBUZZ.fillCell('blue', 6, 0); BIOBUZZ.advance(2);
    // Toss the 7th from 15 cm above the CELL floor
    BIOBUZZ.fillCell('blue', 1, 0, 0.15); BIOBUZZ.advance(4);
    return { tips: h.tips, theta: h.theta * 180 / Math.PI };
  });
  assert(r.tips === 0, JSON.stringify(r));
});
await test('HIVE: 8 POLLEN tips and holds the new stable state', async () => {
  const r = await cellTrial(8, 0, true);
  assert(r.tips === 1 && r.theta < -27, JSON.stringify(r));
});

await test('auto-aim: every locked shot from several positions lands in the up CELL', async () => {
  const r = await ev(() => {
    const out = [];
    for (const [x, z] of [[-0.3, 1.25], [-0.9, 1.4], [0.3, 1.6], [-0.7, 1.0], [-0.4, 0.95]]) {
      BIOBUZZ.startFree();
      const S = BIOBUZZ.sim, R = S.player, h = S.hives[0];
      for (const o of S.robots) if (o !== R) o.enabled = false;
      // Empty the CELL, then give the robot 5 POLLEN (under the 8-POLLEN tip threshold)
      for (const b of S.balls) if (b.state === 'field' && h.inCell(b.p, h.upSign())) b.release({ x: 1.6, y: 0.1, z: -1.2 + b.id * 0.08 }, { x: 0, y: 0, z: 0 });
      R.body.setTranslation({ x, y: 0, z }, true);
      R.body.setRotation({ x: 0, y: Math.sin(Math.PI / 2), z: 0, w: Math.cos(Math.PI / 2) }, true);
      const extra = S.balls.filter((b) => b.state === 'field' && b.kind === 'pollen' && b.p.x > 1.2).slice(0, 1);
      for (const b of extra) { b.hold(R); R.held.push(b); }
      R.tog = { intakeF: false, intakeB: false, flap: false, aim: true };
      BIOBUZZ.advance(0.6);
      const st = R.shot.reason; let fired = 0;
      const n0 = R.held.length;
      R.ai = null;
      // Hold the trigger through a scripted command; the robot is human-controlled, so drive the cmd directly
      for (let i = 0; i < 360; i++) {
        R.tog.aim = true;
        const keysDown = true; BIOBUZZ.__shoot = keysDown;
        R.cmd.shoot = true; R.cmd.autoAim = true; R.cmd.vx = 0; R.cmd.vz = 0; R.cmd.w = 0;
        R.applyDrive(); R.mechanisms(1 / 120);
        for (const hh of S.hives) hh.applyTorques();
        BIOBUZZ.world.step(); for (const b of S.balls) b.physicsTick(); for (const hh of S.hives) hh.postStep();
        S.time += 1 / 120;
      }
      fired = n0 - R.held.length;
      for (let i = 0; i < 240; i++) { for (const hh of S.hives) hh.applyTorques(); BIOBUZZ.world.step(); for (const hh of S.hives) hh.postStep(); }
      const inCell = S.balls.filter((b) => b.state === 'field' && b.kind === 'pollen' && h.inCell(b.p, h.upSign())).length;
      out.push({ x, z, lock: st, fired, inCell, tips: h.tips });
    }
    return out;
  });
  for (const o of r) assert(o.lock === 'LOCKED' && o.fired === 5 && o.inCell === 5 && o.tips === 0, JSON.stringify(r, null, 0));
});

await test('cover flap: NECTAR is guided into a FLOWER with 100% accuracy', async () => {
  const r = await ev(() => {
    BIOBUZZ.startFree();
    const S = BIOBUZZ.sim, R = S.player, f = S.flowers[2];          // red-wall FLOWER
    for (const o of S.robots) if (o !== R) o.enabled = false;
    // Hold 3 NECTAR (from the CELL) after dropping the preloads
    while (R.held.length) { const b = R.held.pop(); b.release({ x: 1.5, y: 0.1, z: 0.5 + R.held.length * 0.1 }, { x: 0, y: 0, z: 0 }); }
    const nect = S.balls.filter((b) => b.kind === 'nectar' && b.state === 'field').slice(0, 3);
    for (const b of nect) { b.hold(R); R.held.push(b); }
    const ap = { x: f.pos.x + f.normal.x * 0.42, z: f.pos.z + f.normal.z * 0.42 }, h = Math.atan2(-f.normal.x, -f.normal.z);
    R.body.setTranslation({ x: ap.x, y: 0, z: ap.z }, true); R.body.setRotation({ x: 0, y: Math.sin(h / 2), z: 0, w: Math.cos(h / 2) }, true);
    R.tog = { intakeF: false, intakeB: false, flap: true, aim: true };
    BIOBUZZ.advance(0.5);
    const reason = R.shot.reason;
    for (let i = 0; i < 300; i++) { R.cmd.shoot = true; R.cmd.flap = true; R.cmd.vx = R.cmd.vz = R.cmd.w = 0; R.applyDrive(); R.mechanisms(1 / 120);
      for (const hh of S.hives) hh.applyTorques(); BIOBUZZ.world.step(); for (const b of S.balls) b.physicsTick(); S.time += 1 / 120; }
    for (let i = 0; i < 240; i++) BIOBUZZ.world.step();
    const st = BIOBUZZ.scoring.flowerState(f);
    return { reason, inside: st.inside.map((b) => b.kind), owner: st.owner };
  });
  assert(r.reason === 'FLOWER LOCK', JSON.stringify(r));
  assert(r.inside.filter((k) => k === 'nectar').length === 3 && r.owner === 'red', JSON.stringify(r));
});

await test('intake: driving into POLLEN picks it up (single + double intakes, both drivetrains)', async () => {
  const r = await ev(() => {
    const out = [];
    for (const cfg of [{ drive: 'mecanum', intake: 'single' }, { drive: '4wd', intake: 'double' }]) {
      Object.assign(BIOBUZZ.settings, cfg); BIOBUZZ.startFree();
      const S = BIOBUZZ.sim, R = S.player;
      for (const o of S.robots) if (o !== R) o.enabled = false;
      const b = S.balls.find((x) => x.state === 'field' && x.kind === 'pollen' && x.p.y < 0.05 && Math.abs(x.p.x) < 1.6 && Math.abs(x.p.z) < 1.6) ||
        S.balls.find((x) => x.state === 'field' && x.kind === 'pollen');
      b.release({ x: 0.2, y: 0.04, z: 1.2 }, { x: 0, y: 0, z: 0 });
      // Face the ball from 0.8 m away and drive forward with the intake on (back intake for the double config)
      const back = cfg.intake === 'double';
      R.body.setTranslation({ x: 0.2, y: 0, z: 0.4 }, true);
      const hd = back ? Math.PI : 0;  // heading π: forward = -z, so the back intake faces the ball at +z
      R.body.setRotation({ x: 0, y: Math.sin(hd / 2), z: 0, w: Math.cos(hd / 2) }, true);
      const held0 = R.held.length;
      for (let i = 0; i < 240; i++) {
        R.tog = { intakeF: !back, intakeB: back, flap: false, aim: true };
        const sp = 0.6, fw = { x: Math.sin(R.heading), z: Math.cos(R.heading) }, dir = back ? -1 : 1;
        R.cmd.vx = fw.x * sp * dir; R.cmd.vz = fw.z * sp * dir; R.cmd.w = 0; R.cmd.intakeF = !back; R.cmd.intakeB = back; R.cmd.shoot = false;
        R.applyDrive(); R.mechanisms(1 / 120); BIOBUZZ.world.step(); for (const x of S.balls) x.physicsTick(); S.time += 1 / 120;
      }
      out.push({ cfg, gained: R.held.length - held0, z: R.pos.z });
    }
    Object.assign(BIOBUZZ.settings, { drive: 'mecanum', intake: 'single' });
    return out;
  });
  for (const o of r) assert(o.gained >= 1, JSON.stringify(r));
});

await test('robot capacity is capped at 10', async () => {
  const r = await ev(() => {
    BIOBUZZ.startFree(); const S = BIOBUZZ.sim, R = S.player;
    for (const o of S.robots) if (o !== R) o.enabled = false;
    R.body.setTranslation({ x: 0, y: 0, z: 1.0 }, true); R.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    const pool = S.balls.filter((b) => b.state === 'field' && b.kind === 'pollen').slice(0, 9);
    pool.forEach((b, i) => b.release({ x: (i % 3 - 1) * 0.08, y: 0.04 + Math.floor(i / 3) * 0.08, z: 1.3 }, { x: 0, y: 0, z: 0 }));
    for (let i = 0; i < 360; i++) { R.cmd.vx = 0; R.cmd.vz = 0.4; R.cmd.w = 0; R.cmd.intakeF = true; R.cmd.shoot = false; R.applyDrive(); R.mechanisms(1 / 120); BIOBUZZ.world.step(); S.time += 1 / 120; }
    return R.held.length;
  });
  assert(r === 10, `held ${r}`);
});

await test('full match with 3 AI robots (auto skipped, no recording): AI scores and the match completes', async () => {
  const r = await ev(() => {
    BIOBUZZ.AutoRec.clear();
    Object.assign(BIOBUZZ.settings.ctl, { R2: 'ai', B1: 'ai', B2: 'ai' });
    BIOBUZZ.startMatch();
    // (robots are rebuilt from settings on reset)
    const t0 = performance.now();
    const S = BIOBUZZ.sim;
    BIOBUZZ.advance(3);
    let autoMove = 0;   // largest drive command the player's robot received during AUTO (should be 0 with no routine)
    for (let i = 0; i < 30 * 120; i++) { BIOBUZZ.advance(1 / 120); const c = S.player.cmd; autoMove = Math.max(autoMove, Math.hypot(c.vx, c.vz), Math.abs(c.w), c.shoot ? 1 : 0); }
    BIOBUZZ.advance(8 + 120 + 3);
    return { autoMove, ms: performance.now() - t0, phase: BIOBUZZ.match.phase, final: BIOBUZZ.match.final, tips: BIOBUZZ.match.tips, robots: BIOBUZZ.state().robots };
  });
  console.log('      final', JSON.stringify(r.final), 'tips', JSON.stringify(r.tips), `sim ${Math.round(r.ms)}ms`);
  console.log('      robots', JSON.stringify(r.robots.map((x) => ({ id: x.id, shots: x.stats.shots, in: x.stats.intaken, st: x.state }))));
  assert(r.final, 'no final score');
  assert(r.autoMove === 0, `player should get no commands when no AUTO is recorded (max cmd ${r.autoMove})`);
  const aiShots = r.robots.filter((x) => x.id !== 'R1').reduce((a, x) => a + x.stats.shots, 0);
  assert(aiShots > 10, `AI barely shot: ${aiShots}`);
  assert(r.tips.blue.auto + r.tips.blue.tele + r.tips.red.auto + r.tips.red.tele >= 2, 'expected the AI to tip hives');
});

await test('auto recorder: records a routine and replays it in AUTO', async () => {
  await ev(() => { BIOBUZZ.AutoRec.clear(); Object.assign(BIOBUZZ.settings.ctl, { R2: 'off', B1: 'off', B2: 'off' }); BIOBUZZ.startRecord(); BIOBUZZ.advance(3.2); });
  await page.keyboard.down('KeyW');
  await ev(() => BIOBUZZ.advance(1.2));
  await page.keyboard.up('KeyW');
  await page.keyboard.down('KeyE');
  await ev(() => BIOBUZZ.advance(0.6));
  await page.keyboard.up('KeyE');
  const rec = await ev(() => { const p = BIOBUZZ.sim.player.pos; const end = { x: p.x, z: p.z, h: BIOBUZZ.sim.player.heading }; BIOBUZZ.advance(28.5); return { end, saved: !!BIOBUZZ.AutoRec.data, n: BIOBUZZ.AutoRec.data?.frames.length }; });
  assert(rec.saved && rec.n > 1000, JSON.stringify(rec));
  const play = await ev(() => { BIOBUZZ.startMatch(); BIOBUZZ.advance(3 + 2.0); const p = BIOBUZZ.sim.player.pos; return { x: p.x, z: p.z, h: BIOBUZZ.sim.player.heading }; });
  const err = Math.hypot(play.x - rec.end.x, play.z - rec.end.z);
  console.log('      recorded end', JSON.stringify(rec.end), 'replayed', JSON.stringify(play), 'err', err.toFixed(3));
  assert(err < 0.05, `replay position error ${err}`);
  await ev(() => { BIOBUZZ.AutoRec.clear(); Object.assign(BIOBUZZ.settings.ctl, { R2: 'ai', B1: 'ai', B2: 'ai' }); });
});

await test('reconfiguring the drivetrain/intake rebuilds the robot', async () => {
  const r = await ev(() => { BIOBUZZ.startFree(); const R = BIOBUZZ.sim.player; R.rebuild({ drive: '4wd', intake: 'double' }); BIOBUZZ.advance(0.5); const a = { d: R.cfg.drive, i: R.cfg.intake }; R.rebuild({ drive: 'mecanum', intake: 'single' }); BIOBUZZ.advance(0.2); return a; });
  assert(r.d === '4wd' && r.i === 'double', JSON.stringify(r));
});

await test('screenshots render without WebGL errors', async () => {
  await ev(() => { BIOBUZZ.startFree(); BIOBUZZ.advance(4); });
  await shot('driver.png', 'driver');
  await shot('audience.png', 'audience');
  await shot('top.png', 'top');
  await ev(() => BIOBUZZ.advance(6));
  await shot('chase.png', 'chase');
  assert(errors.length === 0, errors.join('\n'));
});

console.log(`\n${passed} passed, ${failed} failed`);
if (errors.length) console.log('page errors:\n' + errors.join('\n'));
await browser.close(); srv.close();
process.exit(failed ? 1 : 0);
