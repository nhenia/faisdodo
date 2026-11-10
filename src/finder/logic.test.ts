// Run with: pnpm test   (uses Node's built-in test runner; no extra dependencies)
import { test } from "node:test"
import assert from "node:assert/strict"
import data from "../deals.json" with { type: "json" }
import {
  type Venue,
  DEFAULT_ORIGIN,
  daysSince,
  enrich,
  formatHappyHour,
  formatPrice,
  formatWalk,
  happyHour,
  milesBetween,
  nolaClock,
  perOyster,
  rank,
  walkMinutes,
} from "./logic.ts"

const venues = data.venues as Venue[]
const base: Venue = {
  id: "x", name: "X", area: "", address: "", kind: ["raw"], price: 1, unit: "each",
  deal: "", days: [1, 2, 3, 4, 5], start: "15:00", end: "18:00", note: "", source: "",
}

test("nolaClock reads New Orleans time, not the phone's", () => {
  // 2026-11-06 is a Friday. 21:30 UTC = 3:30pm CST.
  assert.deepEqual(nolaClock(new Date("2026-11-06T21:30:00Z")), { day: 5, minutes: 15 * 60 + 30 })
  // Midnight UTC Saturday is still Friday 6pm in New Orleans.
  assert.deepEqual(nolaClock(new Date("2026-11-07T00:00:00Z")), { day: 5, minutes: 18 * 60 })
})

test("happy hour: now / later today / upcoming / none", () => {
  assert.deepEqual(happyHour(base, { day: 1, minutes: 16 * 60 }), { state: "now", endsIn: 120, end: "18:00" })
  assert.equal(happyHour(base, { day: 1, minutes: 14 * 60 }).state, "later")
  // Ends exactly at 6pm: 6:00 is no longer "now".
  const after = happyHour(base, { day: 5, minutes: 18 * 60 })
  assert.equal(after.state, "upcoming")
  assert.equal(after.state === "upcoming" && after.day, 1) // Friday evening -> Monday
  assert.equal(happyHour({ ...base, days: [] }, { day: 1, minutes: 0 }).state, "none")
  assert.equal(happyHour({ ...base, start: null }, { day: 1, minutes: 0 }).state, "none")
})

test("price per oyster never guesses unknown units", () => {
  assert.equal(perOyster(base), 1)
  assert.equal(perOyster({ ...base, price: 10, unit: "half-dozen" })!.toFixed(4), (10 / 6).toFixed(4))
  assert.equal(perOyster({ ...base, price: 18, unit: "dozen" }), 1.5)
  assert.equal(perOyster({ ...base, price: null, unit: "variable" }), null)
  assert.equal(perOyster({ ...base, price: 5, unit: "plate" }), null)
  assert.equal(formatPrice({ ...base, price: 0.75 }), "75¢ ea")
  assert.equal(formatPrice({ ...base, price: 1.5 }), "$1.50 ea")
  assert.equal(formatPrice({ ...base, price: 10, unit: "half-dozen" }), "$10 / 6")
  assert.equal(formatPrice({ ...base, price: null }), null)
})

test("distance and walking time are plausible", () => {
  // Bourbon House -> Desire Oyster Bar is about a block and a half.
  const miles = milesBetween({ lat: 29.95361, lng: -90.06953 }, { lat: 29.95527, lng: -90.0682 })
  assert.ok(miles > 0.1 && miles < 0.2, `got ${miles}`)
  assert.equal(walkMinutes(0.2), 5)
  assert.equal(walkMinutes(0), 1)
  assert.equal(formatWalk({ walk: 80, miles: 3.2 }), "3.2 mi · ride")
  assert.equal(formatWalk({ walk: null, miles: null }), null)
})

test("near: closest first, unmapped venues last", () => {
  const list = rank(enrich(venues, DEFAULT_ORIGIN, { day: 2, minutes: 900 }), "near")
  const found = list.findIndex((r) => r.miles == null)
  const firstUnmapped = found === -1 ? list.length : found // every venue may be mapped
  assert.ok(list.slice(firstUnmapped).every((r) => r.miles == null))
  for (let i = 1; i < firstUnmapped; i++) assert.ok(list[i - 1].miles! <= list[i].miles!)
  assert.equal(list.length, venues.length, "near mode never hides venues")
})

test("happy: live specials first, then later today, then later this week", () => {
  // Tuesday 3:30pm
  const list = rank(enrich(venues, DEFAULT_ORIGIN, { day: 2, minutes: 15 * 60 + 30 }), "happy")
  const states = list.map((r) => r.hh.state)
  assert.ok(states.every((s) => s !== "none"))
  const order = { now: 0, later: 1, upcoming: 2 } as const
  for (let i = 1; i < states.length; i++)
    assert.ok(order[states[i - 1] as keyof typeof order] <= order[states[i] as keyof typeof order])
  assert.equal(list[0].hh.state, "now")
})

test("cheap: only verified prices; deals still available today come first", () => {
  // Monday 10am: Basin's 75¢ Monday special starts at 11am.
  const list = rank(enrich(venues, DEFAULT_ORIGIN, { day: 1, minutes: 600 }), "cheap")
  assert.ok(list.every((r) => r.perOyster != null))
  assert.equal(list[0].venue.id, "basin")
  // Tuesday: Basin's special is days away, so it drops below today's deals.
  const tue = rank(enrich(venues, DEFAULT_ORIGIN, { day: 2, minutes: 600 }), "cheap")
  const basin = tue.findIndex((r) => r.venue.id === "basin")
  const lastToday = tue.findLastIndex((r) => r.hh.state === "now" || r.hh.state === "later")
  assert.ok(basin > lastToday)
})

test("labels read naturally", () => {
  assert.equal(formatHappyHour({ state: "now", endsIn: 30, end: "18:00" }), "Happy hour now · til 6pm")
  assert.equal(formatHappyHour({ state: "later", startsIn: 75, start: "16:00", end: "18:00" }), "Happy hour 4pm · in 1h 15m")
  assert.equal(formatHappyHour({ state: "upcoming", dayOffset: 1, day: 3, start: "15:30", end: "18:00" }), "Happy hour tomorrow 3:30pm")
})

test("data file is well formed (no invented fields, valid times and coordinates)", () => {
  const ids = new Set<string>()
  for (const v of venues) {
    assert.ok(!ids.has(v.id), `duplicate id ${v.id}`)
    ids.add(v.id)
    assert.ok(v.name && v.address && v.source.startsWith("http"), v.id)
    if (v.start || v.end) assert.match(`${v.start}-${v.end}`, /^\d{2}:\d{2}-\d{2}:\d{2}$/, v.id)
    if (v.lat != null) assert.ok(v.lat > 29.8 && v.lat < 30.2 && v.lng! < -89.8 && v.lng! > -90.3, `${v.id} coordinates outside New Orleans`)
  }
  assert.ok(daysSince("2026-10-29", new Date("2026-11-06T12:00:00-06:00")) === 8)
})
