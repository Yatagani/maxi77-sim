import { describe, expect, it } from 'vitest';
import { autoTrim } from '../src/sim/autotrim';
import { DEG, KN } from '../src/sim/boat';
import {
  computeAero,
  defaultControls,
  foilForce,
  initialState,
  righting,
  sailCoeffs,
  step,
  STREAM_HIGH,
  STREAM_LOW,
} from '../src/sim/physics';

const wind = (kn: number, dir = 0) => ({ speed: kn * KN, dir: dir * DEG });

describe('coefficients (R7)', () => {
  it('soft sail luffs at small angle, peaks then becomes a flat plate', () => {
    expect(sailCoeffs(3, 1.5, 0.06).cl).toBe(0);
    expect(sailCoeffs(22, 1.5, 0.06).cl).toBeCloseTo(1.5);
    expect(sailCoeffs(90, 1.5, 0.06).cl).toBeCloseTo(0, 5);
    expect(sailCoeffs(90, 1.5, 0.06).cd).toBeGreaterThan(1.2);
  });
  it('foil lift is perpendicular to the flow', () => {
    const f = foilForce(-1, 0, -1, 0.2, 1, () => ({ cl: 1, cd: 0 }));
    expect(f.fx * -1 + f.fy * 0.2).toBeCloseTo(0, 6);
  });
});

describe('righting (R12)', () => {
  it('is restoring and vanishes at 120 degrees', () => {
    expect(righting(20 * DEG)).toBeGreaterThan(0);
    expect(righting(-20 * DEG)).toBeLessThan(0);
    expect(Math.abs(righting(120 * DEG))).toBeLessThan(1e-6);
  });
});

describe('sail behaviour (R8, R9)', () => {
  it('main weathervanes (luffs) when eased past the wind', () => {
    const s = initialState(-60 * DEG, 2 * KN); // TWA +60 (wind from starboard)
    const c = { ...defaultControls(), mainsheet: 1 };
    const a = computeAero(s, c, wind(10), true);
    expect(a.main.luff.every(Boolean)).toBe(true);
    expect(a.boomTarget).toBeLessThan(0); // boom to port = leeward
  });
  it('jib sheeted to windward is backed and pushes the bow away from the wind', () => {
    const s = initialState(-50 * DEG, 0.5 * KN); // wind from starboard
    const c = { ...defaultControls(), jibSide: 1 as const, jibSheet: 0, mainsheet: 1 };
    const a = computeAero(s, c, wind(12), true);
    expect(a.jib!.backed).toBe(true);
    expect(a.mz).toBeLessThan(0); // bow pushed to port, away from starboard wind
  });
  it('telltales stream with auto-trim close-hauled', () => {
    const s = initialState(-45 * DEG, 4.5 * KN);
    s.v = -0.15;
    const c = defaultControls();
    Object.assign(c, autoTrim(s, c, wind(10)));
    const a = computeAero(s, c, wind(10), true);
    expect(a.jib!.alpha[1]).toBeGreaterThanOrEqual(STREAM_LOW - 1);
    expect(a.jib!.alpha[1]).toBeLessThanOrEqual(STREAM_HIGH + 1);
  });
});

describe('dynamics (R6, R10, R13)', () => {
  it('accelerates from rest on a beam reach', () => {
    const s = initialState(-90 * DEG, 0);
    const c = { ...defaultControls(), jibSide: -1 as const, mainsheet: 0.45, jibSheet: 0.4 };
    for (let i = 0; i < 120 * 20; i++) step(s, c, wind(10), 1 / 120);
    expect(s.u / KN).toBeGreaterThan(4);
  });
  it('rudder turns the boat the commanded way', () => {
    const s = initialState(-90 * DEG, 4 * KN);
    const c = { ...defaultControls(), rudder: 15 * DEG, mainsheet: 0.45, jibSheet: 0.4 };
    const h0 = s.heading;
    for (let i = 0; i < 120 * 4; i++) step(s, c, wind(8), 1 / 120);
    expect(Math.sin(s.heading - h0)).toBeGreaterThan(0.3); // turned to starboard
  });
  it('slides sideways with a stalled keel when stopped', () => {
    const s = initialState(-60 * DEG, 0);
    const c = { ...defaultControls(), mainsheet: 1, jibSheet: 1 };
    for (let i = 0; i < 120 * 20; i++) step(s, c, wind(12), 1 / 120);
    expect(Math.abs(s.v)).toBeGreaterThan(0.05);
  });
});
