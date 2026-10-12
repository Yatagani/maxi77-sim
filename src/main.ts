import { autoTrim, type TrimHint } from './sim/autotrim';
import { DEG } from './sim/boat';
import { LESSONS, LessonRun, saveResult, type Lesson } from './sim/lessons';
import { hourlyToKeys } from './sim/wind';
import { World } from './render/world';
import { Hud } from './ui/hud';
import { Menu, type MenuChoice } from './ui/menu';
import './ui/style.css';

const app = document.getElementById('app')!;
app.innerHTML = '<div id="view"></div>';
const view = document.getElementById('view')!;
const world = new World(view);

type Mode = 'menu' | 'briefing' | 'sailing' | 'result';
let mode: Mode = 'menu';
let run: LessonRun;
let paused = false;
let timeScale = 1;
let hint: TrimHint | null = null;
let hintT = -1;
let lastChoice: MenuChoice | null = null;

const overlay = document.createElement('div');
overlay.className = 'overlay';
app.append(overlay);

// ---------- actions shared by keyboard and HUD buttons ----------
const held = () => run.sim.held;
const nudge = (k: 'main' | 'jib' | 'traveler', d: number) => {
  const c = run.sim.controls;
  const key = k === 'main' ? 'mainsheet' : k === 'jib' ? 'jibSheet' : 'traveler';
  c[key] = Math.min(1, Math.max(0, c[key] + d));
};
const actions: Record<string, () => void> = {
  mainIn: () => nudge('main', -0.02),
  mainOut: () => nudge('main', 0.02),
  jibIn: () => nudge('jib', -0.02),
  jibOut: () => nudge('jib', 0.02),
  travUp: () => nudge('traveler', -0.04),
  travDown: () => nudge('traveler', 0.04),
  switchJib: () => run.sim.switchJib(),
  vang: () => run.sim.cycleVang(),
  backstay: () => run.sim.cycleBackstay(),
  reef: () => (run.sim.controls.reef >= 2 ? run.sim.reefOut() : run.sim.reefIn()),
  headsail: () => run.sim.changeHeadsail(),
  hike: () => run.sim.toggleHike(),
  lock: () => (run.sim.tillerLock = !run.sim.tillerLock),
  hint: () => (hud.showHint = !hud.showHint),
};

const hud = new Hud(actions);
app.append(hud.root);
const menu = new Menu(choose);
app.append(menu.root);

// ---------- demo boat behind the menu ----------
function demoLesson(): Lesson {
  return {
    id: 'demo',
    n: 0,
    title: 'Demo',
    skill: 'Sail trim',
    briefing: [],
    keys: '',
    wind: [{ t: 0, speed: 11, dir: 200, gustAmp: 3, gustRate: 0.6 }],
    start: { twa: 65, speedKn: 5 },
    autoJib: true,
    timeLimit: Infinity,
    objectives: () => [],
  };
}

function startRun(lesson: Lesson) {
  run = new LessonRun(lesson, 11);
  world.setMarks(run.marks);
  world.reset(run.sim);
  hint = null;
  hintT = -1;
  paused = false;
}

function demoAutopilot() {
  const sim = run.sim;
  sim.tillerLock = true;
  const target = sim.wind.baseDir() * DEG - 65 * DEG;
  const err = Math.atan2(Math.sin(target - sim.state.heading), Math.cos(target - sim.state.heading));
  sim.controls.rudder = Math.max(-0.4, Math.min(0.4, 2 * err - 1.2 * sim.state.r));
  if (sim.t - hintT > 0.5) {
    hintT = sim.t;
    Object.assign(sim.controls, autoTrim(sim.state, sim.effectiveControls(), sim.wind.sample(sim.state.x, sim.state.y)));
  }
}

