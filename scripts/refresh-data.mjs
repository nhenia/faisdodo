#!/usr/bin/env node
// Fais DoDo data robot — run by .github/workflows/refresh-data.yml
// (every Monday and Thursday, and whenever src/deals.json changes), or locally with:  pnpm refresh-data
//
// Same rules as the Moyster robot it came from, plus three happy-hour jobs:
//   1. MAP:    fills in missing coordinates by geocoding each street address
//              (US Census geocoder first, OpenStreetMap Nominatim as a fallback).
//   2. FENCE:  confirms every venue sits inside Orleans Parish — the city of New Orleans,
//              including Algiers and New Orleans East. Kenner, Metairie, Chalmette and every
//              other suburb are out. The check asks the Census Bureau which parish the map point
//              is in, so it can't be fooled by a "New Orleans" mailing address in Metairie.
//   3. LINKS:  checks every venue's source page (menu / happy-hour page) still loads.
//   4. WATCH:  reads each source page, pulls out every price and time it can find, and keeps a
//              fingerprint. When the fingerprint changes, the specials have probably changed.
//   5. PRICE:  looks for the venue's listed price on its own page and flags it if it's missing.
//
// It NEVER changes names, prices, deals, days or times. Those are human-verified: the robot
// only raises its hand. The "updated" date in deals.json changes only when a person re-checks.
//
// Outputs: src/deals.json (coordinates + a `checks` block), a short report in the workflow
// summary, and recheck.md (the to-do list the workflow posts as a GitHub issue).

import fs from "node:fs/promises"
import path from "node:path"
import crypto from "node:crypto"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const file = path.join(root, "src", "deals.json")
const UA = "FaisDoDo/1.0 (https://github.com/nhenia/faisdodo; data refresh)"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// --- The service area -------------------------------------------------------------------------
// Orleans Parish, Louisiana. 22 = Louisiana, 071 = Orleans Parish (Census county code).
const ORLEANS = { state: "22", county: "071", name: "Orleans Parish" }
// Belt and braces: addresses naming these places are rejected even before the map check.
const OUTSIDE = [
  "kenner", "metairie", "chalmette", "harahan", "river ridge", "elmwood", "jefferson, la",
  "arabi", "meraux", "violet", "st. bernard", "saint bernard", "gretna", "harvey", "marrero",
  "westwego", "terrytown", "belle chasse", "slidell", "mandeville", "covington", "laplace",
]
const namesSuburb = (address) => OUTSIDE.find((place) => address.toLowerCase().includes(place))

