# Maxi 77 Sail Trainer: spec

Status: approved   Updated: 2026-10-12

## Problem
The user wants to learn how to trim and handle the sails of a **Maxi 77**, the 1972 Pelle Petterson design: a 7.62 m masthead sloop built by Mölnlycke Marin (~3,750 hulls). They want to practise in realistic wind before going out on the water. Today the options are either arcade sailing games with unrealistic sail physics or expensive desktop simulators. None of them model this boat, and none use real Oslofjord wind.

## Goals / non-goals
- Goal: run in a desktop browser with no install and no backend.
- Goal: show a 3D boat that matches the published Maxi 77 dimensions, with sails that visibly respond to trim (luffing, twist, depth, backing).
- Goal: model sail forces physically enough that what works in the sim (telltales, sheeting, depowering, the steps of each maneuver) is what works on the real boat.
- Goal: teach sail trim basics, maneuvers and heavy-weather handling through scripted lessons with objectives and live coaching.
- Goal: replay real historical wind for the Oslofjord. That means five bundled days plus any date fetched from the Open-Meteo archive.
- Non-goal: spinnaker or asymmetric sails, docking and engine handling, multiplayer, mobile and touch controls, racing rules.
- Non-goal: a geographically exact Oslofjord coastline. Islands are procedural scenery.
- Non-goal: real-time weather forecasts.

## Reference data (research, 2026-10-12)
| Item | Value | Source |
|---|---|---|
| LOA / LWL / beam / draft | 7.62 m / 6.75 m / 2.50 m / 1.45–1.50 m | Wikipedia, GoodOldBoat sail data |
| Displacement / ballast | 2000 kg / 800 kg (40%) | GoodOldBoat |
| Rig | Masthead sloop, deck-stepped mast, single spreaders, transom-hung rudder, tiller, fin keel | GoodOldBoat, listingsport (rudder) |
| I / J / P / E | 9.17 / 3.33 / 7.50 / 2.50 m | GoodOldBoat (30.10 / 10.94 / 24.61 / 8.20 ft) |
| Mainsail | 9.66 m² (103.96 ft²) | GoodOldBoat |
| Genoa 150% / jib ~100% | 23.2 m² / 15.0 m² | GoodOldBoat |
| Hull speed | 1.34·√(LWL ft) ≈ 6.3 kn | derived |

Visual details not covered by the sources are approximations of typical Maxi 77s and are marked as such in code comments: white hull, a coloured sheer stripe, a long tinted cabin window band, a foredeck hatch, a pulpit, a pushpit and lifelines.

## Requirements

### Boat model and visuals
- R1: The 3D hull, keel, rudder, coachroof, mast, boom, standing rigging and sails are generated in code from the dimensions in the reference table. The boat's bounding box matches LOA, beam and mast height within 3%.
- R2: The sails are cloth meshes whose shape reflects the trim state. Each frame they show the sheeted angle, camber (flattened by backstay), twist (from sheet and vang), luffing (flutter along the luff when the angle of attack is under 4°), and a backed jib (camber inverted).
- R3: The jib has windward and leeward telltales. Each one shows as streaming, lifting (windward, under-trimmed) or stalled (leeward, over-trimmed), and the HUD mirrors their state.
- R4: There are three cameras: chase/orbit, helm (cockpit view) and top-down. The camera toggles with `C`.
- R5: The sea surface has animated waves whose height scales with wind. It shows whitecaps above 14 kn and darker patches where gust cells are, so the user can learn to spot gusts. There are a sky and distant islands.

### Physics (pure TypeScript, deterministic, no DOM)
- R6: The state is position, heading, surge, sway, yaw rate, heel and roll rate. It is integrated with fixed 1/120 s steps.
- R7: Aerodynamics use the apparent wind. Each sail gets lift and drag from its angle of attack, using a curve with linear lift, a stall near 25–30° and flat-plate behaviour beyond that. Forces scale with ½ρV²A·cos²(heel).
- R8: The mainsail boom swings to leeward up to the limit set by mainsheet and traveler. If the apparent wind angle is smaller than that limit, the sail weathervanes (luffs).
- R9: The jib is sheeted on an explicit side, port or starboard. If the apparent wind comes from the sheeted side, the jib is backed: it produces reverse force and pushes the bow away from the wind.
- R10: The keel and rudder produce lift from leeway and inflow angle, with a stall above about 15° and induced drag. A stalled keel at low speed lets the boat slide sideways.
- R11: Hull resistance is friction plus wave resistance, rising steeply above hull speed.
- R12: Heel follows heeling moment against a righting-arm curve with GM ≈ 0.95 m and a vanishing angle of ~120°. The crew-hiking toggle adds a righting moment.
- R13: Yaw comes from the rudder, sail–keel centre offsets, heel-induced weather helm and the backed-jib moment. Too much heel can cause round-ups when the rudder stalls.
- R14: Steady-state boat speed with optimal trim falls within these polar bands (kn):

  | TWS | TWA 45° | TWA 90° | TWA 150° |
  |---|---|---|---|
  | 6 kn | 3.0–4.6 | 3.8–5.6 | 2.4–4.2 |
  | 10 kn | 4.2–5.6 | 5.2–6.8 | 3.6–5.6 |
  | 15 kn | 4.8–6.0 | 5.8–7.4 | 4.8–6.8 |

