import {
  BOAT,
  DEG,
  G,
  INERTIA_X,
  INERTIA_Z,
  MASS,
  MASS_X,
  MASS_Y,
  RHO_AIR,
  RHO_WATER,
  SAILS,
  type Headsail,
} from './boat';
import type { WindSample } from './wind';

export interface Controls {
  rudder: number; // rad, + turns the bow to starboard
  mainsheet: number; // 0 = hard in .. 1 = fully eased
  traveler: number; // 0 = centred .. 1 = dropped to leeward
  vang: 0 | 1 | 2; // slack, medium, hard
  backstay: 0 | 1 | 2; // 0, 50, 100 %
  reef: 0 | 1 | 2;
  jibSheet: number; // 0 = hard in .. 1 = fully eased
  jibSide: 1 | -1; // side the working jib sheet leads to (+1 = starboard)
  headsail: Headsail;
  hike: boolean;
}

export interface BoatState {
  x: number; // world east (m)
  y: number; // world north (m)
  heading: number; // rad, compass
  u: number; // surge m/s
  v: number; // sway m/s (+ = to starboard)
  r: number; // yaw rate rad/s (+ = turning to starboard)
  heel: number; // rad (+ = starboard side down)
  p: number; // roll rate rad/s
  boom: number; // actual boom angle rad (+ = boom out to starboard)
}

export type Telltale = 'stream' | 'lift' | 'stall' | 'luff';

export interface SailDiag {
  angle: number; // bottom band chord angle, rad (+ = to starboard)
  bandAngles: number[]; // rad
  alpha: number[]; // deg per band (low, mid, high)
  luff: boolean[];
  backed: boolean;
  winged: boolean;
  twist: number; // deg
  area: number;
  windward: Telltale;
  leeward: Telltale;
}

export interface Diag {
  tws: number; // m/s at 10 m
  twd: number; // rad FROM
  twa: number; // rad, + = wind from starboard
  aws: number;
  awa: number;
  speed: number; // m/s through water
  vmg: number; // m/s toward the wind
  leeway: number; // rad
  heelMoment: number;
  rightingMoment: number;
  rudderStalled: boolean;
  drive: number; // N
  side: number; // N
  main: SailDiag;
  jib: SailDiag | null;
  boomTarget: number;
}

/** Chord angle of attack (deg) below which soft sails luff, and the telltale streaming band. */
export const LUFF = 8;
export const STREAM_LOW = 13;
export const STREAM_HIGH = 25;
const VANG_K = [0, 0.5, 0.85];
const BAND_H = [1 / 6, 1 / 2, 5 / 6];
const BAND_A = [5 / 9, 3 / 9, 1 / 9];

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const smooth = (e0: number, e1: number, x: number) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Soft-sail lift/drag versus angle of attack (deg, 0..90). */
export function sailCoeffs(a: number, clMax: number, cd0: number): { cl: number; cd: number } {
  let cl: number;
  if (a < LUFF) cl = 0;
  else if (a <= 22) cl = clMax * Math.sin((Math.PI / 2) * ((a - LUFF) / (22 - LUFF)));
  else if (a <= 45) cl = clMax - (clMax - 1.1) * ((a - 22) / 23);
  else cl = 1.1 * Math.sin(2 * a * DEG);
  const sep = 1.5 * Math.max(0, (a - 17) * DEG) ** 2;
  const attached = cd0 + 0.07 * cl * cl + sep + (a < LUFF ? 0.04 : 0);
  const plate = 0.05 + 1.25 * Math.sin(a * DEG) ** 2;
  return { cl, cd: Math.max(attached, plate) };
}

/** Symmetric foil (keel/rudder) coefficients versus angle (deg, 0..90). */
export function foilCoeffs(a: number, ar: number): { cl: number; cd: number } {
  const slope = (2 * Math.PI * ar) / (ar + 2);
  const stall = 14;
  const clStall = slope * stall * DEG;
  let cl: number;
  if (a <= stall) cl = slope * a * DEG;
  else cl = Math.max(1.0 * Math.sin(2 * a * DEG), clStall * (1 - (a - stall) / 30));
  const cd = 0.012 + (cl * cl) / (Math.PI * ar * 0.85) + 1.1 * Math.sin(a * DEG) ** 2;
  return { cl, cd };
}

export interface FoilResult {
  fx: number;
  fy: number;
  alpha: number; // deg, folded 0..90
}

