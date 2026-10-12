import { DEG, KN } from '../src/sim/boat';
import { autoTrim } from '../src/sim/autotrim';
import { defaultControls, initialState, step, type Controls, type Diag } from '../src/sim/physics';

/** Sail at a fixed true wind angle with an autopilot and periodic auto-trim. */
export function sailSteady(
  twsKn: number,
  twaDeg: number,
  opts: { seconds?: number; controls?: Partial<Controls>; startKn?: number; trim?: boolean } = {},
): { speedKn: number; heelDeg: number; diag: Diag; rudderDeg: number } {
  const wind = { speed: twsKn * KN, dir: 0 };
  const s = initialState(-twaDeg * DEG, (opts.startKn ?? 3) * KN);
  const c = { ...defaultControls(), ...opts.controls };
  c.jibSide = twaDeg > 0 ? -1 : 1;
  const target = s.heading;
  const dt = 1 / 120;
  const total = opts.seconds ?? 90;
  let diag!: Diag;
  let speedAcc = 0;
  let heelAcc = 0;
  let rudAcc = 0;
  let n = 0;
  for (let i = 0; i < total * 120; i++) {
    if (opts.trim !== false && i % 60 === 0) Object.assign(c, autoTrim(s, c, wind));
    const err = Math.atan2(Math.sin(target - s.heading), Math.cos(target - s.heading));
    c.rudder = Math.max(-35 * DEG, Math.min(35 * DEG, 2.5 * err - 1.5 * s.r));
    diag = step(s, c, wind, dt);
    if (i > (total - 20) * 120) {
      speedAcc += diag.speed;
      heelAcc += Math.abs(s.heel);
      rudAcc += Math.abs(c.rudder);
      n++;
    }
  }
  return { speedKn: speedAcc / n / KN, heelDeg: heelAcc / n / DEG, diag, rudderDeg: rudAcc / n / DEG };
}
