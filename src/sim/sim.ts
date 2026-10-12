import { DEG, KN } from './boat';
import {
  defaultControls,
  initialState,
  mainLimit,
  step,
  type BoatState,
  type Controls,
  type Diag,
} from './physics';
import { WindField, type WindKey } from './wind';
import type { Headsail } from './boat';

export type EventType = 'tack' | 'gybe' | 'crashGybe' | 'roundUp' | 'knockdown' | 'irons' | 'reef' | 'headsail';

export interface SimEvent {
  t: number;
  type: EventType;
  tws: number; // knots at the time
}

/** Held inputs, each -1, 0 or +1. */
export interface HeldInput {
  helm: number; // +1 = bear the bow to starboard
  main: number; // +1 = ease
  jib: number; // +1 = ease
  traveler: number; // +1 = drop to leeward
}

export const DT = 1 / 120;
const HELM_RATE = 50 * DEG;
const HELM_RETURN = 30 * DEG;
const SHEET_RATE = 0.4;
const HEADSAIL_CHANGE_S = 45;
const REEF_S = 15;

export interface SimOptions {
  wind: WindKey[];
  seed?: number;
  heading?: number; // deg; default derived from twa
  twa?: number; // deg, + = wind from starboard
  speedKn?: number;
  controls?: Partial<Controls>;
  autoJib?: boolean;
}

export class Simulation {
  state: BoatState;
  controls: Controls;
  wind: WindField;
  t = 0;
  diag!: Diag;
  events: SimEvent[] = [];
  autoJib: boolean;
  tillerLock = false;
  held: HeldInput = { helm: 0, main: 0, jib: 0, traveler: 0 };
  headsailChange: { target: Headsail; remaining: number } | null = null;
  reefing: { target: 0 | 1 | 2; remaining: number } | null = null;
  /** Seconds the boat has been nearly stopped head to wind. */
  ironsTime = 0;
  private lastTwa = 0;
  private lastBoomSide = 0;
  private lastEvent: Partial<Record<EventType, number>> = {};

  constructor(opts: SimOptions) {
    this.wind = new WindField(opts.wind, opts.seed ?? 7);
    const twd = this.wind.baseDir();
    const heading = opts.heading ?? (twd - (opts.twa ?? 45) + 360) % 360;
    this.state = initialState(heading * DEG, (opts.speedKn ?? 0) * KN);
    this.controls = { ...defaultControls(), ...opts.controls };
    this.autoJib = opts.autoJib ?? true;
    const twa = ((twd - heading + 540) % 360) - 180;
    if (opts.controls?.jibSide === undefined) this.controls.jibSide = twa > 0 ? -1 : 1;
    this.wind.step(0, 0, 0);
    this.diag = step(this.state, this.effectiveControls(), this.wind.sample(0, 0), 0);
    this.lastTwa = this.diag.twa;
    this.state.boom = this.diag.boomTarget;
    this.lastBoomSide = Math.sign(this.state.boom);
  }

  /** Controls as the physics sees them (sail changes in progress). */
  effectiveControls(): Controls {
    const c = { ...this.controls };
    if (this.headsailChange) c.headsail = 'none';
    if (this.reefing) c.mainsheet = 1; // halyard down, main flogging while reefing
    return c;
  }

  private emit(type: EventType, debounce = 0) {
    const last = this.lastEvent[type];
    if (debounce && last !== undefined && this.t - last < debounce) return;
    this.lastEvent[type] = this.t;
    this.events.push({ t: this.t, type, tws: this.diag.tws / KN });
  }

  // ---- discrete actions ----
  switchJib() {
    this.controls.jibSide = this.controls.jibSide === 1 ? -1 : 1;
  }
  cycleVang() {
    this.controls.vang = ((this.controls.vang + 1) % 3) as 0 | 1 | 2;
  }
  cycleBackstay() {
    this.controls.backstay = ((this.controls.backstay + 1) % 3) as 0 | 1 | 2;
  }
  reefIn() {
    if (this.reefing || this.controls.reef >= 2) return;
    this.reefing = { target: (this.controls.reef + 1) as 1 | 2, remaining: REEF_S };
  }
  reefOut() {
    if (this.reefing || this.controls.reef <= 0) return;
    this.reefing = { target: (this.controls.reef - 1) as 0 | 1, remaining: REEF_S };
  }
  changeHeadsail() {
    if (this.headsailChange) return;
    const target: Headsail = this.controls.headsail === 'genoa' ? 'jib' : 'genoa';
    this.headsailChange = { target, remaining: HEADSAIL_CHANGE_S };
  }
  toggleHike() {
    this.controls.hike = !this.controls.hike;
  }
  centerHelm() {
    this.controls.rudder = 0;
  }

