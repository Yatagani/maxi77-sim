import { describe, expect, it } from 'vitest';
import { sailSteady } from './helpers';

// R14: steady-state speed bands (kn) with optimal trim
const BANDS: [number, number, number, number][] = [
  [6, 45, 3.0, 4.6], [6, 90, 3.8, 5.6], [6, 150, 2.4, 4.2],
  [10, 45, 4.2, 5.6], [10, 90, 5.2, 6.8], [10, 150, 3.6, 5.6],
  [15, 45, 4.8, 6.0], [15, 90, 5.8, 7.4], [15, 150, 4.8, 6.8],
];

describe('polar (R14)', () => {
  for (const [tws, twa, lo, hi] of BANDS) {
    it(`TWS ${tws} TWA ${twa} within ${lo}-${hi} kn`, () => {
      const r = sailSteady(tws, twa, { seconds: 70 });
      expect(r.speedKn).toBeGreaterThanOrEqual(lo);
      expect(r.speedKn).toBeLessThanOrEqual(hi);
    });
  }
  it('works on both tacks symmetrically', () => {
    const a = sailSteady(10, 60, { seconds: 50 }).speedKn;
    const b = sailSteady(10, -60, { seconds: 50 }).speedKn;
    expect(Math.abs(a - b)).toBeLessThan(0.05);
  });
});

describe('pinching and irons (R15)', () => {
  it('best upwind VMG is between TWA 40 and 50 and pinching at 32 costs >= 20%', () => {
    const vmg = (twa: number) => sailSteady(10, twa, { seconds: 70 }).speedKn * Math.cos((twa * Math.PI) / 180);
    const angles = [32, 36, 40, 45, 50, 55, 60];
    const v = angles.map(vmg);
    const best = Math.max(...v);
    const bestAngle = angles[v.indexOf(best)];
    expect(bestAngle).toBeGreaterThanOrEqual(40);
    expect(bestAngle).toBeLessThanOrEqual(50);
    expect(v[0]).toBeLessThan(0.8 * best);
  });
  it('stops in irons at TWA 20', () => {
    const r = sailSteady(10, 20, { seconds: 30, startKn: 3 });
    expect(r.diag.speed / 0.514444).toBeLessThan(1);
  });
});

describe('depowering (R16)', () => {
  it('two reefs + jib heel less than full main + genoa in 18 kn', () => {
    const fixed = { mainsheet: 0.05, jibSheet: 0.05 };
    const full = sailSteady(18, 50, { seconds: 50, trim: false, controls: { ...fixed } });
    const reefed = sailSteady(18, 50, { seconds: 50, trim: false, controls: { ...fixed, reef: 2, headsail: 'jib' } });
    expect(reefed.heelDeg).toBeLessThan(full.heelDeg - 5);
  });
  it('flattening (backstay) and traveler down reduce heel', () => {
    const base = sailSteady(16, 50, { seconds: 50, trim: false, controls: { mainsheet: 0.05, jibSheet: 0.05 } });
    const dep = sailSteady(16, 50, {
      seconds: 50,
      trim: false,
      controls: { mainsheet: 0.05, jibSheet: 0.05, backstay: 2, traveler: 1 },
    });
    expect(dep.heelDeg).toBeLessThan(base.heelDeg);
  });
});
