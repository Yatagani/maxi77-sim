# Maxi 77 Sail Trainer

A browser simulator for learning to trim and handle the sails of a **Maxi 77**. The Maxi 77 is Pelle Petterson's 1972 masthead sloop, built by Mölnlycke Marin (~3,750 hulls). You sail it in scripted lessons or in **real historical Oslofjord wind**.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # physics, wind, lessons (52 tests)
npm run build && npm run smoke   # headless browser smoke test + screenshots/
```

## What you learn
| Skill | Lessons |
|---|---|
| Sail trim | 1 Points of sail & telltales · 2 Upwind · 8 Wind shifts |
| Maneuvers | 3 Tacking · 4 Gybing · 5 Getting out of irons · 6 Heaving to |
| Heavy weather | 7 Gusts & lulls · 9 Reefing in a building breeze · 10 Squall |

Each lesson has:
- a briefing
- a scripted wind
- objectives
- pass/fail with a score, saved in your browser

A **coach** tells you what to change in real time. Examples:
- "Windward telltale lifting: sheet the jib in"
- "Crash gybe! Sheet the main to the centre before the stern crosses"

**Free sail** lets you set the wind yourself. **Oslofjord replay** sails real hourly wind (speed, direction, gusts) for the inner Oslofjord at 59.87 N 10.68 E. Five characteristic days are bundled:

| Date | Conditions |
|---|---|
| 2024-07-06 | Sea breeze fills in |
| 2025-06-03 | Strong, gusty sea breeze |
| 2025-08-05 | Windy southerly |
| 2024-08-23 | Front passes |
| 2024-09-18 | Light air |

Any other date from 1940 onward is fetched live from Open-Meteo.

## Controls
| Key | Action |
|---|---|
| ← → (A D) | Steer (the tiller visibly moves the opposite way, as on the real boat) |
| W / S | Mainsheet in / out |
| E / Q | Jib sheet in / out |
| T | Switch the working jib sheet to the other side (tacking; back the jib) |
| [ / ] | Traveler up / down |
| V · B | Vang (slack / medium / hard) · backstay (0 / 50 / 100%) |
| R / Shift+R | Reef in / shake out (takes 15 s) |
| G | Change between the 150% genoa and the 100% jib (45 s on main only) |
| H · L · X | Hike crew to windward · lock tiller · centre tiller |
| I (or F1) | Hint: shows the optimal sheet settings as yellow ghost markers |
| C · Space · 1/2/3 · Esc | Camera (chase / helm / top) · pause · time 1×/4×/16× · menu |

On a weak GPU, open the app with `?quality=low` (coarser sea, no shadows).

## How it works
- **Boat data:** LOA 7.62 m, LWL 6.75, beam 2.50, draft 1.45, displacement 2000 kg with 800 kg ballast. Rig: I 9.17, J 3.33, P 7.50, E 2.50 m. Sails: main 9.66 m², genoa 23.2 m², jib 15.0 m². Sources are in [`docs/SPEC.md`](docs/SPEC.md).
- **Physics** (`src/sim/physics.ts`): the simulation runs at a fixed 120 Hz and covers surge, sway, yaw and roll.
  - **Sail forces:** each sail is split into 3 height bands. Each band sees its own apparent wind, including the wind gradient and heel. Lift and drag follow soft-sail curves: they luff below 8°, peak near 22°, then become a flat plate.
  - **Mainsail:** the main weathervanes up to the limit set by sheet and traveler. Twist comes from sheet and vang, and the backstay flattens the sail. The jib also backwinds the main through the slot.
  - **Jib:** the jib is sheeted to an explicit side, so it can be **backed** (for heaving to and getting out of irons) or set wing-on-wing.
  - **Keel and rudder:** both are lifting foils. They stall, and they lose grip at big heel, so the boat can round up.
  - **Heel:** the righting-arm curve uses GM 0.95 m and a vanishing angle of 120°.
  - **Calibration:** the polar falls in realistic bands (about 4.8 kn upwind and 6.1 kn on a beam reach in 10 kn), and the best upwind VMG is at about 45° TWA. Every lesson is proven completable by a scripted "ideal pilot" in `tests/lessons.test.ts`.
- **Wind** (`src/sim/wind.ts`): a base wind (keyframes or hourly reanalysis) plus gust and lull cells drifting downwind. Gusts veer the wind and show as dark patches on the water. Reanalysis gusts are capped at 1.6× the mean wind.
- **Rendering** (`src/render/`): Three.js. The hull is lofted from parametric lines, and the sails are cloth meshes reshaped every frame from the physics: angle, twist, camber, luff flutter and backing. The sea uses Gerstner waves with whitecaps, gust patches and a wake. Granite-and-pine islands and fjord shores are procedural.

### Known approximations
The hull lines, coachroof and colours are fitted to published dimensions and typical boats, not to the builder's drawings. The Oslofjord coastline is procedural scenery. Reanalysis wind is a ~10 km average, so local effects such as shadows behind islands are not in the data.

## Data & credits
Weather data: [Open-Meteo](https://open-meteo.com/) Historical Weather API (ERA5 / ECMWF IFS), CC BY 4.0. Boat particulars: Wikipedia "Maxi 77" and the GoodOldBoat sail-data database.
