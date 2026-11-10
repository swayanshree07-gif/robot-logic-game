# Release checklist (v1.0, Day 30)

Run from the project root. All passed on 2026-11-10.

| Check | Command | Result on 2026-11-10 |
|---|---|---|
| Unit + level tests | `node --test test/` | 306 pass, 0 fail |
| Every level solvable | `node scripts/verify-levels.mjs` | 92 floors, 0 failed (88 solver optimum, 4 by solution) |
| Browser files load | `node scripts/check-static.mjs` | ok, 41 modules |
| Docs links + coverage | `node scripts/check-docs.mjs` | ok, 6 docs |
| Scripted demo | `node scripts/demo.mjs` | all checks passed |
| Smoke screenshots (optional, needs Firefox) | `scripts/screenshots.sh` | last run Day 29 |

Manual, by a person in a real browser (not done by the automated sessions):
- [ ] Play World 1 from the map with no URL parameters; progress survives a reload.
- [ ] Lab: build a level, Share, paste the code into Import on another tab.
- [ ] Sound and confetti play on a win; Reduce motion turns them off.
