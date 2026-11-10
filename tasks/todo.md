# Fais DoDo — to-do

Goal: anyone in New Orleans finds a happy hour that's on right now, near them, in under 60 seconds.
Base: cloned from Moyster `feature/finder-v2` on 2026-11-10 (engine identical; skin and data still Moyster's).

## Done
- [x] Clone Moyster finder v2 into nhenia/faisdodo (without the 208 MB oyster design scrapbook)
- [x] Own web address `/faisdodo`, own offline cache, own saved-spots storage (no collisions with Moyster on nhenia.github.io)
- [x] README
- [x] Happy hour data robot: map, Orleans-Parish fence, link check, specials-page fingerprints, price check, "Happy hours to re-check" issue
- [x] Verified: type-check, 9/9 unit tests, build, deploy asset checks, 23/23 browser checks, robot dry-run against a fake internet

## Next (reskin)
- [ ] Final name + visual concept
- [ ] Palette, type, artwork, markers, icons
- [ ] UI wording oyster → happy hour; rename oyster files/classes
- [ ] Data model: `kind` → drink categories; "Cheapest" sort for drinks
- [ ] Real venue list with sources
- [ ] Turn on GitHub Pages (Settings → Pages → Source: GitHub Actions)

## Notes / lessons
- Browser tests need the build and the preview server at the same address: `FIGMA_PUBLIC_URL=/faisdodo pnpm build` then `FIGMA_PUBLIC_URL=/faisdodo pnpm preview --port 4173`, and pass `http://localhost:4173/faisdodo/` to `tests/e2e.py`.
- Moyster's service worker deletes every cache that isn't its own. Fais DoDo only deletes `faisdodo-*` caches. Moyster should get the same fix, or it will wipe Fais DoDo's offline copy (same github.io address).
- The robot can't reach the Census geocoder from the Claude sandbox; it was tested with mocked responses and runs for real in GitHub Actions.
