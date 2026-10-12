import { describe, expect, it } from 'vitest';
import { BOAT } from '../src/sim/boat';
import { halfBeam, keelLineZ, X_STEM, X_TRANSOM } from '../src/render/hullShape';

const within = (v: number, ref: number, pct: number) => Math.abs(v - ref) / ref <= pct / 100;

describe('hull and rig dimensions match the Maxi 77 (R1)', () => {
  it('LOA within 3%', () => expect(within(X_STEM - X_TRANSOM, BOAT.loa, 3)).toBe(true));
  it('beam within 3%', () => {
    let max = 0;
    for (let t = 0; t <= 1; t += 0.001) max = Math.max(max, 2 * halfBeam(t));
    expect(within(max, BOAT.beam, 3)).toBe(true);
  });
  it('waterline length within 3% of LWL', () => {
    const xs: number[] = [];
    for (let t = 0; t <= 1; t += 0.0005) if (keelLineZ(t) < 0) xs.push(X_TRANSOM + (X_STEM - X_TRANSOM) * t);
    expect(within(Math.max(...xs) - Math.min(...xs), BOAT.lwl, 3)).toBe(true);
  });
  it('masthead height derives from I above the sheer', () => {
    expect(BOAT.mastheadZ).toBeCloseTo(0.78 + BOAT.I, 5);
    expect(BOAT.mastheadZ - BOAT.boomZ).toBeGreaterThan(BOAT.P);
  });
});