  /** Advance by dt seconds of sim time in fixed substeps. */
  advance(dt: number) {
    const n = Math.max(1, Math.round(dt / DT));
    for (let i = 0; i < n; i++) this.tick();
  }

  tick() {
    const dt = DT;
    const c = this.controls;
    const h = this.held;
    const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
    if (h.helm) {
      c.rudder = Math.max(-35 * DEG, Math.min(35 * DEG, c.rudder + h.helm * HELM_RATE * dt));
    } else if (!this.tillerLock) {
      const d = HELM_RETURN * dt;
      c.rudder = Math.abs(c.rudder) < d ? 0 : c.rudder - Math.sign(c.rudder) * d;
    }
    c.mainsheet = clamp01(c.mainsheet + h.main * SHEET_RATE * dt);
    c.jibSheet = clamp01(c.jibSheet + h.jib * SHEET_RATE * dt);
    c.traveler = clamp01(c.traveler + h.traveler * 0.5 * dt);

    if (this.headsailChange) {
      this.headsailChange.remaining -= dt;
      if (this.headsailChange.remaining <= 0) {
        c.headsail = this.headsailChange.target;
        this.headsailChange = null;
        this.emit('headsail');
      }
    }
    if (this.reefing) {
      this.reefing.remaining -= dt;
      if (this.reefing.remaining <= 0) {
        const up = this.reefing.target > c.reef;
        c.reef = this.reefing.target;
        this.reefing = null;
        if (up) this.emit('reef');
      }
    }

    const s = this.state;
    this.wind.step(dt, s.x, s.y);
    const w = this.wind.sample(s.x, s.y);
    this.t += dt;
    this.diag = step(s, this.effectiveControls(), w, dt);
    this.detect();
  }

  private detect() {
    const d = this.diag;
    const s = this.state;
    const twa = d.twa;
    // Tack: bow passes through the wind
    if (Math.sign(twa) !== Math.sign(this.lastTwa) && Math.abs(twa) < 90 * DEG && Math.abs(this.lastTwa) < 90 * DEG) {
      this.emit('tack', 2);
      if (this.autoJib) this.controls.jibSide = twa > 0 ? -1 : 1;
    }
    if (Math.sign(twa) !== Math.sign(this.lastTwa) && Math.abs(twa) > 90 * DEG && this.autoJib) {
      this.controls.jibSide = twa > 0 ? -1 : 1;
    }
    this.lastTwa = twa;

    // Gybe: the boom target flips sides while sailing downwind
    const side = Math.sign(d.boomTarget);
    if (side !== 0 && this.lastBoomSide !== 0 && side !== this.lastBoomSide && Math.abs(d.awa) > 100 * DEG) {
      const lim = mainLimit(this.effectiveControls());
      const twsKn = d.tws / KN;
      this.emit('gybe', 2);
      if (lim > 30 * DEG && twsKn > 8) {
        this.emit('crashGybe', 2);
        const k = (lim / (85 * DEG)) * Math.min(2.5, (twsKn / 15) ** 2);
        s.p += side * 0.6 * k;
        s.r += -side * 0.3 * k;
      }
    }
    if (side !== 0) this.lastBoomSide = side;

    // Round-up: heeled hard, rudder stalled, spinning toward the wind
    const towardWind = -Math.sign(twa) * s.r; // negative r turns to port; wind from port => twa<0
    if (Math.abs(s.heel) > 30 * DEG && d.rudderStalled && towardWind < -12 * DEG) this.emit('roundUp', 6);
    if (Math.abs(s.heel) > 50 * DEG) this.emit('knockdown', 6);

    if (Math.abs(twa) < 30 * DEG && d.speed < 0.4 * KN) {
      this.ironsTime += DT;
      if (this.ironsTime > 3 && this.ironsTime - DT <= 3) this.emit('irons');
    } else this.ironsTime = 0;
  }

  /** Events since time t0. */
  since(t0: number, type?: EventType): SimEvent[] {
    return this.events.filter((e) => e.t >= t0 && (!type || e.type === type));
  }
}
