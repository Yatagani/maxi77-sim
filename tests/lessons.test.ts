import { describe, expect, it } from 'vitest';
import { autoTrim } from '../src/sim/autotrim';
import { DEG, KN } from '../src/sim/boat';
import { coach } from '../src/sim/coach';
import { LESSONS, LessonRun, loadProgress, saveResult } from '../src/sim/lessons';
import { Simulation } from '../src/sim/sim';

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const STEP = 0.1;

/** Minimal autopilot used by the "ideal pilot" scripts. */
class Pilot {
  twa: number; // deg, signed (+ = wind from starboard)
  trim = true;
  lastTrim = -1;
  constructor(public run: LessonRun) {
    this.twa = run.sim.diag.twa / DEG;
    run.sim.tillerLock = true;
  }
  steer() {
    const sim = this.run.sim;
    const target = sim.wind.baseDir() * DEG - this.twa * DEG;
    const err = wrap(target - sim.state.heading);
    sim.controls.rudder = Math.max(-30 * DEG, Math.min(30 * DEG, 2.0 * err - 1.2 * sim.state.r));
    if (this.trim && sim.t - this.lastTrim >= 0.5) {
      this.lastTrim = sim.t;
      const w = sim.wind.sample(sim.state.x, sim.state.y);
      const h = autoTrim(sim.state, sim.effectiveControls(), w);
      sim.controls.mainsheet = h.mainsheet;
      sim.controls.traveler = h.traveler;
      sim.controls.jibSheet = h.jibSheet;
      if (sim.autoJib) sim.controls.jibSide = h.jibSide;
    }
  }
  tick() {
    this.steer();
    this.run.advance(STEP);
  }
  /** Beat toward the first mark, tacking on the laylines. */
  beat(headerTack = false) {
    const sim = this.run.sim;
    const m = this.run.marks[0];
    const bearing = Math.atan2(m.x - sim.state.x, m.y - sim.state.y);
    const rel = wrap(bearing - sim.wind.baseDir() * DEG) / DEG;
    const reachable = Math.abs(rel) > 45;
    if (reachable) {
      this.twa = -rel; // sail straight at it
      return;
    }
    const upTwa = 44;
    if (this.twa > 0 && rel >= 40) this.twa = -upTwa;
    else if (this.twa < 0 && rel <= -40) this.twa = upTwa;
    else if (Math.abs(this.twa) !== upTwa) this.twa = Math.sign(this.twa || 1) * upTwa;
    if (headerTack) {
      // Tack when the base wind is headed by > 7 deg relative to the shift centre
      const shift = wrap((sim.wind.baseDir() - sim.wind.base.dir) * DEG) / DEG;
      const headed = this.twa > 0 ? shift < -7 : shift > 7;
      if (headed && sim.t - (this.run.memo.lastPilotTack ?? -99) > 30) {
        this.run.memo.lastPilotTack = sim.t;
        this.twa = -this.twa;
      }
    }
  }
}

function until(r: LessonRun, fn: () => void) {
  while (r.status === 'running') fn();
  return r;
}

const lesson = (id: string) => LESSONS.find((l) => l.id === id)!;

