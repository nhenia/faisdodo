import { useEffect, useMemo, useState } from "react"
import deals from "./deals.json"

const animationBase = "https://media.githubusercontent.com/media/nhenia/moyster/main/assets/moyster-session/"

type Venue = {
  id: string
  name: string
  area: string
  address: string
  lat?: number
  lng?: number
  kind: string[]
  price: number | null
  unit: string
  deal: string
  days: number[]
  start: string | null
  end: string | null
  note: string
  source: string
}

type Filter = "all" | "specials" | "raw" | "chargrilled" | "today" | "saved" | "near"
type Coordinates = { lat: number lng: number }

const venues = deals.venues as Venue[]
const filters: { value: Filter label: string }[] = [
  { value: "all", label: "All spots" },
  { value: "specials", label: "Happy hours" },
  { value: "raw", label: "Raw" },
  { value: "chargrilled", label: "Chargrilled" },
  { value: "today", label: "Today" },
  { value: "saved", label: "Saved" },
  { value: "near", label: "Near me" },
]

const hasSpecial = (venue: Venue) =>
  venue.days.length > 0 && Boolean(venue.start && venue.end)

const nolaDay = () => {
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
  }).format(new Date())
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(weekday)
}

const formatTime = (time: string | null) => {
  if (!time) return ""
  const [hour, minute] = time.split(":").map(Number)
  return `${hour % 12 || 12}${
    minute ? `:${String(minute).padStart(2, "0")}` : ""
  }${hour >= 12 ? "pm" : "am"}`
}