/**
 * Force on a thin foil with chord direction (cx, cy) in a flow (velocity of fluid
 * relative to the foil). Lift is perpendicular to the flow, drag along it.
 */
export function foilForce(
  cx: number,
  cy: number,
  flowX: number,
  flowY: number,
  qA: number, // 0.5 rho A (velocity squared applied here)
  coeff: (a: number) => { cl: number; cd: number },
): FoilResult {
  const V = Math.hypot(flowX, flowY);
  if (V < 1e-6) return { fx: 0, fy: 0, alpha: 0 };
  const fx = flowX / V;
  const fy = flowY / V;
  const cosA = clamp(cx * fx + cy * fy, -1, 1);
  let alpha = Math.acos(cosA) / DEG;
  if (alpha > 90) alpha = 180 - alpha;
  let nx = -cy;
  let ny = cx;
  if (nx * fx + ny * fy < 0) {
    nx = -nx;
    ny = -ny;
  }
  const nf = nx * fx + ny * fy;
  let lx = nx - nf * fx;
  let ly = ny - nf * fy;
  const ll = Math.hypot(lx, ly);
  if (ll > 1e-9) {
    lx /= ll;
    ly /= ll;
  } else {
    lx = 0;
    ly = 0;
  }
  const { cl, cd } = coeff(alpha);
  const q = qA * V * V;
  return { fx: q * (cl * lx + cd * fx), fy: q * (cl * ly + cd * fy), alpha };
}

/** Righting arm (m) versus heel. */
export function righting(heel: number): number {
  const a = Math.abs(heel);
  const gz = BOAT.gm * Math.sin(a) * (1 - (a / BOAT.vanishingAngle) ** 2);
  return Math.sign(heel) * gz * MASS * G;
}

export function initialState(heading = 0, speed = 0): BoatState {
  return { x: 0, y: 0, heading, u: speed, v: 0, r: 0, heel: 0, p: 0, boom: 0 };
}

export function defaultControls(): Controls {
  return {
    rudder: 0,
    mainsheet: 0.3,
    traveler: 0,
    vang: 1,
    backstay: 0,
    reef: 0,
    jibSheet: 0.3,
    jibSide: -1,
    headsail: 'genoa',
    hike: false,
  };
}

interface Point {
  x: number;
  y: number;
  z: number;
}

/** True wind velocity (air movement) in the body frame at 10 m. */
function trueWindBody(s: BoatState, w: WindSample) {
  const Wx = -w.speed * Math.sin(w.dir);
  const Wy = -w.speed * Math.cos(w.dir);
  const sh = Math.sin(s.heading);
  const ch = Math.cos(s.heading);
  return { f: Wx * sh + Wy * ch, s: Wx * ch - Wy * sh };
}

/** Apparent air flow (air velocity relative to the boat) at a body point, projected for heel. */
function apparentAt(s: BoatState, wf: number, ws: number, pt: Point) {
  const gz = Math.pow(Math.max(pt.z, 1) / 10, 0.1);
  const ax = wf * gz - (s.u - s.r * pt.y);
  const ay = (ws * gz - (s.v + s.r * pt.x + s.p * pt.z)) * Math.cos(s.heel);
  return { ax, ay };
}

/** Rotate a flow vector by angle a (rad, + = clockwise seen from above, i.e. toward starboard). */
function rotateFlow(f: { ax: number; ay: number }, a: number) {
  const c = Math.cos(a);
  const sn = Math.sin(a);
  return { ax: f.ax * c - f.ay * sn, ay: f.ax * sn + f.ay * c };
}

/** Flag angle: chord angle a free sail takes when it streams downwind. */
const flagAngle = (ax: number, ay: number) => wrapPi(-Math.atan2(-ay, -ax));

interface AeroOut {
  fx: number;
  fy: number;
  mz: number;
  kx: number;
  main: SailDiag;
  jib: SailDiag | null;
  boomTarget: number;
  awa: number;
  aws: number;
}

export function mainLimit(c: Controls): number {
  return clamp(c.mainsheet * 85 + c.traveler * 12, 0, 85) * DEG;
}

