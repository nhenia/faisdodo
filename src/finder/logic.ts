// Pure, testable logic for the oyster finder. No React, no browser APIs.
// Everything time-related is computed in New Orleans time, wherever the phone is.

export type Venue = {
  id: string
  name: string
  area: string
  address: string
  lat?: number | null
  lng?: number | null
  kind: string[]
  price: number | null
  unit: string
  deal: string
  days: number[]
  start: string | null
  end: string | null
  note: string
  source: string
  /** Optional per-venue "last checked" date (YYYY-MM-DD). Falls back to the file's `updated`. */
  verified?: string
}

export type Coordinates = { lat: number; lng: number }
export type Mode = "near" | "happy" | "cheap" | "map"

export type NolaClock = { day: number; minutes: number }

export type HappyHour =
  | { state: "now"; endsIn: number; end: string }
  | { state: "later"; startsIn: number; start: string; end: string }
  | { state: "upcoming"; dayOffset: number; day: number; start: string; end: string }
  | { state: "none" }

export type Ranked = {
  venue: Venue
  miles: number | null
  walk: number | null
  hh: HappyHour
  perOyster: number | null
}

export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

/** The French Quarter (Jackson Square). Used, and labelled as such, until we know where you are. */
export const DEFAULT_ORIGIN: Coordinates & { label: string } = {
  lat: 29.95746,
  lng: -90.06301,
  label: "French Quarter",
}

export function nolaClock(date: Date = new Date()): NolaClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ""
  return {
    day: DAY_NAMES.indexOf(get("weekday")),
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
  }
}

export const toMinutes = (time: string) => {
  const [h, m] = time.split(":").map(Number)
  return h * 60 + (m || 0)
}

export function happyHour(venue: Venue, clock: NolaClock): HappyHour {
  if (!venue.start || !venue.end || venue.days.length === 0) return { state: "none" }
  const start = toMinutes(venue.start)
  const end = toMinutes(venue.end)
  if (venue.days.includes(clock.day)) {
    if (clock.minutes >= start && clock.minutes < end)
      return { state: "now", endsIn: end - clock.minutes, end: venue.end }
    if (clock.minutes < start)
      return { state: "later", startsIn: start - clock.minutes, start: venue.start, end: venue.end }
  }
  for (let offset = 1; offset <= 7; offset++) {
    const day = (clock.day + offset) % 7
    if (venue.days.includes(day))
      return { state: "upcoming", dayOffset: offset, day, start: venue.start, end: venue.end }
  }
  return { state: "none" }
}

/** Normalise a posted price to dollars per oyster. Never guesses: unknown units return null. */
export function perOyster(venue: Venue): number | null {
  if (venue.price == null || !Number.isFinite(venue.price)) return null
  switch (venue.unit) {
    case "each":
      return venue.price
    case "half-dozen":
      return venue.price / 6
    case "dozen":
      return venue.price / 12
    default:
      return null
  }
}

export function milesBetween(a: Coordinates, b: Coordinates) {
  const rad = (v: number) => (v * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 3958.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

/**
 * Walking minutes from straight-line miles. Streets aren't straight, so we add 25% for the
 * grid, then walk at 3 mph (20 min/mile). Rounded up, minimum 1.
 */
export const walkMinutes = (miles: number) => Math.max(1, Math.ceil(miles * 1.25 * 20))

export const hasCoords = (v: Venue): v is Venue & { lat: number; lng: number } =>
  typeof v.lat === "number" && typeof v.lng === "number" && Number.isFinite(v.lat) && Number.isFinite(v.lng)

export function enrich(venues: Venue[], origin: Coordinates, clock: NolaClock): Ranked[] {
  return venues.map((venue) => {
    const miles = hasCoords(venue) ? milesBetween(origin, venue) : null
    return {
      venue,
      miles,
      walk: miles == null ? null : walkMinutes(miles),
      hh: happyHour(venue, clock),
      perOyster: perOyster(venue),
    }
  })
}

const byMiles = (a: Ranked, b: Ranked) =>
  (a.miles ?? Infinity) - (b.miles ?? Infinity) || a.venue.name.localeCompare(b.venue.name)

const hhRank = (hh: HappyHour) => {
  switch (hh.state) {
    case "now":
      return 0
    case "later":
      return 1_000 + hh.startsIn
    case "upcoming":
      return 10_000 + hh.dayOffset * 1_440 + toMinutes(hh.start)
    default:
      return Infinity
  }
}

export const appliesToday = (hh: HappyHour) => hh.state === "now" || hh.state === "later"

export function rank(list: Ranked[], mode: Mode): Ranked[] {
  const items = [...list]
  switch (mode) {
    case "happy":
      return items
        .filter((r) => r.hh.state !== "none")
        .sort((a, b) => hhRank(a.hh) - hhRank(b.hh) || byMiles(a, b))
    case "cheap":
      // "Lowest applicable price": deals you can still get today first, then the rest of the week.
      return items
        .filter((r) => r.perOyster != null)
        .sort(
          (a, b) =>
            Number(appliesToday(b.hh)) - Number(appliesToday(a.hh)) ||
            a.perOyster! - b.perOyster! ||
            byMiles(a, b),
        )
    default:
      return items.sort(byMiles)
  }
}

// ---------- Formatting ----------

export function formatTime(time: string) {
  const [h, m] = time.split(":").map(Number)
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h >= 12 ? "pm" : "am"}`
}

export function formatDuration(minutes: number) {
  if (minutes < 60) return `${minutes}m`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

export function formatMoney(value: number) {
  if (value < 1) return `${Math.round(value * 100)}¢`
  return `$${Number.isInteger(value) ? value : value.toFixed(2)}`
}

/** Headline price, e.g. "$1.50 ea", "$10 / 6". Null when no verified price exists. */
export function formatPrice(venue: Venue): string | null {
  if (venue.price == null) return null
  const money = formatMoney(venue.price)
  switch (venue.unit) {
    case "each":
      return `${money} ea`
    case "half-dozen":
      return `${money} / 6`
    case "dozen":
      return `${money} / 12`
    default:
      return money
  }
}

export function formatHappyHour(hh: HappyHour): string {
  switch (hh.state) {
    case "now":
      return `Happy hour now · til ${formatTime(hh.end)}`
    case "later":
      return `Happy hour ${formatTime(hh.start)} · in ${formatDuration(hh.startsIn)}`
    case "upcoming":
      return `Happy hour ${hh.dayOffset === 1 ? "tomorrow" : DAY_NAMES[hh.day]} ${formatTime(hh.start)}`
    default:
      return "No posted special"
  }
}

export function formatWalk(r: Pick<Ranked, "walk" | "miles">): string | null {
  if (r.walk == null || r.miles == null) return null
  if (r.walk <= 45) return `${r.walk} min walk`
  return `${r.miles.toFixed(1)} mi · ride`
}

/** Days between a YYYY-MM-DD date and now. */
export function daysSince(isoDate: string, now: Date = new Date()) {
  const then = new Date(`${isoDate}T12:00:00-06:00`).getTime()
  if (!Number.isFinite(then)) return Infinity
  return Math.floor((now.getTime() - then) / 86_400_000)
}

export const STALE_AFTER_DAYS = 45

export function walkingDirections(venue: Venue) {
  // Name + address lands on the actual business listing in Google Maps (better than raw coordinates).
  const destination = `${venue.name}, ${venue.address}`
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=walking`
}