const distance = (a: Coordinates, b: Coordinates) => {
  const rad = (value: number) => (value * Math.PI) / 180
  const earthMiles = 3958.8
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return earthMiles * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

const pinPosition = (venue: Venue) => {
  const bounds = { north: 29.96, south: 29.942, east: -90.06, west: -90.078 }
  const left =
    (((venue.lng ?? bounds.west) - bounds.west) / (bounds.east - bounds.west)) *
    100
  const top =
    ((bounds.north - (venue.lat ?? bounds.south)) /
      (bounds.north - bounds.south)) *
    100
  return {
    left: `${Math.max(5, Math.min(95, left))}%`,
    top: `${Math.max(7, Math.min(92, top))}%`,
  }
}

export default function OysterFinder() {
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<Filter>("all")
  const [view, setView] = useState<"list" | "map">("list")
  const [active, setActive] = useState<Venue | null>(null)
  const [location, setLocation] = useState<Coordinates | null>(null)
  const [locationMessage, setLocationMessage] = useState("")
  const [saved, setSaved] = useState<Set<string>>(() => {
    try {
      return new Set(
        JSON.parse(localStorage.getItem("moyster-saved") ?? "[]") as string[],
      )
    } catch {
      return new Set()
    }
  })

  useEffect(() => {
    if (!active) return
    const close = (event: KeyboardEvent) =>
      event.key === "Escape" && setActive(null)
    window.addEventListener("keydown", close)
    return () => window.removeEventListener("keydown", close)
  }, [active])

  const visible = useMemo(() => {
    const needle = query.toLowerCase().trim()
    const today = nolaDay()
    const list = venues.filter((venue) => {
      const text = [
        venue.name,
        venue.area,
        venue.address,
        venue.deal,
        ...venue.kind,
      ]
        .join(" ")
        .toLowerCase()
      const matchesFilter =
        filter === "all" ||
        (filter === "specials" && hasSpecial(venue)) ||
        (filter === "today" && venue.days.includes(today)) ||
        (filter === "saved" && saved.has(venue.id)) ||
        (filter === "near" &&
          Number.isFinite(venue.lat) &&
          Number.isFinite(venue.lng)) ||
        venue.kind.includes(filter)
      return (!needle || text.includes(needle)) && matchesFilter
    })

    if (filter === "near" && location) {
      return [...list].sort(
        (a, b) =>
          distance(location, { lat: a.lat!, lng: a.lng! }) -
          distance(location, { lat: b.lat!, lng: b.lng! }),
      )
    }
    return list
  }, [filter, location, query, saved])

  const setMode = (next: Filter) => {
    setFilter(next)
    setLocationMessage("")
    if (next !== "near" || location) return
    if (!navigator.geolocation) {
      setLocationMessage("Location is not available on this device.")
      return
    }
    setLocationMessage("Finding your position…")
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        setLocation({ lat: coords.latitude, lng: coords.longitude })
        setLocationMessage("Nearest mapped spots are shown first.")
      },
      () =>
        setLocationMessage(
          "Location was blocked. Showing mapped French Quarter spots.",
        ),
      { enableHighAccuracy: false, timeout: 8000 },
    )
  }

  const toggleSaved = (id: string) => {
    setSaved((current) => {
      const next = new Set(current)
      next.has(id) ? next.delete(id) : next.add(id)
      localStorage.setItem("moyster-saved", JSON.stringify([...next]))
      return next
    })
  }

  const directions = (venue: Venue) =>
    `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(venue.address)}&travelmode=walking`

  return (
    <section className="finder" id="finder">
      <header className="finder-heading">
        <div>
          <p className="eyebrow">MOYSTER / New Orleans underground index</p>
          <h2>
            OYSTER <em>NEAR</em> YOU.
          </h2>
        </div>
        <p>
          Tourist bait. Local gems.
          <br />
          Same delicious oysters.
        </p>
      </header>

      <div className="finder-controls">
        <label className="finder-search">
          <span>SEARCH /</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="name, neighborhood, oyster…"
            aria-label="Search oyster places"
          />
        </label>
        <div className="finder-filter" aria-label="Filter oyster places">
          {filters.map((item) => (
            <button
              key={item.value}
              className={filter === item.value ? "selected" : ""}
              onClick={() => setMode(item.value)}
            >
              {item.label}
              {item.value === "saved" && saved.size > 0 && (
                <sup>{saved.size}</sup>
              )}
            </button>
          ))}
        </div>
        <div className="finder-view" aria-label="Choose view">
          <button
            className={view === "list" ? "selected" : ""}
            onClick={() => setView("list")}
          >
            LIST
          </button>
          <button
            className={view === "map" ? "selected" : ""}
            onClick={() => setView("map")}
          >
            MAP
          </button>
        </div>
      </div>

      <div className="finder-status">
        <p>
          <strong>{visible.length}</strong> SHUCKING SPOTS
        </p>
        <p>
          {locationMessage ||
            "PRICES CHANGE. CHECK THE RESTAURANT BEFORE YOU WALK."}
        </p>
      </div>

      {view === "map" ? (
        <div className="oyster-map">
          <img
            src="/art/maritime-map.jpg"
            alt="Collage map of New Orleans oyster spots"
          />
          <div className="map-wash" />
          <img className="moyster-animation moyster-animation-map" src={`${animationBase}03_shell_scatter.webp`} alt="" aria-hidden="true" />
          {visible
            .filter(
              (venue) =>
                Number.isFinite(venue.lat) && Number.isFinite(venue.lng),
            )
            .map((venue, index) => (
              <button
                key={venue.id}
                className="map-pin"
                style={pinPosition(venue)}
                onClick={() => setActive(venue)}
                aria-label={`Open ${venue.name}`}
              >
                <span>{index + 1}</span>
                <i>{venue.name}</i>
              </button>
            ))}
          <p className="map-tape">THE CITY IS YOUR OYSTER</p>
          <p className="map-note">
            Pins shown where source coordinates are available.
          </p>
        </div>
      ) : (
        <div className="venue-grid">
          {visible.map((venue, index) => {
            const miles =
              location && venue.lat && venue.lng
                ? distance(location, { lat: venue.lat, lng: venue.lng })
                : null
            return (
              <article
                className="venue-card"
                key={venue.id}
                style={{ "--delay": `${index * 35}ms` } as React.CSSProperties}
              >
                <button className="venue-main" onClick={() => setActive(venue)}>
                  <span className="venue-index">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <div>
                    <p>
                      {venue.area}
                      {miles !== null ? ` / ${miles.toFixed(1)} MI` : ""}
                    </p>
                    <h3>{venue.name}</h3>
                    <strong>
                      {hasSpecial(venue) ? venue.deal : "OYSTERS / À LA CARTE"}
                    </strong>
                    <small>{venue.address}</small>
                  </div>
                  <b aria-hidden="true">↗</b>
                </button>
                <button
                  className={`save-button ${
                    saved.has(venue.id) ? "saved" : ""
                  }`}
                  onClick={() => toggleSaved(venue.id)}
                  aria-label={
                    saved.has(venue.id)
                      ? `Remove ${venue.name} from saved`
                      : `Save ${venue.name}`
                  }
                >
                  {saved.has(venue.id) ? "SAVED" : "SAVE"}
                </button>
              </article>
            )
          })}
          {visible.length === 0 && (
            <div className="finder-empty">
              <img className="moyster-animation moyster-animation-empty" src={`${animationBase}02_shell_flip.webp`} alt="" aria-hidden="true" />
              <strong>NO OYSTERS MATCH.</strong>
              <button
                onClick={() => {
                  setFilter("all")
                  setQuery("")
                }}
              >
                CLEAR THE DECK →
              </button>
            </div>
          )}
        </div>
      )}

      {active && (
        <div
          className="venue-modal"
          role="dialog"
          aria-modal="true"
          aria-label={active.name}
        >
          <button
            className="venue-modal-backdrop"
            onClick={() => setActive(null)}
            aria-label="Close"
          />
          <article>
            <img className="moyster-animation moyster-animation-venue" src={`${animationBase}04_neon_shuck.webp`} alt="" aria-hidden="true" />
            <button className="venue-close" onClick={() => setActive(null)}>
              CLOSE ×
            </button>
            <p className="eyebrow">{active.area} / New Orleans</p>
            <h3>{active.name}</h3>
            <p className="venue-address">{active.address}</p>
            <div className="venue-deal">
              <small>The dirty details</small>
              <strong>
                {hasSpecial(active)
                  ? active.deal
                  : "Oysters on the menu. No posted happy-hour special."}
              </strong>
              <p>
                {hasSpecial(active)
                  ? `${formatTime(active.start)} – ${formatTime(active.end)} / check days before visiting`
                  : "Happy-hour schedule not published."}
              </p>
              <p>{active.note}</p>
            </div>
            <div className="venue-actions">
              <a href={directions(active)} target="_blank" rel="noreferrer">
                GET DIRECTIONS ↗
              </a>
              <a href={active.source} target="_blank" rel="noreferrer">
                MENU / SOURCE ↗
              </a>
              <button onClick={() => toggleSaved(active.id)}>
                {saved.has(active.id) ? "REMOVE SAVED" : "SAVE THIS SPOT"}
              </button>
            </div>
          </article>
        </div>
      )}
    </section>
  )
}
