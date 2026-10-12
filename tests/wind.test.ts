import { describe, expect, it } from 'vitest';
import presets from '../public/data/oslofjord-presets.json';
import { KN } from '../src/sim/boat';
import { hourlyToKeys, interpolateKeys, lerpDir, WindField, wrapDeg, type HourRow } from '../src/sim/wind';

describe('wind keys (R20)', () => {
  it('interpolates speed linearly', () => {
    const b = interpolateKeys([{ t: 0, speed: 10, dir: 200 }, { t: 100, speed: 20, dir: 200 }], 25);
    expect(b.speed).toBeCloseTo(12.5);
  });
  it('interpolates direction along the shortest arc across north', () => {
    expect(lerpDir(350, 10, 0.5)).toBeCloseTo(0);
    expect(lerpDir(10, 350, 0.25)).toBeCloseTo(5);
    expect(wrapDeg(190)).toBe(-170);
  });
  it('holds the last key beyond the end', () => {
    expect(interpolateKeys([{ t: 0, speed: 5, dir: 0 }, { t: 10, speed: 8, dir: 90 }], 99).dir).toBeCloseTo(90);
  });
});

describe('historical replay (R21, R22)', () => {
  it('caps gusts at 1.6x mean and compresses time', () => {
    const rows: HourRow[] = [[12, 10, 200, 25], [13, 12, 210, 14]];
    const k = hourlyToKeys(rows, 12, 120);
    expect(k[0].gustAmp).toBeCloseTo(6); // min(25, 16) - 10
    expect(k[1].gustAmp).toBeCloseTo(2);
    expect(k[1].t).toBeCloseTo(30); // one hour in 30 s at 120x
  });
  it('bundles five Oslofjord days with 24 hourly rows', () => {
    expect(presets.presets).toHaveLength(5);
    for (const p of presets.presets) expect(p.hours).toHaveLength(24);
  });
});

describe('gust field (R19)', () => {
  it('is deterministic for a seed and averages near the base speed', () => {
    const keys = [{ t: 0, speed: 12, dir: 200, gustAmp: 6, gustRate: 0.8 }];
    const a = new WindField(keys, 3);
    const b = new WindField(keys, 3);
    let sum = 0;
    let max = 0;
    for (let i = 0; i < 600; i++) {
      a.step(0.5, 0, 0);
      b.step(0.5, 0, 0);
      const sa = a.sample(0, 0);
      expect(sa.speed).toBe(b.sample(0, 0).speed);
      sum += sa.speed / KN;
      max = Math.max(max, sa.speed / KN);
    }
    expect(sum / 600).toBeGreaterThan(10);
    expect(sum / 600).toBeLessThan(16);
    expect(max).toBeGreaterThan(14); // gusts actually reach the boat
  });
});
