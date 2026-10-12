import { BOAT, DEG, G } from './boat';
import { computeAero, righting, type BoatState, type Controls } from './physics';
import type { WindSample } from './wind';

export interface TrimHint {
  mainsheet: number;
  traveler: number;
  jibSheet: number;
  jibSide: 1 | -1;
}

const MAX_HEEL = 22 * DEG;

/**
 * Find sheet settings that maximise drive while keeping heel near MAX_HEEL.
 * Coordinate search over mainsheet+traveler and jib sheet with steady (settled) boom.
 */
export function autoTrim(s: BoatState, c: Controls, w: WindSample): TrimHint {
  const crew = c.hike ? BOAT.crewArm * 3 * 75 * G : 0;
  const kLim = Math.abs(righting(MAX_HEEL)) + crew;
  // The working sheet belongs on the leeward side, or to windward when running wing-on-wing
  // is not intended; the hint always recommends leeward.
  const probe = computeAero(s, c, w, true);
  const jibSide: 1 | -1 = probe.awa > 0 ? -1 : 1;
  const trial: Controls = { ...c, jibSide };
  const score = (t: Controls) => {
    const a = computeAero(s, t, w, true);
    return a.fx - 0.3 * Math.max(0, Math.abs(a.kx) - kLim);
  };
  const grid = (n: number) => Array.from({ length: n + 1 }, (_, i) => i / n);
  for (let iter = 0; iter < 3; iter++) {
    let best = -Infinity;
    let bj = trial.jibSheet;
    if (trial.headsail !== 'none') {
      for (const j of grid(40)) {
        trial.jibSheet = j;
        const v = score(trial);
        if (v > best) {
          best = v;
          bj = j;
        }
      }
      trial.jibSheet = bj;
    }
    best = -Infinity;
    let bm = trial.mainsheet;
    let bt = trial.traveler;
    for (const t of [0, 0.5, 1]) {
      for (const m of grid(40)) {
        trial.mainsheet = m;
        trial.traveler = t;
        const v = score(trial);
        if (v > best + 1e-9) {
          best = v;
          bm = m;
          bt = t;
        }
      }
    }
    trial.mainsheet = bm;
    trial.traveler = bt;
  }
  return { mainsheet: trial.mainsheet, traveler: trial.traveler, jibSheet: trial.jibSheet, jibSide };
}
