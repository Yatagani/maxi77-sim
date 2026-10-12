import { DEG, KN } from './boat';
import { coach, type CoachOptions } from './coach';
import { mainLimit, type Controls } from './physics';
import { Simulation, type EventType } from './sim';
import type { WindKey } from './wind';

export interface Mark {
  id: string;
  x: number;
  y: number;
  label: string;
}

export interface ObjectiveState {
  done: boolean;
  failed: boolean;
  progress: string;
}

export interface Objective {
  label: string;
  kind: 'goal' | 'avoid';
  update(run: LessonRun, dt: number): ObjectiveState;
}

export interface Lesson {
  id: string;
  n: number;
  title: string;
  skill: 'Sail trim' | 'Maneuvers' | 'Heavy weather';
  briefing: string[];
  keys: string;
  wind: WindKey[];
  start: { twa: number; speedKn: number; controls?: Partial<Controls> };
  autoJib: boolean;
  timeLimit: number; // s
  marks?: (windDir: number) => Mark[];
  objectives: (marks: Mark[]) => Objective[];
  coach?: CoachOptions;
  announcements?: { t: number; text: string }[];
}

// ---------- objective factories ----------

const fmt = (s: number) => `${Math.floor(s)}s`;

export function reach(mark: Mark, radius = 30): Objective {
  let done = false;
  return {
    label: `Reach ${mark.label}`,
    kind: 'goal',
    update(run) {
      const s = run.sim.state;
      const d = Math.hypot(s.x - mark.x, s.y - mark.y);
      if (d < radius) done = true;
      return { done, failed: false, progress: done ? 'done' : `${Math.round(d)} m` };
    },
  };
}

export function hold(
  label: string,
  seconds: number,
  pred: (run: LessonRun) => boolean,
  continuous = false,
): Objective {
  let acc = 0;
  let done = false;
  return {
    label,
    kind: 'goal',
    update(run, dt) {
      if (!done) {
        if (pred(run)) acc += dt;
        else if (continuous) acc = 0;
        if (acc >= seconds) done = true;
      }
      return { done, failed: false, progress: done ? 'done' : `${fmt(acc)} / ${seconds}s` };
    },
  };
}

export function count(label: string, n: number, type: EventType, filter?: (run: LessonRun, t: number) => boolean): Objective {
  return {
    label,
    kind: 'goal',
    update(run) {
      const k = run.sim.events.filter((e) => e.type === type && (!filter || filter(run, e.t))).length;
      return { done: k >= n, failed: false, progress: `${Math.min(k, n)} / ${n}` };
    },
  };
}

export function avoid(label: string, type: EventType): Objective {
  return {
    label,
    kind: 'avoid',
    update(run) {
      const failed = run.sim.events.some((e) => e.type === type);
      return { done: !failed, failed, progress: failed ? 'failed' : 'ok' };
    },
  };
}

export function heelBudget(maxDeg: number, seconds: number): Objective {
  let acc = 0;
  return {
    label: `Keep heel under ${maxDeg}° (budget ${seconds}s)`,
    kind: 'avoid',
    update(run, dt) {
      if (Math.abs(run.sim.state.heel) > maxDeg * DEG) acc += dt;
      const failed = acc > seconds;
      return { done: !failed, failed, progress: `${acc.toFixed(1)}s over` };
    },
  };
}

/** Tacks where the jib is on the new leeward side within 8 s and the boat is moving again within 20 s. */
export function goodTacks(n: number): Objective {
  const pending: { t: number; jibOk: boolean }[] = [];
  let good = 0;
  let seen = 0;
  return {
    label: `${n} clean tacks (switch the jib with T, keep moving)`,
    kind: 'goal',
    update(run) {
      const sim = run.sim;
      const tacks = sim.events.filter((e) => e.type === 'tack');
      while (seen < tacks.length) pending.push({ t: tacks[seen++].t, jibOk: false });
      for (let i = pending.length - 1; i >= 0; i--) {
        const p = pending[i];
        const age = sim.t - p.t;
        if (age < 8 && sim.diag.jib && !sim.diag.jib.backed && sim.controls.jibSide === -Math.sign(sim.diag.twa))
          p.jibOk = true;
        if (age >= 20) {
          if (p.jibOk && sim.diag.speed > 2.5 * KN) good++;
          pending.splice(i, 1);
        }
      }
      return { done: good >= n, failed: false, progress: `${Math.min(good, n)} / ${n}` };
    },
  };
}

