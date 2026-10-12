# Maxi 77 Sail Trainer: plan

Spec: docs/SPEC.md   Updated: 2026-10-13

- [x] T1 Walking skeleton: Vite + TS + Three scene, Vitest, CI workflow, private repo pushed. (R-) Verify: `npm test`, `npm run build`, CI green.
- [x] T2 Wind model: keyframe scripts, gust cells, hourly interpolation, presets loader. (R19–R22) Verify: `tests/wind.test.ts`.
- [x] T3 Physics core: aero, hydro, heel, yaw, integrator, auto-trim. (R6–R13, R17) Verify: `tests/physics.test.ts`.
- [x] T4 Calibration against polar bands, irons, reefing. (R14–R16) Verify: `tests/polar.test.ts`.
- [x] T5 Coach and event detection (luff, stall, gybe, irons…). (R25) Verify: `tests/coach.test.ts`.
- [x] T6 Lessons 1–10, objectives, progress storage. (R24, R26) Verify: `tests/lessons.test.ts`. Each lesson's scripted "ideal pilot" passes its objectives.
- [x] T7 3D boat: hull, deck, rig, sails, telltales from dimensions. (R1–R3) Verify: bbox unit test + screenshot.
- [x] T8 Sea, sky, islands, gust patches, cameras. (R4, R5) Verify: screenshot.
- [x] T9 HUD, controls, menus, replay timeline, custom-date fetch. (R18, R23, R27) Verify: Playwright smoke, no console errors.
- [x] T10 Ship: README, CI green, push. Verify: `gh run list`.