// ---------- flow ----------
function choose(c: MenuChoice) {
  lastChoice = c;
  hud.replay = null;
  if (c.kind === 'lesson') startRun(c.lesson);
  else if (c.kind === 'free') {
    startRun({
      id: 'free',
      n: 0,
      title: 'Free sail',
      skill: 'Sail trim',
      briefing: [
        `Wind ${c.speed} kn from ${c.dir}°, gusts +${c.gust} kn, shifts ±${c.shift}°.`,
        'No objectives — experiment. Press I to show the optimal sheet settings as ghost markers.',
      ],
      keys: '',
      wind: [{ t: 0, speed: c.speed, dir: c.dir, gustAmp: c.gust, gustRate: 0.6, shiftAmp: c.shift, shiftPeriod: 240 }],
      start: { twa: 60, speedKn: 3, controls: { headsail: c.headsail } },
      autoJib: true,
      timeLimit: Infinity,
      objectives: () => [],
    });
  } else {
    const keys = hourlyToKeys(c.preset.hours, c.startHour, c.compression);
    startRun({
      id: 'replay',
      n: 0,
      title: `Oslofjord ${c.preset.date}`,
      skill: 'Sail trim',
      briefing: [
        `${c.preset.name}. Real hourly wind from ${String(c.startHour).padStart(2, '0')}:00 local time, ${c.compression}× time.`,
        'Wind speed, direction and gustiness change as they did that day. Reef and change headsails as needed.',
      ],
      keys: '',
      wind: keys,
      start: { twa: 60, speedKn: 3 },
      autoJib: true,
      timeLimit: Infinity,
      objectives: () => [],
    });
    hud.replay = { label: c.preset.date, rows: c.preset.hours, startHour: c.startHour, compression: c.compression };
  }
  menu.hide();
  showBriefing();
}

function showBriefing() {
  mode = 'briefing';
  const L = run.lesson;
  overlay.innerHTML = `<div class="card-big">
    <h2>${L.n ? `Lesson ${L.n}: ` : ''}${L.title}</h2>
    <ul>${L.briefing.map((b) => `<li>${b}</li>`).join('')}</ul>
    ${run.objectives.length ? `<h3>Objectives</h3><ul class="obj">${run.objectives.map((o) => `<li>${o.label}</li>`).join('')}</ul>` : ''}
    ${L.keys ? `<p class="keys">${L.keys}</p>` : ''}
    <div class="row"><button class="primary" id="b-go">Cast off (Enter)</button><button id="b-menu">Menu (Esc)</button></div>
  </div>`;
  overlay.style.display = 'flex';
  overlay.querySelector<HTMLButtonElement>('#b-go')!.onclick = beginSailing;
  overlay.querySelector<HTMLButtonElement>('#b-menu')!.onclick = toMenu;
}

function beginSailing() {
  overlay.style.display = 'none';
  mode = 'sailing';
  hud.root.style.display = 'block';
}

function showResult() {
  mode = 'result';
  const passed = run.status === 'passed';
  if (passed) saveResult(run.lesson.id, run.score);
  const failed = run.objectives.filter((_, i) => run.states[i]?.failed || (!run.states[i]?.done && run.objectives[i].kind === 'goal'));
  const idx = LESSONS.findIndex((l) => l.id === run.lesson.id);
  const next = LESSONS[idx + 1];
  overlay.innerHTML = `<div class="card-big ${passed ? 'pass' : 'fail'}">
    <h2>${passed ? `✓ Passed — score ${run.score}` : '✗ Not yet'}</h2>
    ${passed ? '<p>Well sailed.</p>' : `<p>Missed:</p><ul>${failed.map((o) => `<li>${o.label}</li>`).join('')}</ul>`}
    <div class="row">
      <button class="primary" id="b-retry">Retry</button>
      ${passed && next ? `<button id="b-next">Next: ${next.title}</button>` : ''}
      <button id="b-menu">Menu</button>
    </div></div>`;
  overlay.style.display = 'flex';
  overlay.querySelector<HTMLButtonElement>('#b-retry')!.onclick = () => lastChoice && choose(lastChoice);
  overlay.querySelector<HTMLButtonElement>('#b-next')?.addEventListener('click', () => choose({ kind: 'lesson', lesson: next }));
  overlay.querySelector<HTMLButtonElement>('#b-menu')!.onclick = toMenu;
}