/** Tacks made shortly after a header (wind shifted toward the bow on the old tack). */
export function headerTacks(n: number): Objective {
  const hist: number[] = [];
  let lastSample = -1;
  let lastSign = 0;
  let seen = 0;
  let good = 0;
  return {
    label: `Tack on ${n} headers (wind shifted toward your bow)`,
    kind: 'goal',
    update(run) {
      const sim = run.sim;
      if (sim.t - lastSample >= 1) {
        lastSample = sim.t;
        hist.push(sim.wind.baseDir());
        if (hist.length > 90) hist.shift();
      }
      const tacks = sim.events.filter((e) => e.type === 'tack');
      while (seen < tacks.length) {
        seen++;
        if (hist.length > 30 && lastSign !== 0) {
          // Compare wind before the tack manoeuvre (5 s ago) with the average of the minute before
          const before = hist[hist.length - 6];
          const avg = hist.slice(0, -6).reduce((a, b) => a + ((b - before + 540) % 360) - 180, 0) / (hist.length - 6);
          const shift = -avg; // before - mean
          if (lastSign * shift < -4) good++;
        }
      }
      if (Math.abs(sim.diag.twa) < 80 * DEG && Math.abs(sim.diag.twa) > 25 * DEG) lastSign = Math.sign(sim.diag.twa);
      return { done: good >= n, failed: false, progress: `${Math.min(good, n)} / ${n}` };
    },
  };
}

// ---------- helpers ----------

const SSW = 200; // typical Oslofjord sea breeze direction

function upwindMark(dir: number, dist: number, id = 'W', label = 'the windward mark'): Mark {
  return { id, x: Math.sin(dir * DEG) * dist, y: Math.cos(dir * DEG) * dist, label };
}

function bearingMark(bearing: number, dist: number, id: string, label: string): Mark {
  return { id, x: Math.sin(bearing * DEG) * dist, y: Math.cos(bearing * DEG) * dist, label };
}

const twaAbs = (run: LessonRun) => Math.abs(run.sim.diag.twa) / DEG;
const jibStreaming = (run: LessonRun) => {
  const j = run.sim.diag.jib;
  return !!j && !j.backed && j.windward === 'stream' && j.leeward === 'stream';
};

// ---------- the lessons (R24) ----------