describe('lessons with an ideal pilot (R24)', () => {
  it('has ten lessons across the three skills', () => {
    expect(LESSONS).toHaveLength(10);
    expect(new Set(LESSONS.map((l) => l.skill))).toEqual(new Set(['Sail trim', 'Maneuvers', 'Heavy weather']));
  });

  it('1 points of sail', () => {
    const r = new LessonRun(lesson('points-of-sail'));
    const p = new Pilot(r);
    until(r, () => {
      p.twa = r.sim.t < 40 ? 90 : r.sim.t < 80 ? 46 : 140;
      p.tick();
    });
    expect(r.status).toBe('passed');
  });

  it('2 upwind', () => {
    const r = new LessonRun(lesson('upwind'));
    const p = new Pilot(r);
    until(r, () => {
      p.beat();
      p.tick();
    });
    expect(r.status).toBe('passed');
  });

  it('3 tacking (manual jib)', () => {
    const r = new LessonRun(lesson('tacking'));
    const p = new Pilot(r);
    let lastTack = 0;
    let switched = true;
    until(r, () => {
      if (r.sim.t - lastTack > 30) {
        lastTack = r.sim.t;
        p.twa = -p.twa;
        switched = false;
      }
      if (!switched && r.sim.diag.jib?.backed && Math.sign(r.sim.diag.twa) === Math.sign(p.twa)) {
        r.sim.switchJib();
        switched = true;
      }
      p.tick();
    });
    expect(r.status).toBe('passed');
  });

  it('4 gybing (controlled)', () => {
    const r = new LessonRun(lesson('gybing'));
    const p = new Pilot(r);
    let last = 0;
    let phase: 'run' | 'prep' | 'turn' = 'run';
    let gybes = 0;
    until(r, () => {
      const nGybes = r.sim.events.filter((e) => e.type === 'gybe').length;
      if (phase === 'run' && r.sim.t - last > 25) {
        phase = 'prep';
        p.trim = false;
        r.sim.controls.mainsheet = 0.12; // centre the boom first
        r.sim.controls.traveler = 0;
      } else if (phase === 'prep' && Math.abs(r.sim.state.boom) < 18 * DEG) {
        phase = 'turn';
        gybes = nGybes;
        p.twa = -Math.sign(p.twa) * 140;
      } else if (phase === 'turn' && nGybes > gybes && Math.abs(r.sim.diag.twa) > 120 * DEG) {
        phase = 'run';
        p.trim = true;
        last = r.sim.t;
      }
      p.tick();
    });
    expect(r.sim.events.filter((e) => e.type === 'crashGybe')).toHaveLength(0);
    expect(r.status).toBe('passed');
  });

  it('4b easing the main fully before gybing causes a crash gybe', () => {
    const r = new LessonRun(lesson('gybing'));
    const p = new Pilot(r);
    p.trim = false;
    r.sim.controls.mainsheet = 1;
    p.twa = Math.sign(p.twa) * 140;
    for (let i = 0; i < 50; i++) p.tick();
    p.twa = -p.twa;
    for (let i = 0; i < 200 && r.status === 'running'; i++) p.tick();
    expect(r.sim.events.some((e) => e.type === 'crashGybe')).toBe(true);
    expect(r.status).toBe('failed');
  });

  it('5 out of irons by backing the jib', () => {
    const r = new LessonRun(lesson('irons'));
    const sim = r.sim;
    sim.tillerLock = true;
    // Back the jib to starboard: pushes bow to port; reverse rudder while going backwards.
    sim.controls.jibSide = 1;
    sim.controls.jibSheet = 0;
    sim.controls.mainsheet = 1;
    const p = new Pilot(r);
    p.trim = false;
    let sailing = false;
    until(r, () => {
      if (!sailing) {
        sim.controls.rudder = sim.state.u < 0 ? 25 * DEG : -25 * DEG;
        if (sim.diag.twa > 55 * DEG || sim.diag.twa < -55 * DEG) {
          sailing = true;
          p.trim = true;
          sim.autoJib = true;
          p.twa = (sim.diag.twa / DEG > 0 ? 1 : -1) * 75;
        }
        r.advance(STEP);
      } else p.tick();
    });
    expect(r.status).toBe('passed');
  });

  it('6 heaving to', () => {
    const r = new LessonRun(lesson('heave-to'));
    const sim = r.sim;
    const p = new Pilot(r);
    for (let i = 0; i < 80; i++) p.tick();
    // Tack without switching the jib
    p.trim = false;
    p.twa = -p.twa;
    for (let i = 0; i < 60; i++) p.tick();
    sim.controls.mainsheet = 0.35;
    sim.controls.traveler = 0;
    const side = Math.sign(sim.diag.twa);
    sim.controls.rudder = side * 30 * DEG; // tiller to leeward = rudder turns toward the wind
    until(r, () => r.advance(STEP));
    expect(sim.diag.jib?.backed).toBe(true);
    expect(r.status).toBe('passed');
  });

  it('7 gusts and lulls', () => {
    const r = new LessonRun(lesson('gusts'));
    const p = new Pilot(r);
    r.sim.controls.hike = true;
    until(r, () => {
      p.beat();
      p.tick();
    });
    expect(r.status).toBe('passed');
  });

  it('8 wind shifts', () => {
    const r = new LessonRun(lesson('shifts'));
    const p = new Pilot(r);
    until(r, () => {
      p.beat(true);
      p.tick();
    });
    expect(r.status).toBe('passed');
  });

  it('9 reefing', () => {
    const r = new LessonRun(lesson('reefing'));
    const p = new Pilot(r);
    r.sim.controls.hike = true;
    until(r, () => {
      const base = r.sim.wind.base.speed;
      if (base > 14 && r.sim.controls.reef === 0 && !r.sim.reefing) r.sim.reefIn();
      if (base > 16 && r.sim.controls.headsail === 'genoa' && !r.sim.headsailChange && !r.sim.reefing) r.sim.changeHeadsail();
      if (base > 19 && r.sim.controls.reef === 1 && !r.sim.reefing && !r.sim.headsailChange) r.sim.reefIn();
      if (base > 15) r.sim.controls.backstay = 2;
      p.beat();
      p.tick();
    });
    expect(r.status).toBe('passed');
  });

  it('10 squall', () => {
    const r = new LessonRun(lesson('squall'));
    const p = new Pilot(r);
    until(r, () => {
      if (r.sim.t > 60 && r.sim.controls.reef === 0 && !r.sim.reefing) {
        r.sim.reefIn();
        r.sim.controls.backstay = 2;
        r.sim.controls.hike = true;
      }
      if (r.sim.t > 80 && r.sim.controls.reef === 1 && !r.sim.reefing) r.sim.reefIn();
      if (r.sim.t > 76 && r.sim.controls.headsail === 'genoa' && !r.sim.headsailChange) r.sim.changeHeadsail();
      const m = r.marks[0];
      const bearing = Math.atan2(m.x - r.sim.state.x, m.y - r.sim.state.y);
      p.twa = wrap(r.sim.wind.baseDir() * DEG - bearing) / DEG;
      // never sail dead downwind in the squall
      if (Math.abs(p.twa) > 155) p.twa = Math.sign(p.twa) * 155;
      p.tick();
    });
    expect(r.status).toBe('passed');
  });
});