function toMenu() {
  mode = 'menu';
  overlay.style.display = 'none';
  hud.root.style.display = 'none';
  hud.replay = null;
  startRun(demoLesson());
  menu.show();
}

// ---------- keyboard (R18) ----------
const HOLD: Record<string, [keyof ReturnType<typeof held>, number]> = {
  ArrowLeft: ['helm', -1],
  KeyA: ['helm', -1],
  ArrowRight: ['helm', 1],
  KeyD: ['helm', 1],
  KeyW: ['main', -1],
  KeyS: ['main', 1],
  KeyE: ['jib', -1],
  KeyQ: ['jib', 1],
  BracketLeft: ['traveler', -1],
  BracketRight: ['traveler', 1],
};

window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return;
  if (mode === 'briefing') {
    if (e.code === 'Enter' || e.code === 'Space') beginSailing();
    if (e.code === 'Escape') toMenu();
    e.preventDefault();
    return;
  }
  if (mode === 'result') {
    if (e.code === 'Enter') lastChoice && choose(lastChoice);
    if (e.code === 'Escape') toMenu();
    return;
  }
  if (mode !== 'sailing') return;
  const h = HOLD[e.code];
  if (h) {
    held()[h[0]] = h[1];
    e.preventDefault();
    return;
  }
  const once: Record<string, () => void> = {
    KeyT: actions.switchJib,
    KeyV: actions.vang,
    KeyB: actions.backstay,
    KeyG: actions.headsail,
    KeyH: actions.hike,
    KeyL: actions.lock,
    KeyI: actions.hint,
    F1: actions.hint,
    KeyX: () => run.sim.centerHelm(),
    KeyC: () => world.cycleCamera(),
    Space: () => (paused = !paused),
    Digit1: () => (timeScale = 1),
    Digit2: () => (timeScale = 4),
    Digit3: () => (timeScale = 16),
    Escape: toMenu,
    KeyR: () => (e.shiftKey ? run.sim.reefOut() : run.sim.reefIn()),
  };
  if (once[e.code] && !e.repeat) {
    once[e.code]();
    e.preventDefault();
  }
});
window.addEventListener('keyup', (e) => {
  const h = HOLD[e.code];
  if (h && mode === 'sailing' && held()[h[0]] === h[1]) held()[h[0]] = 0;
});
window.addEventListener('blur', () => {
  if (run) Object.assign(run.sim.held, { helm: 0, main: 0, jib: 0, traveler: 0 });
});

// ---------- main loop ----------
let last = performance.now();
function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (mode === 'menu') {
    demoAutopilot();
    run.advance(dt);
  } else if (mode === 'sailing' && !paused) {
    run.advance(dt * timeScale);
    if (hud.showHint && run.sim.t - hintT > 0.5) {
      hintT = run.sim.t;
      const s = run.sim;
      hint = autoTrim(s.state, s.effectiveControls(), s.wind.sample(s.state.x, s.state.y));
    }
    if (run.status !== 'running') showResult();
  }
  world.render(run.sim, now / 1000, true);
  if (mode === 'sailing' || mode === 'result')
    hud.update(run, run.coachMsg(), hud.showHint ? hint : null, {
      timeScale,
      camera: world.mode,
      paused,
    });
  requestAnimationFrame(frame);
}

// expose for smoke tests / debugging
(window as unknown as { __maxi: unknown }).__maxi = { get run() { return run; }, world, choose, LESSONS };

startRun(demoLesson());
hud.root.style.display = 'none';
menu.loadPresets().then(() => menu.show());
requestAnimationFrame(frame);