export const LESSONS: Lesson[] = [
  {
    id: 'points-of-sail',
    n: 1,
    title: 'Points of sail & telltales',
    skill: 'Sail trim',
    briefing: [
      'The red/green ribbons on the jib luff are telltales. Both streaming aft = perfect trim.',
      'Windward telltale lifting: sheet in or bear away. Leeward telltale stalling: ease or head up.',
      'Try three points of sail: beam reach, close-hauled, broad reach. The coach tells you what to adjust.',
    ],
    keys: '←/→ steer · W/S main in/out · E/Q jib in/out',
    wind: [{ t: 0, speed: 8, dir: SSW }],
    start: { twa: 90, speedKn: 2, controls: { mainsheet: 0.9, jibSheet: 0.9 } },
    autoJib: true,
    timeLimit: 480,
    objectives: () => [
      hold('Beam reach (TWA 75–105°), telltales streaming 10 s', 10, (r) => twaAbs(r) > 75 && twaAbs(r) < 105 && jibStreaming(r)),
      hold('Close-hauled (TWA 40–55°), telltales streaming 10 s', 10, (r) => twaAbs(r) > 40 && twaAbs(r) < 55 && jibStreaming(r)),
      hold(
        'Broad reach (TWA 120–155°), main eased past 40°, 10 s',
        10,
        (r) => twaAbs(r) > 120 && twaAbs(r) < 155 && Math.abs(r.sim.state.boom) > 40 * DEG,
      ),
    ],
  },
  {
    id: 'upwind',
    n: 2,
    title: 'Upwind: close-hauled',
    skill: 'Sail trim',
    briefing: [
      'You cannot sail straight into the wind. Sail ~45° off it and zig-zag (tack).',
      'Sheet both sails in hard, then steer by the jib telltales: luffing → bear away, stalled → head up.',
      'Reach the windward mark 400 m upwind. The jib switches sides automatically in this lesson.',
    ],
    keys: '←/→ steer · W/S main · E/Q jib',
    wind: [{ t: 0, speed: 10, dir: SSW, gustAmp: 2, gustRate: 0.4, shiftAmp: 4, shiftPeriod: 240 }],
    start: { twa: 45, speedKn: 3, controls: { mainsheet: 0.15, jibSheet: 0.15 } },
    autoJib: true,
    timeLimit: 600,
    marks: (dir) => [upwindMark(dir, 400)],
    objectives: (m) => [
      reach(m[0]),
      hold('Close-hauled with streaming telltales 60 s', 60, (r) => twaAbs(r) > 38 && twaAbs(r) < 55 && jibStreaming(r)),
    ],
  },
  {
    id: 'tacking',
    n: 3,
    title: 'Tacking',
    skill: 'Maneuvers',
    briefing: [
      'Tack = turn the bow through the wind. "Ready about" — steer firmly (not violently) through ~90°.',
      'As the jib starts to back, release the old sheet and sheet in on the new side (T switches, then E).',
      'Keep the rudder moving the boat through; stopping head-to-wind leaves you in irons.',
    ],
    keys: '←/→ steer · T switch jib sheet · E/Q jib · W/S main',
    wind: [{ t: 0, speed: 10, dir: SSW, gustAmp: 1, gustRate: 0.3 }],
    start: { twa: 45, speedKn: 4.5, controls: { mainsheet: 0.12, jibSheet: 0.12 } },
    autoJib: false,
    timeLimit: 420,
    objectives: () => [goodTacks(4), avoid('Do not get stuck in irons', 'irons')],
  },
  {
    id: 'gybing',
    n: 4,
    title: 'Gybing',
    skill: 'Maneuvers',
    briefing: [
      'Gybe = turn the stern through the wind. The boom swings across — fast and hard if you let it.',
      'Controlled gybe: sheet the main to the centre (W) BEFORE the stern crosses, turn, then ease out (S) on the new side.',
      'Do 3 controlled gybes. A crash gybe (boom more than 30° out when it crosses) fails the lesson.',
    ],
    keys: '←/→ steer · W/S main · auto jib',
    wind: [{ t: 0, speed: 12, dir: SSW, gustAmp: 3, gustRate: 0.5 }],
    start: { twa: 140, speedKn: 5, controls: { mainsheet: 0.6, jibSheet: 0.6 } },
    autoJib: true,
    timeLimit: 420,
    objectives: () => [
      count('3 controlled gybes', 3, 'gybe', (r, t) => !r.sim.events.some((e) => e.type === 'crashGybe' && Math.abs(e.t - t) < 0.5)),
      avoid('No crash gybes', 'crashGybe'),
    ],
  },
  {
    id: 'irons',
    n: 5,
    title: 'Getting out of irons',
    skill: 'Maneuvers',
    briefing: [
      'You are stopped head-to-wind: sails flogging, rudder useless.',
      'Back the jib: sheet it in (E) on the side you want the bow to fall AWAY from (T picks the side). Ease the main (S).',
      'As you drift backwards, the rudder works in reverse: steer the opposite way. Once beam-on, switch the jib (T) and sail away.',
    ],
    keys: 'T jib side · E/Q jib · W/S main · ←/→ steer',
    wind: [{ t: 0, speed: 9, dir: SSW }],
    start: { twa: 0, speedKn: 0, controls: { mainsheet: 0.6, jibSheet: 0.4 } },
    autoJib: false,
    timeLimit: 150,
    objectives: () => [
      hold('Sailing at 2.5+ kn with TWA over 45° for 5 s', 5, (r) => r.sim.diag.speed > 2.5 * KN && twaAbs(r) > 45, true),
    ],
  },
  {
    id: 'heave-to',
    n: 6,
    title: 'Heaving to',
    skill: 'Maneuvers',
    briefing: [
      'Heaving to parks the boat in a breeze: jib backed, main partly eased, tiller lashed to leeward.',
      'From close-hauled, tack but do NOT switch the jib sheet. Ease the main about a third (S) — fully eased and the backed jib blows the bow off.',
      'Steer towards the wind and lock the tiller there (L). A light fin-keeler like the Maxi 77 settles ~50° off the wind and forereaches slowly (~2 kn) while drifting sideways.',
    ],
    keys: '←/→ steer · L lock tiller · S ease main',
    wind: [{ t: 0, speed: 14, dir: SSW, gustAmp: 3, gustRate: 0.4 }],
    start: { twa: 45, speedKn: 4, controls: { mainsheet: 0.12, jibSheet: 0.1, headsail: 'jib' } },
    autoJib: false,
    timeLimit: 240,
    coach: { allowBackedJib: true },
    objectives: () => [
      hold(
        'Hove-to (jib backed, < 2.8 kn, TWA 40–75°) for 30 s',
        30,
        (r) => !!r.sim.diag.jib?.backed && r.sim.diag.speed < 2.8 * KN && twaAbs(r) > 40 && twaAbs(r) < 75,
        true,
      ),
    ],
  },
  {
    id: 'gusts',
    n: 7,
    title: 'Gusts & lulls',
    skill: 'Heavy weather',
    briefing: [
      'Gusts show as dark patches on the water moving downwind toward you. Watch for them.',
      'In a gust: ease the main or feather up slightly to keep heel under ~25°. In a lull: sheet back in, bear away to build speed.',
      'The traveler ( [ / ] ) lets you depower the main without twisting it. Hiking (H) adds righting moment.',
    ],
    keys: '←/→ · W/S main · [ ] traveler · H hike',
    wind: [{ t: 0, speed: 12, dir: SSW, gustAmp: 8, gustRate: 0.9 }],
    start: { twa: 45, speedKn: 4, controls: { mainsheet: 0.15, jibSheet: 0.15 } },
    autoJib: true,
    timeLimit: 720,
    marks: (dir) => [upwindMark(dir, 600)],
    objectives: (m) => [reach(m[0]), heelBudget(30, 15), avoid('No knockdown', 'knockdown')],
  },
  {
    id: 'shifts',
    n: 8,
    title: 'Wind shifts',
    skill: 'Sail trim',
    briefing: [
      'The wind direction oscillates by ±15°. A header forces you to bear away; a lift lets you point higher.',
      'Rule of thumb: tack on headers. Your new tack will then be lifted.',
      'Watch the wind arrow on the instrument and how the telltales change without you touching anything.',
    ],
    keys: '←/→ · W/S · E/Q',
    wind: [{ t: 0, speed: 10, dir: SSW, gustAmp: 2, gustRate: 0.4, shiftAmp: 15, shiftPeriod: 180 }],
    start: { twa: 45, speedKn: 4, controls: { mainsheet: 0.12, jibSheet: 0.12 } },
    autoJib: true,
    timeLimit: 720,
    marks: (dir) => [upwindMark(dir, 700)],
    objectives: (m) => [reach(m[0]), headerTacks(2)],
  },
  {
    id: 'reefing',
    n: 9,
    title: 'Reefing in a building breeze',
    skill: 'Heavy weather',
    briefing: [
      'The sea breeze is building from 10 to 22 knots. Reef early: "the time to reef is when you first think of it".',
      'R takes a reef (15 s, main is down meanwhile). G swaps the genoa for the small jib (45 s on main only).',
      'Take a reef before the wind reaches 18 kn, then beat to the windward mark without being knocked flat.',
    ],
    keys: 'R reef · G headsail · B backstay · H hike',
    wind: [
      { t: 0, speed: 10, dir: SSW, gustAmp: 3, gustRate: 0.6 },
      { t: 240, speed: 22, dir: SSW + 10, gustAmp: 6, gustRate: 0.8 },
    ],
    start: { twa: 45, speedKn: 4, controls: { mainsheet: 0.15, jibSheet: 0.15 } },
    autoJib: true,
    timeLimit: 840,
    marks: (dir) => [upwindMark(dir, 900)],
    objectives: (m) => [
      count('Reef before the breeze reaches 18 kn', 1, 'reef', (r, t) => baseSpeedAt(r, t) < 18),
      reach(m[0]),
      heelBudget(30, 15),
      avoid('No knockdown', 'knockdown'),
    ],
  },
  {
    id: 'squall',
    n: 10,
    title: 'Squall',
    skill: 'Heavy weather',
    briefing: [
      'A light day — but a squall line is coming. It brings ~24 kn gusting 30+ and a 50° wind shift.',
      'Prepare BEFORE it hits: reef (R), smaller headsail (G), backstay on (B). When it hits, ease and bear away; avoid a crash gybe after the shift.',
      'Sail to the reaching mark 1.1 km away.',
    ],
    keys: 'R · G · B · S/W · [ ]',
    wind: [
      { t: 0, speed: 8, dir: SSW, gustAmp: 1, gustRate: 0.3 },
      { t: 95, speed: 8, dir: SSW, gustAmp: 1, gustRate: 0.3 },
      { t: 115, speed: 24, dir: 250, gustAmp: 8, gustRate: 1 },
      { t: 240, speed: 22, dir: 250, gustAmp: 7, gustRate: 1 },
      { t: 320, speed: 12, dir: 230, gustAmp: 3, gustRate: 0.5 },
    ],
    start: { twa: 90, speedKn: 4, controls: { mainsheet: 0.4, jibSheet: 0.4 } },
    autoJib: true,
    timeLimit: 600,
    marks: () => [bearingMark(110, 1100, 'R', 'the reaching mark')],
    announcements: [{ t: 55, text: 'Dark line on the water upwind — squall in under a minute! Reef (R) and swap to the jib (G) now.' }],
    objectives: (m) => [
      {
        label: 'Reefed or on the small jib when the squall hits',
        kind: 'goal',
        update(run) {
          const c = run.sim.controls;
          const ready = c.reef > 0 || c.headsail === 'jib' || !!run.sim.reefing || !!run.sim.headsailChange;
          if (run.sim.t >= 115 && run.memo.squallReady === undefined) run.memo.squallReady = ready ? 1 : 0;
          const v = run.memo.squallReady;
          return { done: v === 1, failed: v === 0, progress: v === undefined ? (ready ? 'ready' : 'not yet') : v ? 'done' : 'too late' };
        },
      },
      reach(m[0], 40),
      avoid('No knockdown', 'knockdown'),
    ],
  },
];