export function computeAero(s: BoatState, c: Controls, w: WindSample, steadyBoom = false): AeroOut {
  const { f: wf, s: ws } = trueWindBody(s, w);
  const flat = c.backstay / 2;
  const cosH = Math.cos(s.heel);
  const sinH = Math.sin(s.heel);
  let fx = 0;
  let fy = 0;
  let mz = 0;
  let kx = 0;

  const addForce = (F: FoilResult, ce: Point) => {
    // Sail-plane side force: horizontal part scaled by cos(heel); roll lever is the height.
    const fyh = F.fy * cosH;
    const yce = ce.y * cosH + ce.z * sinH;
    fx += F.fx;
    fy += fyh;
    mz += ce.x * fyh - yce * F.fx;
    kx += F.fy * ce.z;
  };

  // Reference apparent wind (mid-height of the rig, at the mast)
  const ref = apparentAt(s, wf, ws, { x: BOAT.mastX, y: 0, z: 5 });
  const awa = Math.atan2(-ref.ay, -ref.ax);
  const aws = Math.hypot(ref.ax, ref.ay);

  // ---- Mainsail ----
  const lim = mainLimit(c);
  const mainArea = SAILS.main.area * SAILS.reefArea[c.reef];
  const luffLen = BOAT.P * SAILS.reefLuff[c.reef];
  const twist = Math.min(30, 4 + 40 * c.mainsheet * (1 - VANG_K[c.vang]) + 3 * flat);
  const slot =
    c.headsail === 'none' || Math.abs(awa) > 100 * DEG
      ? 0
      : (c.headsail === 'genoa' ? 9 : 6) * DEG * (1 - smooth(60, 100, Math.abs(awa) / DEG));
  const lowChord = BOAT.E * (1 - BAND_H[0]);
  const low = rotateFlow(
    apparentAt(s, wf, ws, { x: BOAT.mastX - 0.4 * lowChord, y: 0, z: BOAT.boomZ + luffLen * BAND_H[0] }),
    slot * -Math.sign(awa),
  );
  const boomTarget = clamp(flagAngle(low.ax, low.ay), -lim, lim);
  const boom = steadyBoom ? boomTarget : s.boom;
  const sb = Math.abs(boom) > 1e-3 ? Math.sign(boom) : -Math.sign(awa) || 1;
  const mainDiag: SailDiag = {
    angle: boom,
    bandAngles: [],
    alpha: [],
    luff: [],
    backed: false,
    winged: false,
    twist,
    area: mainArea,
    windward: 'stream',
    leeward: 'stream',
  };
  const mainClMax = 1.55 * (1 - 0.22 * flat);
  const mainCd0 = 0.06 * (1 - 0.3 * flat);
  for (let k = 0; k < 3; k++) {
    const h = BAND_H[k];
    const z = BOAT.boomZ + luffLen * h;
    const chord = BOAT.E * (1 - h);
    const pt0 = { x: BOAT.mastX - 0.4 * chord, y: 0, z };
    const app0 = apparentAt(s, wf, ws, pt0);
    // Slot effect: the headsail's leeward flow heads the main (rotates its inflow toward the bow).
    const app = rotateFlow(app0, slot * -Math.sign(awa));
    const wk = flagAngle(app.ax, app.ay);
    const lo = Math.min(boom, boom + sb * twist * DEG * h * 1.2);
    const hi = Math.max(boom, boom + sb * twist * DEG * h * 1.2);
    const bk = k === 0 ? boom : clamp(wk, lo, hi);
    const cx = -Math.cos(bk);
    const cy = Math.sin(bk);
    const wrongSide = k > 0 && (wk - bk) * sb < -1e-4;
    const F = foilForce(cx, cy, app.ax, app.ay, 0.5 * RHO_AIR * mainArea * BAND_A[k], (a) =>
      sailCoeffs(wrongSide ? 0 : a, mainClMax, mainCd0),
    );
    const alpha = wrongSide ? 0 : F.alpha;
    mainDiag.bandAngles.push(bk);
    mainDiag.alpha.push(alpha);
    mainDiag.luff.push(alpha < LUFF);
    addForce(F, { x: BOAT.mastX + 0.4 * chord * cx, y: 0.4 * chord * cy, z });
  }
  const ma = mainDiag.alpha[2];
  mainDiag.leeward = ma < LUFF ? 'luff' : ma > STREAM_HIGH ? 'stall' : 'stream';
  mainDiag.windward = ma < LUFF ? 'luff' : ma < STREAM_LOW - 4 ? 'lift' : 'stream';

  // ---- Headsail ----
  let jibDiag: SailDiag | null = null;
  if (c.headsail !== 'none') {
    const hs = SAILS[c.headsail];
    const side = c.jibSide;
    const delta = c.jibSheet * 75 * DEG;
    const loS = hs.fairlead - delta;
    const hiS = Math.min(hs.fairlead + delta, 80 * DEG);
    const twistJ = 2 + 14 * c.jibSheet + 2 * (1 - flat);
    const backed = Math.sign(awa) === side && Math.abs(awa) < 120 * DEG;
    const winged = Math.sign(awa) === side && Math.abs(awa) >= 120 * DEG;
    const leewardOfMain = side === sb;
    const shadow = leewardOfMain ? 1 - 0.85 * smooth(140, 170, Math.abs(awa) / DEG) : 1;
    jibDiag = {
      angle: 0,
      bandAngles: [],
      alpha: [],
      luff: [],
      backed,
      winged,
      twist: twistJ,
      area: hs.area,
      windward: 'stream',
      leeward: 'stream',
    };
    const clMax = 1.5 * (1 - 0.12 * flat);
    const tackX = BOAT.stemX - 0.08;
    for (let k = 0; k < 3; k++) {
      const h = BAND_H[k];
      const z = BOAT.tackZ + (BOAT.mastheadZ - BOAT.tackZ) * h;
      const xl = tackX - BOAT.J * h;
      const chord = hs.foot * (1 - h);
      const app = apparentAt(s, wf, ws, { x: xl - 0.4 * chord, y: 0, z });
      const wk = flagAngle(app.ax, app.ay);
      const a = side > 0 ? loS : -(hiS + twistJ * DEG * h);
      const b = side > 0 ? hiS + twistJ * DEG * h : -loS;
      const bk = clamp(wk, Math.min(a, b), Math.max(a, b));
      const cx = -Math.cos(bk);
      const cy = Math.sin(bk);
      const F = foilForce(cx, cy, app.ax, app.ay, 0.5 * RHO_AIR * hs.area * BAND_A[k] * shadow, (al) =>
        sailCoeffs(al, clMax, 0.06 * (1 - 0.3 * flat)),
      );
      jibDiag.bandAngles.push(bk);
      jibDiag.alpha.push(F.alpha);
      jibDiag.luff.push(F.alpha < LUFF);
      if (k === 0) jibDiag.angle = bk;
      addForce(F, { x: xl + 0.4 * chord * cx, y: 0.4 * chord * cy, z });
    }
    const ja = jibDiag.alpha[1];
    if (backed) {
      jibDiag.windward = 'stall';
      jibDiag.leeward = 'stall';
    } else if (Math.abs(awa) > 110 * DEG) {
      // Telltales don't read on a broad reach / run: flow is detached by design.
      jibDiag.windward = 'stream';
      jibDiag.leeward = ja < LUFF ? 'luff' : 'stall';
    } else {
      jibDiag.windward = ja < LUFF ? 'luff' : ja < STREAM_LOW ? 'lift' : 'stream';
      jibDiag.leeward = ja < LUFF ? 'luff' : ja > STREAM_HIGH ? 'stall' : 'stream';
    }
  }
  return { fx, fy, mz, kx, main: mainDiag, jib: jibDiag, boomTarget, awa, aws };
}

