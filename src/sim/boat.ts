// Maxi 77 (Pelle Petterson, 1972) particulars. See docs/SPEC.md "Reference data".
// Body frame: x forward from midships, y to starboard, z up from the waterline (metres).

export const KN = 0.514444; // m/s per knot
export const DEG = Math.PI / 180;
export const RHO_AIR = 1.225;
export const RHO_WATER = 1025;
export const G = 9.81;

export const BOAT = {
  loa: 7.62,
  lwl: 6.75,
  beam: 2.5,
  draft: 1.45,
  displacement: 2000,
  ballast: 800,
  crewMass: 160, // two crew, included in dynamics
  // Rig (GoodOldBoat): I 30.10 ft, J 10.94 ft, P 24.61 ft, E 8.20 ft
  I: 9.17,
  J: 3.33,
  P: 7.5,
  E: 2.5,
  freeboardBow: 0.88,
  freeboardMid: 0.72,
  freeboardStern: 0.64,
  // Derived geometry
  stemX: 3.81,
  transomX: -3.66,
  get mastX() {
    return this.stemX - 0.08 - this.J; // tack fitting sits just aft of the stem
  },
  mastStepZ: 1.05, // deck-stepped on the coachroof
  get mastheadZ() {
    return 0.78 + this.I; // I measured from sheer at the mast
  },
  get boomZ() {
    return this.mastheadZ - 0.22 - this.P;
  },
  tackZ: 0.92,
  gm: 0.95, // metacentric height (estimate, 40% ballast ratio, fin keel)
  vanishingAngle: 120 * DEG,
  // Hydrodynamics
  wettedSurface: 14,
  keel: { x: 0.25, z: -0.8, area: 1.45, ar: 2.5 },
  rudder: { x: -3.78, z: -0.45, area: 0.32, ar: 2.0, maxAngle: 35 * DEG },
  crewArm: 1.05,
} as const;

export type Headsail = 'genoa' | 'jib' | 'none';

export const SAILS = {
  main: { area: 9.66 },
  genoa: { area: 23.2, foot: 5.0, fairlead: 12 * DEG }, // 150% LP
  jib: { area: 15.0, foot: 3.35, fairlead: 13 * DEG }, // ~100% LP
  reefArea: [1, 0.8, 0.62],
  reefLuff: [1, 0.82, 0.66],
} as const;

export const MASS = BOAT.displacement + BOAT.crewMass;
export const MASS_X = MASS * 1.06;
export const MASS_Y = MASS * 1.6;
export const INERTIA_Z = MASS * (0.27 * BOAT.loa) ** 2 * 1.5;
export const INERTIA_X = MASS * 1.1 ** 2 * 1.3;