function baseSpeedAt(run: LessonRun, t: number): number {
  // Wind keys are deterministic, so look up the base speed at event time.
  return run.windSpeedLog.find((e) => e.t >= t - 0.6)?.speed ?? Infinity;
}

// ---------- lesson runner ----------

export type RunStatus = 'running' | 'passed' | 'failed';

export class LessonRun {
  sim: Simulation;
  objectives: Objective[];
  states: ObjectiveState[] = [];
  marks: Mark[];
  status: RunStatus = 'running';
  score = 0;
  memo: Record<string, number | undefined> = {};
  windSpeedLog: { t: number; speed: number }[] = [];
  private announced = new Set<number>();
  announcement: string | null = null;

  constructor(
    public lesson: Lesson,
    seed = 11,
  ) {
    this.sim = new Simulation({
      wind: lesson.wind,
      seed,
      twa: lesson.start.twa,
      speedKn: lesson.start.speedKn,
      controls: lesson.start.controls,
      autoJib: lesson.autoJib,
    });
    this.marks = lesson.marks ? lesson.marks(lesson.wind[0].dir) : [];
    this.objectives = lesson.objectives(this.marks);
    this.update(0);
  }

  coachMsg() {
    return coach(this.sim, this.lesson.coach);
  }

  /** Call after advancing the simulation by dt. */
  update(dt: number) {
    if (this.status !== 'running') return;
    const last = this.windSpeedLog[this.windSpeedLog.length - 1];
    if (!last || this.sim.t - last.t >= 0.5) this.windSpeedLog.push({ t: this.sim.t, speed: this.sim.wind.base.speed });
    this.states = this.objectives.map((o) => o.update(this, dt));
    for (const a of this.lesson.announcements ?? []) {
      if (this.sim.t >= a.t && !this.announced.has(a.t)) {
        this.announced.add(a.t);
        this.announcement = a.text;
      }
    }
    const goals = this.states.filter((_, i) => this.objectives[i].kind === 'goal');
    if (this.states.some((s) => s.failed)) this.status = 'failed';
    else if (goals.length > 0 && goals.every((s) => s.done)) {
      this.status = 'passed';
      const bad = this.sim.events.filter((e) => ['crashGybe', 'roundUp', 'knockdown', 'irons'].includes(e.type)).length;
      this.score = Math.max(10, Math.round(100 - (50 * this.sim.t) / this.lesson.timeLimit - 10 * bad));
    } else if (this.sim.t > this.lesson.timeLimit) this.status = 'failed';
  }

  /** Advance sim and lesson together. */
  advance(dt: number) {
    this.sim.advance(dt);
    this.update(dt);
  }

  /** Main is depowered in a meaningful way (used by UI hints). */
  depowered(): boolean {
    const c = this.sim.controls;
    return c.reef > 0 || c.backstay === 2 || mainLimit(c) > 20 * DEG;
  }
}

// ---------- progress (R26) ----------

export interface Progress {
  [lessonId: string]: { passed: boolean; best: number };
}

const KEY = 'maxi77.progress.v1';

export function loadProgress(): Progress {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(KEY) ?? '{}') as Progress;
  } catch {
    return {};
  }
}

export function saveResult(id: string, score: number): Progress {
  const p = loadProgress();
  const prev = p[id];
  p[id] = { passed: true, best: Math.max(prev?.best ?? 0, score) };
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable: progress lives for this session only */
  }
  return p;
}