export interface HydroOut {
  fx: number;
  fy: number;
  mz: number;
  kx: number;
  rudderStalled: boolean;
}

export function computeHydro(s: BoatState, c: Controls): HydroOut {
  const cosH = Math.cos(s.heel);
  const V = Math.hypot(s.u, s.v);
  let fx = 0;
  let fy = 0;
  let mz = 0;
  let kx = 0;

  // Keel (with hull lift), chord pointing aft
  const k = BOAT.keel;
  const kvy = s.v + s.r * k.x + s.p * k.z;
  const keel = foilForce(-1, 0, -s.u, -kvy, 0.5 * RHO_WATER * k.area * cosH * cosH, (a) => foilCoeffs(a, k.ar));
  fx += keel.fx;
  fy += keel.fy;
  mz += k.x * keel.fy;
  kx += keel.fy * k.z;

  // Rudder (transom hung): partially ventilates at large heel
  const rd = BOAT.rudder;
  // Keel downwash and hull wake straighten the flow reaching the rudder
  const rvy = 0.5 * (s.v + s.r * rd.x) + s.p * rd.z;
  const vent = 1 - smooth(28 * DEG, 50 * DEG, Math.abs(s.heel)) * 0.7;
  const rud = foilForce(
    -Math.cos(c.rudder),
    Math.sin(c.rudder),
    -s.u,
    -rvy,
    0.5 * RHO_WATER * rd.area * cosH * vent,
    (a) => foilCoeffs(a, rd.ar),
  );
  fx += rud.fx;
  fy += rud.fy;
  mz += rd.x * rud.fy;
  kx += rud.fy * rd.z;

  // Hull: friction + wave resistance, heel penalty
  const heelPen = 1 + Math.sin(s.heel) ** 2;
  if (V > 1e-6) {
    const rf = 0.5 * RHO_WATER * BOAT.wettedSurface * 0.0045 * V * V * heelPen;
    fx -= (rf * s.u) / V;
    fy -= (rf * s.v) / V;
  }
  const fn = Math.abs(s.u) / Math.sqrt(G * BOAT.lwl);
  // Wave resistance climbs steeply past hull speed (Fn ~0.4)
  const rw = MASS * G * (0.0125 * Math.pow(fn / 0.4, 6) + 4 * Math.max(0, fn - 0.38) ** 2) * heelPen;
  fx -= Math.sign(s.u) * rw;
  // Hull cross-flow
  fy -= 0.5 * RHO_WATER * 1.7 * 0.8 * s.v * Math.abs(s.v);
  // Yaw and roll damping
  mz -= (800 + 1500 * V) * s.r;
  kx -= (3500 + 500 * V) * s.p;

  return { fx, fy, mz, kx, rudderStalled: rud.alpha > 14 };
}