describe('events and coach (R25)', () => {
  it('detects irons and tells the user how to get out', () => {
    const sim = new Simulation({ wind: [{ t: 0, speed: 10, dir: 0 }], twa: 0, speedKn: 0 });
    sim.advance(5);
    expect(sim.events.some((e) => e.type === 'irons')).toBe(true);
    expect(coach(sim)?.id).toBe('irons');
  });
  it('flags overpowered when heeled past 25 degrees', () => {
    const sim = new Simulation({
      wind: [{ t: 0, speed: 22, dir: 0 }],
      twa: 50,
      speedKn: 5,
      controls: { mainsheet: 0.02, jibSheet: 0.02 },
    });
    sim.tillerLock = true;
    sim.advance(8);
    expect(Math.abs(sim.state.heel) / DEG).toBeGreaterThan(25);
    expect(['overpowered', 'roundUp', 'knockdown']).toContain(coach(sim)?.id);
  });
  it('says the jib is luffing when eased on a reach', () => {
    const sim = new Simulation({ wind: [{ t: 0, speed: 10, dir: 0 }], twa: 70, speedKn: 4, controls: { jibSheet: 1, mainsheet: 0.3 } });
    sim.tillerLock = true;
    sim.advance(1);
    expect(coach(sim)?.id).toBe('jibLuff');
  });
  it('detects the tack event and auto-switches the jib', () => {
    const sim = new Simulation({ wind: [{ t: 0, speed: 10, dir: 0 }], twa: 45, speedKn: 4.5 });
    const side0 = sim.controls.jibSide;
    sim.tillerLock = true;
    sim.controls.rudder = 25 * DEG; // wind from starboard: turning to starboard tacks
    sim.advance(8);
    expect(sim.events.some((e) => e.type === 'tack')).toBe(true);
    expect(sim.controls.jibSide).toBe(-side0);
  });
  it('reefing takes time and then reduces sail area', () => {
    const sim = new Simulation({ wind: [{ t: 0, speed: 10, dir: 0 }], twa: 45, speedKn: 4 });
    sim.reefIn();
    sim.advance(5);
    expect(sim.controls.reef).toBe(0);
    sim.advance(11);
    expect(sim.controls.reef).toBe(1);
    expect(sim.events.some((e) => e.type === 'reef')).toBe(true);
  });
  it('speed knots helper sanity', () => expect(KN).toBeCloseTo(0.5144, 3));
});

describe('progress storage (R26)', () => {
  it('works without localStorage', () => {
    expect(loadProgress()).toEqual({});
    expect(saveResult('upwind', 80).upwind.best).toBe(80);
  });
});
