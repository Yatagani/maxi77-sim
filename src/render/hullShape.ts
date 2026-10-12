// Parametric Maxi 77 hull lines. t = 0 at the transom, 1 at the stem; body coords (x fwd, z up).
// Shapes are an approximation fitted to LOA 7.62, LWL ~6.6, beam 2.50 and the sheer of photos.

export const X_TRANSOM = -3.79;
export const X_STEM = 3.81;

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

export const xAt = (t: number) => X_TRANSOM + (X_STEM - X_TRANSOM) * t;
export const tAt = (x: number) => (x - X_TRANSOM) / (X_STEM - X_TRANSOM);

/** Half beam at the sheer (m). */
export function halfBeam(t: number): number {
  if (t < 0.45) return 1.25 * (0.78 + 0.22 * Math.sin((Math.PI / 2) * (t / 0.45)));
  const u = (t - 0.45) / 0.55;
  return 1.25 * Math.pow(Math.max(0, 1 - Math.pow(u, 2.2)), 0.62);
}

/** Sheer height above the waterline (m): springy sheer, high bow. */
export function sheerZ(t: number): number {
  return 0.68 + 0.08 * t + 0.2 * t * t * t;
}

/** Canoe-body bottom on the centreline (m). */
export function keelLineZ(t: number): number {
  if (t < 0.5) return -0.36 + 0.44 * ((0.5 - t) / 0.5) ** 2;
  return -0.36 + (sheerZ(1) + 0.36) * ((t - 0.5) / 0.5) ** 7;
}

/** Section superellipse exponent: round bilge aft, V forward. */
export function sectionN(t: number): number {
  return 2.7 - 1.5 * smooth(0.6, 1, t);
}

/** Point on the starboard hull surface. s = 0 at the sheer, 1 at the centreline bottom. */
export function hullPoint(t: number, s: number): [number, number, number] {
  const th = (s * Math.PI) / 2;
  const n = sectionN(t);
  const b = halfBeam(t);
  const zs = sheerZ(t);
  const zk = keelLineZ(t);
  const y = b * Math.pow(Math.cos(th), 2 / n);
  const z = zs - (zs - zk) * Math.pow(Math.sin(th), 2 / n);
  return [xAt(t), z, y]; // three.js local: X fwd, Y up, Z starboard
}
