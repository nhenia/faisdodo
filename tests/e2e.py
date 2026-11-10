import json, os, sys, base64
from playwright.sync_api import sync_playwright

OUT = os.environ.get("SHOTS", "test-screenshots")
os.makedirs(OUT, exist_ok=True)
URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4173/"
# 1x1 beige PNG standing in for street tiles (tile servers aren't reachable from this sandbox)
TILE = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN89+7dfwAJbAPWPSaUhAAAAABJRU5ErkJggg==")
PHOTON = {"features": [
    {"geometry": {"coordinates": [-90.0715, 29.9511]}, "properties": {"name": "Canal Street", "city": "New Orleans", "state": "Louisiana"}},
]}
fails = []
def check(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond: fails.append(msg)

def setup(ctx):
    ctx.route("https://*.basemaps.cartocdn.com/**", lambda r: r.fulfill(status=200, content_type="image/png", body=TILE))
    ctx.route("**/photon.komoot.io/**", lambda r: r.fulfill(status=200, content_type="application/json", body=json.dumps(PHOTON)))
    ctx.route("**/fonts.googleapis.com/**", lambda r: r.fulfill(status=200, content_type="text/css", body=""))

with sync_playwright() as p:
    b = p.chromium.launch()

    # --- Mobile, location allowed, Tuesday 4:10pm New Orleans (happy hour live) ---
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True,
                        geolocation={"latitude": 29.9547, "longitude": -90.0697}, permissions=["geolocation"])
    setup(ctx)
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: m.type == "error" and "ERR_TUNNEL" not in m.text and errors.append(m.text))
    page.clock.install(time="2026-11-10T22:10:00Z")  # Tue 4:10pm CST
    page.goto(URL)
    page.wait_for_selector(".mf-pick")
    page.wait_for_function("document.querySelector('.mf-origin strong').textContent.includes('You are here')")
    check(page.locator(".mf-pick").count() == 3, "three instant picks")
    first = page.locator(".mf-pick").first.inner_text()
    check("min walk" in first, f"pick shows walking time ({first.splitlines()[2:4]})")
    check(page.locator(".mf-hh.is-live").count() == 1, "happy hour ribbon is live at 4:10pm Tue")
    check(page.locator(".mf-pick .mf-go").first.get_attribute("href").startswith("https://www.google.com/maps/dir/"), "walk link is walking directions")
    check("travelmode=walking" in page.locator(".mf-pick .mf-go").first.get_attribute("href"), "directions are walking mode")
    check(page.locator(".mf-pin").count() >= 3, f"oyster markers on map ({page.locator('.mf-pin').count()})")
    page.wait_for_timeout(800)
    page.screenshot(path=f"{OUT}/m1-near.png", full_page=False)
    page.screenshot(path=f"{OUT}/m1-near-full.png", full_page=True)

    # map -> list sync
    pin = page.locator(".mf-pin:not(.mf-cluster)").nth(1)
    title = pin.get_attribute("title")
    pin.click(force=True)
    page.wait_for_timeout(400)
    sel = page.locator(".is-selected .mf-pick-name, .mf-row.is-selected .mf-row-name")
    check(sel.count() == 1 and title.upper() in sel.first.inner_text().upper(), f"marker click selects '{title}' in list")
    # list -> map sync
    page.locator(".mf-pick-main").nth(2).click()
    page.wait_for_timeout(400)
    name3 = page.locator(".mf-pick-name").nth(2).inner_text()
    check(page.locator(".mf-pin.is-selected").get_attribute("title").upper() == name3.upper(), "card click highlights its marker")

    # happy hour mode
    page.locator(".mf-mode-happy").click()
    chips = page.locator(".mf-pick .mf-chip").all_inner_texts()
    check(all("NOW" in c.upper() for c in chips), f"happy mode leads with live specials {chips}")
    page.screenshot(path=f"{OUT}/m2-happy.png")

    # cheapest mode
    page.locator(".mf-mode-cheap").click()
    prices = page.locator(".mf-pick .mf-price b").all_inner_texts()
    check(all(x != "Market price" for x in prices), f"cheapest shows verified prices only {prices}")
    page.screenshot(path=f"{OUT}/m3-cheap.png")

    # map mode
    page.locator(".mf-mode-map").click()
    page.wait_for_timeout(600)
    h = page.locator(".mf-map").bounding_box()["height"]
    check(h > 400, f"map mode expands map ({int(h)}px)")
    page.screenshot(path=f"{OUT}/m4-map.png")

    # detail sheet + save persists
    page.locator(".mf-mode-near").click()
    page.locator(".mf-pick").first.get_by_role("button", name="Details").click()
    check(page.locator(".mf-sheet h2").is_visible(), "detail sheet opens")
    page.screenshot(path=f"{OUT}/m5-detail.png")
    page.keyboard.press("Escape")
    page.locator(".mf-pick").first.get_by_role("button", name="Save").click()
    page.reload()
    page.wait_for_selector(".mf-pick")
    check("★" in page.locator(".mf-pick .mf-actions").first.inner_text(), "saved spot survives reload")
    check(page.locator(".hero").count() == 1 and page.locator(".art-grid .art-card").count() == 10, "art journal below is intact")
    check(not errors, f"no console errors {errors[:3]}")
    ctx.close()

    # --- Mobile, location denied -> address fallback ---
    ctx = b.new_context(viewport={"width": 375, "height": 740}, is_mobile=True, has_touch=True, permissions=[])
    setup(ctx)
    page = ctx.new_page()
    page.clock.install(time="2026-11-10T15:00:00Z")  # Tue 9am: no happy hour yet
    page.goto(URL)
    page.wait_for_selector(".mf-search input", timeout=15000)
    check(page.locator(".mf-alert").is_visible(), "denied location explains itself")
    check(page.locator(".mf-pick").count() == 3, "picks still shown from French Quarter while denied")
    check("NEXT HAPPY HOUR" in page.locator(".mf-hh").inner_text(), "ribbon shows next happy hour in the morning")
    page.screenshot(path=f"{OUT}/m6-denied.png")
    page.fill(".mf-search input", "canal st")
    page.wait_for_selector(".mf-search-results button")
    page.locator(".mf-search-results button").first.click()
    check("Canal Street" in page.locator(".mf-origin strong").inner_text(), "address pick becomes the search center")
    ctx.close()

    # --- Address search outage ---
    ctx = b.new_context(viewport={"width": 375, "height": 740}, permissions=[])
    setup(ctx)
    ctx.unroute("**/photon.komoot.io/**")
    ctx.route("**/photon.komoot.io/**", lambda r: r.abort())
    ctx.unroute("https://*.basemaps.cartocdn.com/**")
    ctx.route("https://*.basemaps.cartocdn.com/**", lambda r: r.abort())
    page = ctx.new_page()
    page.goto(URL)
    page.wait_for_selector(".mf-search input", timeout=15000)
    page.wait_for_timeout(300)
    page.fill(".mf-search input", "bourbon")
    page.wait_for_selector(".mf-search-state")
    page.wait_for_timeout(600)
    check("down" in page.locator(".mf-search-state").inner_text(), "address search failure is explained")
    page.wait_for_selector(".mf-map-note", timeout=8000)
    check(page.locator(".mf-map-note").count() == 1 and page.locator(".mf-pin").count() >= 3, "tile outage explained, markers still shown")
    ctx.close()

    # --- Desktop ---
    ctx = b.new_context(viewport={"width": 1440, "height": 900}, geolocation={"latitude": 29.9547, "longitude": -90.0697}, permissions=["geolocation"])
    setup(ctx)
    page = ctx.new_page()
    page.clock.install(time="2026-11-10T22:10:00Z")
    page.goto(URL)
    page.wait_for_selector(".mf-pick")
    page.wait_for_timeout(900)
    check(page.locator(".leaflet-tile-loaded").count() > 0 and page.locator(".mf-map-note").count() == 0, "street tiles load, no warning")
    page.screenshot(path=f"{OUT}/d1.png")
    page.screenshot(path=f"{OUT}/d1-full.png", full_page=True)
    page.mouse.wheel(600, 0); page.evaluate("window.scrollTo(600, window.scrollY)"); page.wait_for_timeout(200)
    sx = page.evaluate("window.scrollX")
    check(sx == 0, f"page can't be scrolled sideways on desktop (scrollX={sx})")
    ctx.close()
    b.close()

print("\nFAILURES:", fails if fails else "none")
sys.exit(1 if fails else 0)