async function fetchJson(url, ms = 15000) {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(ms) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// Census "geographies" lookups return the parish along with the match.
const CENSUS = "https://geocoding.geo.census.gov/geocoder/geographies"
const CENSUS_OPTS = "benchmark=Public_AR_Current&vintage=Current_Current&layers=Counties&format=json"
const parishOf = (geographies) => {
  const c = geographies?.Counties?.[0]
  return c ? { state: c.STATE, county: c.COUNTY, name: c.NAME } : null
}
const isOrleans = (p) => p?.state === ORLEANS.state && p?.county === ORLEANS.county

async function census(address) {
  const json = await fetchJson(`${CENSUS}/onelineaddress?${CENSUS_OPTS}&address=${encodeURIComponent(address)}`)
  const match = json.result?.addressMatches?.[0]
  return match
    ? { lat: match.coordinates.y, lng: match.coordinates.x, parish: parishOf(match.geographies), by: "census" }
    : null
}

async function nominatim(address) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&countrycodes=us&q=${encodeURIComponent(address)}`
  const hit = (await fetchJson(url))[0]
  await sleep(1100) // Nominatim policy: max 1 request per second
  if (!hit) return null
  const county = hit.address?.county ?? ""
  return {
    lat: Number(hit.lat),
    lng: Number(hit.lon),
    parish: /orleans parish/i.test(county) ? { ...ORLEANS } : { state: "?", county: "?", name: county || "unknown" },
    by: "osm",
  }
}

async function geocode(address) {
  for (const provider of [census, nominatim]) {
    try {
      const hit = await provider(address)
      if (hit) return hit
    } catch (error) {
      console.warn(`  ${provider.name} failed for "${address}": ${error.message}`)
    }
  }
  return null
}

// Which parish is this map point in? (Used for every venue, every run.)
async function parishAt(lat, lng) {
  try {
    const json = await fetchJson(`${CENSUS}/coordinates?${CENSUS_OPTS}&x=${lng}&y=${lat}`)
    return parishOf(json.result?.geographies)
  } catch (error) {
    console.warn(`  parish lookup failed at ${lat},${lng}: ${error.message}`)
    return null // unknown — reported, never treated as "outside"
  }
}

// --- Reading source pages ---------------------------------------------------------------------
async function readPage(url) {
  for (const method of ["HEAD", "GET"]) {
    try {
      const res = await fetch(url, {
        method,
        redirect: "follow",
        headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*" },
        signal: AbortSignal.timeout(20000),
      })
      if (!res.ok) continue // some sites block HEAD or bots (403/405); try GET before giving up
      if (method === "HEAD") continue // it loads; now GET it so we can read it
      const type = res.headers.get("content-type") ?? ""
      const text = /html|text/.test(type) ? await res.text() : ""
      return { ok: true, text, type }
    } catch {
      /* try next method */
    }
  }
  return { ok: false, text: "", type: "" }
}

// Strip a web page down to its visible words.
const visibleText = (html) =>
  html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .toLowerCase()

// Every price ("$5", "$1.50", "75¢") and every time ("3pm", "4:30 p.m.", "15:00") on the page.
// The fingerprint ignores everything else, so a new photo or blog post won't raise a false alarm.
function specialsTokens(text) {
  const prices = text.match(/\$\s?\d{1,3}(?:\.\d{2})?|\d{1,2}\s?¢/g) ?? []
  const times = text.match(/\b\d{1,2}(?::\d{2})?\s?(?:a\.?m\.?|p\.?m\.?)|\b[01]?\d:[0-5]\d\b|\b2[0-3]:[0-5]\d\b/g) ?? []
  return [...prices, ...times].map((t) => t.replace(/\s|\./g, ""))
}
const fingerprint = (tokens) =>
  tokens.length ? crypto.createHash("sha256").update(tokens.join("|")).digest("hex").slice(0, 16) : null

// Is the venue's own price printed on its own page? "$1.50", "$1.5", "$5" and "75¢" all count.
function priceOnPage(price, text) {
  if (typeof price !== "number") return null // variable / unknown prices can't be checked
  const page = text.replace(/\$\s+/g, "$")
  const forms = [`$${price.toFixed(2)}`, `$${price}`]
  if (price < 1) forms.push(`${Math.round(price * 100)}¢`)
  // "$1.5" must not match inside "$1.55"; "$5" must not match inside "$50".
  return forms.some((f) => new RegExp(`${f.replace(/[$.]/g, "\\$&")}(?!\\d|\\.\\d)`).test(page))
}

// --- Run ----------------------------------------------------------------------------------------
const round = (n) => Math.round(n * 1e5) / 1e5
const data = JSON.parse(await fs.readFile(file, "utf8"))
const before = data.checks?.fingerprints ?? {}
const report = {
  geocoded: [], unresolved: [], outOfArea: [], parishUnknown: [],
  brokenLinks: [], changed: [], priceMissing: [], unreadable: [],
}

for (const venue of data.venues) {
  const suburb = namesSuburb(venue.address)
  if (suburb) report.outOfArea.push(`${venue.name} (address says "${suburb}")`)

  if (typeof venue.lat !== "number" || typeof venue.lng !== "number") {
    const hit = await geocode(venue.address)
    if (hit) {
      venue.lat = round(hit.lat)
      venue.lng = round(hit.lng)
      venue.geocoded = hit.by
      report.geocoded.push(`${venue.name} (${hit.by})`)
    } else {
      report.unresolved.push(venue.name)
      continue
    }
  }

  if (!suburb) {
    const parish = await parishAt(venue.lat, venue.lng)
    if (!parish) report.parishUnknown.push(venue.name)
    else if (!isOrleans(parish)) report.outOfArea.push(`${venue.name} (map point is in ${parish.name})`)
  }
}

const fingerprints = {}
await Promise.all(
  data.venues.map(async (venue) => {
    const page = await readPage(venue.source)
    if (!page.ok) return report.brokenLinks.push(venue.id)
    const text = visibleText(page.text)
    const tokens = specialsTokens(text)
    const print = fingerprint(tokens)
    if (!print) return report.unreadable.push(venue.id) // PDF menu, image menu or JavaScript-only page
    fingerprints[venue.id] = print
    if (before[venue.id] && before[venue.id] !== print) report.changed.push(venue.id)
    // A board photo from the last 30 days outranks the website, which is often the stale one.
    const boardIsFresh = venue.board && venue.verified && Date.now() - Date.parse(venue.verified) < 30 * 864e5
    if (!boardIsFresh && priceOnPage(venue.price, text) === false) report.priceMissing.push(venue.id)
  }),
)

const sorted = (list) => [...list].sort()
data.checks = {
  ranAt: new Date().toISOString().slice(0, 10),
  area: "Orleans Parish only (no Kenner, Metairie, Chalmette or other suburbs)",
  brokenLinks: sorted(report.brokenLinks),
  outOfArea: report.outOfArea,
  changedPages: sorted(report.changed),
  priceNotOnPage: sorted(report.priceMissing),
  unreadablePages: sorted(report.unreadable),
  // Keep old fingerprints for pages we couldn't read this time, so one bad day isn't a "change".
  fingerprints: Object.fromEntries(Object.entries({ ...before, ...fingerprints }).sort()),
}

await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`)