- R15: Pinching is penalised. At 10 kn TWS, VMG at TWA 32° is at least 20% below the best upwind VMG, and the best upwind VMG falls between TWA 40° and 50°. At TWA 20° (in irons), a boat starting at 3 kn slows to under 1 kn within 30 s. Calibration showed that real-world pinching at 30° still makes slow headway, which is why this replaced the earlier "cannot sail at 30°".
- R16: In 18 kn steady at TWA 50° with optimal sheeting, heel is lower with 2 reefs + jib than with full main + genoa.
- R17: An auto-trim solver returns the optimal sheet settings for the current state. It powers the "Hint" overlay and the tests.

### Controls
- R18: Keyboard bindings:
  - Tiller: ←/→ (A/D)
  - Mainsheet: W in / S out
  - Jib sheet: E in / Q out
  - Switch jib sheet side: `T`
  - Traveler: `[` / `]`
  - Vang: `V` cycles through slack, medium and hard
  - Backstay: `B` cycles through 0, 50 and 100%
  - Reef: `R` adds a reef (0→1→2), `Shift+R` shakes one out
  - Headsail change between genoa and jib: `G`. The jib carries no sail for 45 s during the change.
  - Crew hiking: `H`
  - Pause: Space
  - Time scale (1×, 4×, 16×): `1`, `2`, `3`
  - Hint: `F1` or `I`
  - Lock tiller: `L`; centre tiller: `X`
  - Camera: `C`; menu: `Esc`

  Every control except the tiller also has an on-screen control. The jib sheet auto-switches on tacks only when the lesson enables it ("Auto jib").

### Wind
- R19: The wind field is a base (direction, speed) plus moving gust cells: Gaussian blobs that drift downwind. A gust adds speed and veers the wind by up to 6°. The field is deterministic for a given seed.
- R20: Scripted wind scenarios are expressed as keyframes of base speed and direction, gust amplitude and gust frequency, with linear interpolation. Direction is interpolated along the shortest arc.
- R21: Historical replay interpolates hourly Open-Meteo values: speed, direction and gusts at 10 m. Gust-cell amplitude is `min(gust, 1.6·mean) − mean`, because ERA5 gusts are overstated over land-mixed grid cells. Replay supports a time compression of 1×, 30× or 120× sim-minutes per real minute, chosen in the setup screen.
- R22: The five bundled presets come from `public/data/oslofjord-presets.json`, inner Oslofjord at 59.87 N 10.68 E:
  - 2024-07-06: sea breeze fills in
  - 2025-06-03: strong, gusty sea breeze
  - 2025-08-05: windy southerly
  - 2024-08-23: frontal passage
  - 2024-09-18: light air
- R23: A custom date (1940-01-01 to 6 days ago) fetches the archive API in the browser. A network failure shows an error and falls back to the presets.

### Lessons and coaching
- R24: There are ten scripted lessons, each with a briefing, a wind script, a start state, objectives and a pass/fail result:
  1. Points of sail & telltales
  2. Upwind (close-hauled)
  3. Tacking
  4. Gybing
  5. Getting out of irons
  6. Heaving to
  7. Gusts & lulls
  8. Wind shifts
  9. Reefing in a building breeze
  10. Squall

  There are also two non-lesson modes: free sail with adjustable wind, and Oslofjord replay.
- R25: The coach detects these conditions and shows a one-line instruction for each:
  - luffing: sheet in or bear away
  - stalled: ease or head up
  - overpowered (heel > 25°): ease the traveler, flatten, reef
  - pinching
  - in irons
  - sailing by the lee
  - unintended backed jib
  - crash gybe (boom more than 30° out when it crosses, with TWS above 8 kn)
  - round-up
  - knockdown (heel > 50°)
- R26: Lesson progress (passed lessons, best score) persists in localStorage. The app still works if storage is unavailable.
- R27: The HUD shows:
  - boat speed, heading, TWS/TWA, AWS/AWA, VMG and heel
  - a wind instrument with true and apparent arrows
  - the trim panel
  - the telltales
  - the coach message
  - the lesson objectives
  - in replay, a timeline of speed, gust and direction with a cursor

## Data model
- `BoatState {x, y, heading, u, v, r, heel, p, t}`. Metres and m/s; angles in radians internally and degrees in the UI.
- `Controls {rudder, mainsheet, traveler, vang, backstay, reef, jibSheet, jibSide, headsail, hike}`
- `WindScript {keys: {t, speed, dir, gustAmp, gustRate}[]}`. Speed is in kn and direction is "from" in degrees.
- `Lesson {id, title, briefing, wind, start, controls, autoJib, objectives: Objective[]}`. `Objective` is `(sim, events) → {done, failed, progress}`.

## Interfaces
- UI: a single page with a menu (lessons, free sail, Oslofjord replay), the 3D view and the HUD. Desktop keyboard only.
- External: `GET https://archive-api.open-meteo.com/v1/archive?...&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=kn` (no key, CORS-enabled, CC BY 4.0 attribution shown in the UI).

## Tech
Vite + TypeScript (strict) + Three.js 0.170. Vitest covers the physics, wind and lesson logic. A Playwright smoke script loads the built app, checks that there are no console errors and takes a screenshot.

## Deployment
- Private GitHub repo `Yatagani/maxi77-sim`.
- CI is GitHub Actions: `npm ci`, typecheck, test and build on every push.
- Run locally with `npm run dev`.
- Static hosting such as GitHub Pages is possible later: Pages on a private repo needs a paid plan, or the repo can be made public.
- No secrets.

## Open questions
None. The user answered: Pelle Petterson Maxi 77; 3D; scripted lessons plus historical data; trim, maneuvers and heavy weather; Oslo; private repo `maxi77-sim`.
