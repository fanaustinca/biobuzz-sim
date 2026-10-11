# BIOBUZZ FTC Simulator

A 3D browser simulator for the 2026-27 FIRST Tech Challenge game **BIOBUZZ**, built as a single self-contained `index.html` (Three.js + Rapier physics loaded from a CDN).

**Play:** https://fanaustinca.github.io/biobuzz-sim/

## Features
- **Field built from the BIOBUZZ Competition Manual (§9) and Event Field Setup Guide:** 144" field, HIVE frame (49.46" × 38.95", pivot at 43.95", BIOBUZZ panels on the crossbar), two 42.91" HIVES tilted 30°, 4 FLOWERS (4" opening at 21.5" with a small backstop, retrieval opening, lower ring), LOADING ZONES, GARDENS, alliance areas.
- **Physics:** 40 POLLEN (2.8") and 16 NECTAR (3.6") as Rapier rigid bodies with restitution, friction, rolling resistance and CCD. The HIVES are real pivoting bodies tipped by ball contacts. They are calibrated to Field Setup Guide §12: 8 POLLEN or 3 NECTAR + 3 POLLEN tip a HIVE; 7 POLLEN, 3N + 2P, or 6 POLLEN plus a tossed 7th do not.
- **Your robot is team 6767**, with a "Made by Spark Servos" plate on the other side.
- **Robot configuration:** Mecanum or 4-wheel drive (each with its own traction model); single or double intake with spinning compliant rollers; a turret with flywheel and hood; a cover flap that flips over the intake to place balls into FLOWERS; 10-ball capacity.
- **Auto-aim:** an exact ballistic solver, with Rapier's integrator offset cancelled, plus a swept-sphere clearance check. Every *locked* shot lands in the up CELL (verified by tests).
- **AUTO recorder:** record a 30 s routine and it replays during the AUTO period of a match. If nothing is recorded, your robot skips AUTO.
- **AI robots:** partner and opponents with Offense, Defense and Mixed strategies (A* navigation, shooting-spot search, endgame FLOWER play, parking, and a no-pinning limit).
- **Gamepad API:** FTC controllers (Logitech F310, Etpark/PS4) on the standard mapping. Gamepad 2 can drive Red 2.
- **Match flow:** 0:30 AUTO, 0:08 transition, 2:00 TELEOP. HIVE TIPS unlock human-player NECTAR, FLOWERS unlock at 1:00, and the full Table 10-2 scoring includes ranking points.

## Controls
| Keyboard | Gamepad | Action |
|---|---|---|
| W A S D | Left stick | Drive / strafe (4WD: A/D turn) |
| Q E, ← → | Right stick X | Rotate |
| Space | RT | Shoot / place in FLOWER |
| F / B | A / B | Front / back intake on/off (on by default) |
| R (hold) | LT | Reverse intakes |
| G | Y | Flip cover flap |
| T | X | Auto-aim on/off |
| Z X, ↑ ↓ | D-pad | Manual turret / hood |
| Shift | LB | Slow mode |
| C | RB | Cycle camera |
| Enter | Start | Start match / pause |

## Tests
```
npm install
npm test        # headless Chromium; set CHROME_PATH if it isn't auto-detected
```
Load `index.html?headless` to script it through `window.BIOBUZZ` (`advance(sec)`, `state()`, `startMatch()`, `fillCell()`, …).

## Accuracy notes
Dimensions, counts, timing and point values come from the official manual. The following are engineering estimates: ball masses, robot mass and traction, and the HIVE's internal detent/damper model, which is tuned to reproduce the published calibration table rather than modeled part by part.