// --- Report -------------------------------------------------------------------------------------
const named = (ids) => ids.map((id) => data.venues.find((v) => v.id === id)).filter(Boolean)
const list = (items) => (items.length ? items.join(", ") : "none")
const lines = [
  "## Fais DoDo data robot",
  `- Specials last verified by a person: **${data.updated}**`,
  `- Newly mapped: ${list(report.geocoded)}`,
  `- Could not map: ${list(report.unresolved)}`,
  `- Outside New Orleans (must be removed): ${list(report.outOfArea)}`,
  `- Parish lookup failed (try again next run): ${list(report.parishUnknown)}`,
  `- Source pages not loading: ${list(sorted(report.brokenLinks))}`,
  `- Specials page changed since last run: ${list(sorted(report.changed))}`,
  `- Listed price not found on its own page: ${list(sorted(report.priceMissing))}`,
  `- Page has no readable prices/times (PDF, image or app menu): ${list(sorted(report.unreadable))}`,
]
console.log(lines.join("\n"))
if (process.env.GITHUB_STEP_SUMMARY) await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`)

// The human to-do list. Empty file = nothing to re-check.
const todo = [
  ...report.outOfArea.map((v) => `- [ ] **Remove** ${v} — outside New Orleans`),
  ...named(sorted(report.changed)).map((v) => `- [ ] Re-check **${v.name}** — specials page changed · [source](${v.source})`),
  ...named(sorted(report.priceMissing)).map((v) => `- [ ] Confirm **${v.name}** still has "${v.deal}" · [source](${v.source})`),
  ...named(sorted(report.brokenLinks)).map((v) => `- [ ] Find a new source link for **${v.name}** (${v.source} isn't loading)`),
]
await fs.writeFile(
  path.join(root, "recheck.md"),
  todo.length
    ? `The data robot found ${todo.length} thing(s) a person should look at (run ${data.checks.ranAt}).\n` +
        `Tick each box after you fix \`src/deals.json\`, then close this issue.\n\n${todo.join("\n")}\n`
    : "",
)

// Out-of-area venues are recorded in checks.outOfArea; the workflow's last step fails the run on
// them (after saving), so they're loud but the rest of the robot's work still gets kept.
