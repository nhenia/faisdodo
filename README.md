# Fais DoDo

*Working title.* A New Orleans happy hour finder. Open it, and within a minute you know which bar near you has specials **right now**, what they cost, and how long you have left.

A *fais do-do* is a Cajun dance party. The name comes from what parents told the babies ("go to sleep") so the grown-ups could get back to the dance floor. That's the hour this app is for.

Live site (once Pages is switched on): `https://nhenia.github.io/faisdodo/`

---

## What this is, honestly

Fais DoDo is a **reskin of [Moyster](https://github.com/nhenia/moyster)**, the New Orleans oyster finder. It was cloned from Moyster's newest version (branch `feature/finder-v2`, the one with the data robot) and works exactly the same way. The engine is identical. Only the paint, the words and the venue list will change.

| | State today |
|---|---|
| Engine (finder, map, happy-hour clock, saves, sharing, offline) | ✅ Same as Moyster, working |
| Address and storage | ✅ Fais DoDo's own (`/faisdodo`), so it never collides with Moyster |
| Data robot | ✅ New happy-hour version, New Orleans only |
| Look, words, icons, artwork | ⏳ Still Moyster's oyster-punk skin |
| Venue list (`src/deals.json`) | ⏳ Still Moyster's 22 oyster happy hours. Real, sourced and all in the city, but oyster-only |

## Where it covers

**The city of New Orleans only** (Orleans Parish): French Quarter, Marigny, Bywater, Tremé, St. Roch, CBD, Warehouse District, Garden District, Uptown, Freret, Mid-City, Riverbend, Lakefront, Gentilly, Algiers and New Orleans East.

**Not** Kenner, Metairie, Chalmette, Harahan, Arabi, Gretna, the rest of the West Bank, or any other suburb. The robot enforces this (see below), so a suburb can't sneak in by accident.

## How the finder works (inherited from Moyster)

- **Opens straight into results.** It asks for your location right away. Until you answer, it shows picks from the French Quarter and says so. If location is blocked, an address box appears.
- **Four modes:** Near me · Happy hour (live now, then later today, then this week) · Cheapest (deals still available today first) · Map.
- **Three instant picks** with walking time, price, happy-hour status and a "Walk there" button (Google Maps walking directions). Everything else is listed below.
- **Map and list are linked:** tap a marker to highlight its card, tap a card to highlight its marker. Overlapping markers merge into a numbered cluster.
- **Share** (phone share sheet), **save** (stays on the phone, no account) and a details sheet with the source link.
- **Always New Orleans time.** Happy-hour status updates every minute on the city's clock, wherever the visitor's phone is set.
- Works offline after the first visit and installs to a phone's home screen.

## Updating bar info (no coding needed)

All venue data lives in **`src/deals.json`**. Edit it on GitHub (pencil icon) and commit. Each entry looks like this:

```json
{
  "id": "luke",
  "name": "Luke",
  "area": "CBD",
  "address": "333 St Charles Ave, New Orleans, LA",
  "kind": ["raw", "fried"],
  "price": 1.5,
  "unit": "each",
  "deal": "$1.50 Gulf oysters; $3 specialty oysters",
  "days": [0, 1, 2, 3, 4, 5, 6],
  "start": "15:00",
  "end": "18:00",
  "note": "Half-price select drinks",
  "source": "https://www.lukeneworleans.com/menu"
}
```

- `days`: 0 = Sunday … 6 = Saturday. `start`/`end`: 24-hour time, e.g. `"15:00"`.
- `unit`: `each`, `half-dozen`, `dozen`, or `variable` if the price isn't posted.
- `source`: the page that proves the deal. The robot watches this page, so link the actual happy-hour page, not the homepage.
- **New bar:** copy an entry, give it a unique `id`, and leave out `lat`/`lng`. The robot maps it.
- **Re-checked the specials?** Set `"updated"` at the top to today's date. After 45 days the app warns visitors that info may be stale.
- **Never guess.** If a price isn't posted, use `"price": null, "unit": "variable"` and the app shows "Market price".

> `price`, `unit` and `kind` still use Moyster's oyster wording. Changing them to drink language (e.g. `"kind": ["cocktails", "wine", "beer", "food"]`) is part of the reskin.

## The data robot

File: `.github/workflows/refresh-data.yml` (the brains are in `scripts/refresh-data.mjs`).
Runs **Monday mornings and Thursday afternoons**, whenever `deals.json` changes, and on demand (GitHub → Actions → *Happy hour data robot* → *Run workflow*).

1. **Maps** any venue missing coordinates (US Census geocoder, OpenStreetMap as backup).
2. **Fences** every venue to Orleans Parish. It asks the Census Bureau which parish each map point sits in, so a Metairie bar with a "New Orleans" mailing address still gets caught. Any suburb **fails the run** until it's removed.
3. **Checks links.** Every source page must still load.
4. **Watches specials pages.** It reads each source page, collects every price and time on it, and keeps a fingerprint. When the fingerprint changes, the specials probably changed.
5. **Checks prices.** It looks for each venue's listed price on that venue's own page.

It then commits the coordinates and checks, redeploys the site, and keeps one GitHub issue called **"Happy hours to re-check"** up to date: a checklist of exactly which bars a person should look at. When the list is empty, it closes the issue itself.

**It never changes prices, deals, days or times.** Those stay human-verified. The robot only raises its hand.

What it can't read: menus that are PDFs, photos, or built entirely in JavaScript. Those get listed as "no readable prices" so you know to check them by eye.

## For developers

```bash
pnpm install
pnpm dev              # local server
pnpm test             # finder logic + data validation (Node test runner)
pnpm typecheck
pnpm build && pnpm preview --port 4173
python3 tests/e2e.py  # browser tests at phone + desktop sizes (needs Python Playwright)
pnpm refresh-data     # run the data robot locally (needs internet)
```

- Stack: React 19 + Vite 8 + Tailwind 4, Leaflet for the map. A static web app (PWA) on GitHub Pages. No server, no accounts, no keys.
- Finder code: `src/finder/`. `logic.ts` holds every rule and is tested; plus `location.ts`, `OysterMap.tsx`, `OysterFinder.tsx`, `finder.css`.
- External services, all free and keyless: CARTO map tiles, Photon address search, Google Maps for directions, US Census geocoder.
- Images are ordinary Git files (Moyster uses Git LFS; Fais DoDo dropped it so deploys never hit LFS download limits). Keep each image under 100 MB. The deploy still fails on purpose if an image ever arrives as a placeholder.
- `.github/workflows/deploy-pages.yml` builds for the `/faisdodo` address and publishes on every push to `main`.
- Left over from Moyster and safe to ignore: `composeApp/` (an older Kotlin version), `.figma/` and the duplicate files at the top level (Figma Make leftovers). Moyster's raw oyster design scrapbook (`assets/moyster-session/`, 208 MB) was deliberately not copied.

## Reskin to-do

- [ ] Name check: keep *Fais DoDo* or pick the final name
- [ ] New palette, type, artwork, markers and icons (replace `public/art/`, `public/icons/`, `src/index.css`, `src/finder/finder.css`)
- [ ] Rewrite oyster wording in the UI (`src/App.tsx`, `src/finder/OysterFinder.tsx`) and rename oyster-named files and CSS classes
- [ ] Swap the data model from oysters to drinks (`kind`, `unit`, the "Cheapest" sort)
- [ ] Build the real happy-hour venue list, every entry with a `source` link
- [ ] Turn on GitHub Pages (Settings → Pages → Source: *GitHub Actions*)
