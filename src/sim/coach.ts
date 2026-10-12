import { DEG, KN } from './boat';
import { mainLimit, STREAM_HIGH } from './physics';
import type { Simulation } from './sim';

export type CoachLevel = 'good' | 'info' | 'warn' | 'bad';

export interface CoachMsg {
  id: string;
  level: CoachLevel;
  text: string;
}

export interface CoachOptions {
  /** Backed jib is intended (heaving-to lesson). */
  allowBackedJib?: boolean;
}

/** Pick the single most important instruction for the current moment (R25). */
export function coach(sim: Simulation, opts: CoachOptions = {}): CoachMsg | null {
  const d = sim.diag;
  const s = sim.state;
  const c = sim.effectiveControls();
  const recent = (type: Parameters<Simulation['since']>[1], secs: number) => sim.since(sim.t - secs, type).length > 0;
  const twa = Math.abs(d.twa) / DEG;
  const awa = Math.abs(d.awa) / DEG;
  const heel = Math.abs(s.heel) / DEG;
  const speedKn = d.speed / KN;

  if (recent('knockdown', 6))
    return { id: 'knockdown', level: 'bad', text: 'Knockdown! Let the mainsheet run, bear away once she comes up, then reef.' };
  if (recent('roundUp', 5))
    return { id: 'roundUp', level: 'bad', text: 'Rounded up: too much heel stalls the rudder. Ease the main fast, flatten, reef.' };
  if (recent('crashGybe', 5))
    return {
      id: 'crashGybe',
      level: 'bad',
      text: 'Crash gybe! Before the stern crosses the wind, sheet the main to the centre, then ease on the new side.',
    };
  if (sim.reefing) return { id: 'reefing', level: 'info', text: 'Reefing… main is down on the reef point, keep her head-to-wind-ish and steady.' };
  if (sim.headsailChange)
    return { id: 'headsail', level: 'info', text: `Changing headsail to the ${sim.headsailChange.target}… sailing on main only.` };
  if (twa < 30 && speedKn < 0.6)
    return {
      id: 'irons',
      level: 'warn',
      text: 'In irons: back the jib (T to sheet it on the windward side), ease the main, rudder to steer the bow off.',
    };
  if (heel > 25 && awa < 110)
    return {
      id: 'overpowered',
      level: 'warn',
      text: 'Overpowered: drop the traveler ( ] ), add backstay (B), ease the main in gusts — reef (R) if it keeps happening.',
    };
  if (twa > 165 && Math.sign(d.awa) === Math.sign(s.boom) && Math.abs(s.boom) > 20 * DEG)
    return { id: 'byLee', level: 'warn', text: 'Sailing by the lee — the boom wants to gybe. Head up a few degrees or gybe deliberately.' };
  if (d.jib?.backed && !opts.allowBackedJib && speedKn > 0.8)
    return { id: 'backed', level: 'warn', text: 'Jib is backed: release the old sheet and trim the new one (T).' };
  if (twa < 37 && d.jib && d.jib.luff[1])
    return { id: 'pinch', level: 'warn', text: 'Pinching: the jib luffs because you point too high — bear away a few degrees.' };
  if (d.jib && !d.jib.backed && awa < 110) {
    if (d.jib.windward === 'luff') return { id: 'jibLuff', level: 'info', text: 'Jib luffing: sheet in (E) or bear away.' };
    if (d.jib.windward === 'lift')
      return { id: 'jibLift', level: 'info', text: 'Windward telltale lifting: sheet the jib in (E) or bear away slightly.' };
    if (d.jib.leeward === 'stall')
      return { id: 'jibStall', level: 'info', text: 'Leeward telltale stalled: ease the jib (Q) or head up slightly.' };
  }
  if (awa < 110) {
    if (d.main.luff[0] && d.main.luff[1]) return { id: 'mainLuff', level: 'info', text: 'Main luffing: sheet in (W).' };
    if (d.main.alpha[1] > STREAM_HIGH + 3)
      return { id: 'mainStall', level: 'info', text: 'Main over-sheeted (leech telltale hiding): ease the main (S).' };
  } else if (mainLimit(c) < awa * DEG - 100 * DEG && awa > 130) {
    return { id: 'runEase', level: 'info', text: 'Running: ease the main (S) until the boom is almost at the shrouds.' };
  }
  if (d.jib && !d.jib.backed && awa < 110 && d.jib.windward === 'stream' && d.jib.leeward === 'stream')
    return { id: 'good', level: 'good', text: 'Telltales streaming — good trim. Steer to keep them that way.' };
  return null;
}