export interface StepOut {
  diag: Diag;
}

/** Advance the boat by dt (use ≤ 1/60 s; callers substep). Mutates s. */
export function step(s: BoatState, c: Controls, w: WindSample, dt: number): Diag {
  const aero = computeAero(s, c, w);
  const hyd = computeHydro(s, c);

  // Boom swings toward its target (rate-limited)
  const maxRate = 3.2 * dt;
  s.boom += clamp(aero.boomTarget - s.boom, -maxRate, maxRate);

  const rm = righting(s.heel);
  const crew = c.hike ? Math.sign(aero.awa || 1) * BOAT.crewArm * 3 * 75 * G * Math.cos(s.heel) : 0;

  const X = aero.fx + hyd.fx;
  const Y = aero.fy + hyd.fy;
  const N = aero.mz + hyd.mz;
  const K = aero.kx + hyd.kx - rm + crew;

  const du = (X + MASS_Y * s.v * s.r) / MASS_X;
  const dv = (Y - MASS_X * s.u * s.r) / MASS_Y;
  s.u += du * dt;
  s.v += dv * dt;
  s.r += (N / INERTIA_Z) * dt;
  s.p += (K / INERTIA_X) * dt;
  s.heading = (s.heading + s.r * dt + 2 * Math.PI) % (2 * Math.PI);
  s.heel += s.p * dt;
  if (Math.abs(s.heel) > 85 * DEG) {
    s.heel = Math.sign(s.heel) * 85 * DEG;
    s.p = 0;
  }
  const sh = Math.sin(s.heading);
  const ch = Math.cos(s.heading);
  s.x += (s.u * sh + s.v * ch) * dt;
  s.y += (s.u * ch - s.v * sh) * dt;

  const { f: wf, s: ws } = trueWindBody(s, w);
  const twa = Math.atan2(-ws, -wf);
  const speed = Math.hypot(s.u, s.v);
  return {
    tws: w.speed,
    twd: w.dir,
    twa,
    aws: aero.aws,
    awa: aero.awa,
    speed,
    vmg: s.u * Math.cos(twa),
    leeway: speed > 0.2 ? Math.atan2(s.v, s.u) : 0,
    heelMoment: aero.kx,
    rightingMoment: rm,
    rudderStalled: hyd.rudderStalled,
    drive: aero.fx,
    side: aero.fy,
    main: aero.main,
    jib: aero.jib,
    boomTarget: aero.boomTarget,
  };
}

/** True wind angle for a heading (rad, + = from starboard). */
export function trueWindAngle(heading: number, windDir: number): number {
  return wrapPi(windDir - heading);
}
