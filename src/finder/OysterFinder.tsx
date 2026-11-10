import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import deals from "../deals.json"
import OysterMap, { oysterEyeSvg } from "./OysterMap"
import {
  type Mode,
  type Ranked,
  type Venue,
  STALE_AFTER_DAYS,
  daysSince,
  enrich,
  formatHappyHour,
  formatMoney,
  formatPrice,
  formatWalk,
  nolaClock,
  rank,
  walkingDirections,
} from "./logic"
import {
  type LocateError,
  type Origin,
  type Place,
  defaultOrigin,
  loadOrigin,
  locate,
  locateMessage,
  saveOrigin,
  searchPlaces,
} from "./location"
import "./finder.css"

const venues = deals.venues as Venue[]
const UPDATED = deals.updated
const animationBase = `${import.meta.env.BASE_URL}art/animations/`

const MODES: { value: Mode; label: string; hint: string }[] = [
  { value: "near", label: "Near me", hint: "Closest first" },
  { value: "happy", label: "Happy hour", hint: "Now & next" },
  { value: "cheap", label: "Cheapest", hint: "Per oyster" },
  { value: "map", label: "Map", hint: "Wander" },
]

const SAVED_KEY = "faisdodo-saved" // own key: Moyster shares this github.io address

function readSaved(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(SAVED_KEY) ?? "[]") as string[])
  } catch {
    return new Set()
  }
}

/** Re-render every minute so "happy hour now" flips on and off without a reload. */
function useMinuteClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000)
    const wake = () => document.visibilityState === "visible" && setNow(new Date())
    document.addEventListener("visibilitychange", wake)
    return () => {
      window.clearInterval(id)
      document.removeEventListener("visibilitychange", wake)
    }
  }, [])
  return now
}

const hhTone = (r: Ranked) => r.hh.state

function priceLine(r: Ranked) {
  const headline = formatPrice(r.venue)
  if (!headline) return { headline: "Market price", sub: "Not posted — check the menu" }
  const per = r.perOyster != null && r.venue.unit !== "each" ? `≈ ${formatMoney(r.perOyster)} each` : null
  const when = r.venue.start ? "happy hour price" : null
  return { headline, sub: [per, when].filter(Boolean).join(" · ") }
}

export default function OysterFinder() {
  const now = useMinuteClock()
  const [origin, setOrigin] = useState<Origin>(() => loadOrigin() ?? defaultOrigin())
  const [locating, setLocating] = useState(false)
  const [locateError, setLocateError] = useState<LocateError | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [mode, setMode] = useState<Mode>("near")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Ranked | null>(null)
  const [saved, setSaved] = useState<Set<string>>(readSaved)
  const [toast, setToast] = useState("")
  const rowRefs = useRef(new Map<string, HTMLElement>())

  const askForLocation = useCallback(async () => {
    setLocating(true)
    setLocateError(null)
    try {
      const here = await locate()
      setOrigin(here)
      saveOrigin(here)
      setSearchOpen(false)
    } catch (error) {
      setLocateError(error as LocateError)
      setSearchOpen(true)
    } finally {
      setLocating(false)
    }
  }, [])

  // Ask right away on first visit; results are already on screen from the French Quarter meanwhile.
  useEffect(() => {
    if (origin.source === "default") void askForLocation()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const chooseOrigin = (place: Origin) => {
    setOrigin(place)
    saveOrigin(place)
    setSearchOpen(false)
    setLocateError(null)
    setSelectedId(null)
  }

  const clock = useMemo(() => nolaClock(now), [now])
  const enriched = useMemo(() => enrich(venues, origin, clock), [origin, clock])
  const ranked = useMemo(() => rank(enriched, mode), [enriched, mode])
  const nearOrder = useMemo(() => rank(enriched, "near"), [enriched])

  const live = enriched.filter((r) => r.hh.state === "now")
  const nextUp = rank(enriched, "happy").find((r) => r.hh.state === "later")

  const picks = mode === "map" ? [] : ranked.slice(0, 3)
  const rest = mode === "map" ? ranked : ranked.slice(3)
  const mapItems = mode === "near" || mode === "map" ? nearOrder : ranked

  const age = daysSince(UPDATED, now)
  const stale = age > STALE_AFTER_DAYS

  const select = (id: string, from: "map" | "list") => {
    setSelectedId(id)
    if (from === "map") rowRefs.current.get(id)?.scrollIntoView({ behavior: "smooth", block: "nearest" })
  }

  const toggleSaved = (id: string) =>
    setSaved((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      try {
        localStorage.setItem(SAVED_KEY, JSON.stringify([...next]))
      } catch {
        /* storage blocked: keep it for this visit */
      }
      return next
    })

  const share = async (r: Ranked) => {
    const v = r.venue
    const bits = [v.name, v.address, r.venue.start ? `${v.deal} (${formatHappyHour(r.hh)})` : null].filter(Boolean)
    const payload = { title: `${v.name} — Moyster`, text: bits.join("\n"), url: walkingDirections(v) }
    try {
      if (navigator.share) {
        await navigator.share(payload)
        return
      }
      await navigator.clipboard.writeText(`${payload.text}\n${payload.url}`)
      flash("Copied — paste it anywhere")
    } catch (error) {
      if ((error as DOMException)?.name !== "AbortError") flash("Couldn't share from this browser")
    }
  }

  const flash = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(""), 2400)
  }

  useEffect(() => {
    if (!detail) return
    const close = (e: KeyboardEvent) => e.key === "Escape" && setDetail(null)
    window.addEventListener("keydown", close)
    return () => window.removeEventListener("keydown", close)
  }, [detail])

  return (
    <section className="mf" id="finder" aria-labelledby="mf-title">
      <div className="mf-grain" aria-hidden="true" />

      <header className="mf-head">
        <p className="mf-kicker">MOYSTER · New Orleans oyster index</p>
        <h2 id="mf-title" className="mf-title">
          <span className="mf-title-a">OYSTERS</span>
          <span className="mf-title-b" aria-hidden="true">
            <span dangerouslySetInnerHTML={{ __html: oysterEyeSvg() }} />
          </span>
          <span className="mf-title-c">NEAR ME</span>
        </h2>
        <img className="mf-head-art" src={`${animationBase}01_oyster_pulse.webp`} alt="" aria-hidden="true" />

        <div className="mf-origin" aria-live="polite">
          <span className="mf-origin-label">From</span>
          <strong>
            {locating ? "Finding you…" : origin.source === "default" ? `${origin.label} (until we find you)` : origin.label}
          </strong>
          {origin.source !== "device" && !locating && (
            <button type="button" onClick={askForLocation}>
              Use my location
            </button>
          )}
          <button type="button" onClick={() => setSearchOpen((o) => !o)} aria-expanded={searchOpen}>
            {searchOpen ? "Close" : "Type an address"}
          </button>
        </div>
        {locateError && <p className="mf-alert">{locateMessage[locateError]}</p>}
        {searchOpen && <AddressSearch onPick={chooseOrigin} />}
      </header>

      <button
        type="button"
        className={`mf-hh${live.length ? " is-live" : ""}${mode === "happy" ? " is-active" : ""}`}
        onClick={() => setMode("happy")}
      >
        {live.length ? (
          <>
            <b>HAPPY HOUR NOW</b>
            <span>
              {live.length} {live.length === 1 ? "spot" : "spots"} pouring cheap oysters
            </span>
          </>
        ) : nextUp && nextUp.hh.state === "later" ? (
          <>
            <b>NEXT HAPPY HOUR</b>
            <span>
              {nextUp.venue.name} · {formatHappyHour(nextUp.hh).replace("Happy hour ", "")}
            </span>
          </>
        ) : (
          <>
            <b>HAPPY HOURS</b>
            <span>None left today — see what's on next</span>
          </>
        )}
        <i aria-hidden="true">→</i>
      </button>

      <div className="mf-modes" role="tablist" aria-label="Sort oyster spots">
        {MODES.map((m) => (
          <button
            key={m.value}
            type="button"
            role="tab"
            aria-selected={mode === m.value}
            className={`mf-mode mf-mode-${m.value}`}
            onClick={() => {
              setMode(m.value)
              setSelectedId(null)
            }}
          >
            <b>{m.label}</b>
            <small>{m.hint}</small>
          </button>
        ))}
      </div>

      {picks.length > 0 && (
        <ol className="mf-picks" aria-label="Top three picks">
          {picks.map((r, i) => (
            <PickCard
              key={`${mode}-${r.venue.id}`}
              r={r}
              index={i}
              selected={selectedId === r.venue.id}
              saved={saved.has(r.venue.id)}
              registerRef={(node) => (node ? rowRefs.current.set(r.venue.id, node) : rowRefs.current.delete(r.venue.id))}
              onSelect={() => select(r.venue.id, "list")}
              onMore={() => setDetail(r)}
              onShare={() => share(r)}
              onSave={() => toggleSaved(r.venue.id)}
            />
          ))}
        </ol>
      )}

      {ranked.length === 0 && (
        <div className="mf-empty">
          <strong>Nothing posted for this right now.</strong>
          <button type="button" onClick={() => setMode("near")}>
            Show everything nearby →
          </button>
        </div>
      )}

      <OysterMap
        items={mapItems}
        origin={origin}
        selectedId={selectedId}
        onSelect={(id) => select(id, "map")}
        expanded={mode === "map"}
      />

      {rest.length > 0 && (
        <ol className="mf-list" start={picks.length + 1} aria-label={picks.length ? "More spots" : "All spots"}>
          {rest.map((r, i) => (
            <Row
              key={r.venue.id}
              r={r}
              n={picks.length + i + 1}
              selected={selectedId === r.venue.id}
              saved={saved.has(r.venue.id)}
              registerRef={(node) => (node ? rowRefs.current.set(r.venue.id, node) : rowRefs.current.delete(r.venue.id))}
              onSelect={() => select(r.venue.id, "list")}
              onMore={() => setDetail(r)}
            />
          ))}
        </ol>
      )}

      <p className={`mf-fresh${stale ? " is-stale" : ""}`}>
        {stale
          ? `Prices & happy hours were last checked ${age} days ago and may have changed. Confirm before you go.`
          : `Prices & happy hours checked by a person on ${new Date(`${UPDATED}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}. Specials change — confirm before you go.`}
        {saved.size > 0 && ` · ${saved.size} saved`}
      </p>

      {detail && (
        <Detail
          r={enriched.find((x) => x.venue.id === detail.venue.id) ?? detail}
          saved={saved.has(detail.venue.id)}
          stale={stale}
          onClose={() => setDetail(null)}
          onShare={() => share(detail)}
          onSave={() => toggleSaved(detail.venue.id)}
        />
      )}

      <p className="mf-toast" role="status" aria-live="polite" data-show={toast ? "true" : "false"}>
        {toast}
      </p>
    </section>
  )
}

// ---------- Pieces ----------

function AddressSearch({ onPick }: { onPick: (p: Place) => void }) {
  const [q, setQ] = useState("")
  const [results, setResults] = useState<Place[]>([])
  const [state, setState] = useState<"idle" | "loading" | "error" | "empty">("idle")
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => input.current?.focus(), [])

  useEffect(() => {
    if (q.trim().length < 3) {
      setResults([])
      setState("idle")
      return
    }
    const ctrl = new AbortController()
    const t = window.setTimeout(async () => {
      setState("loading")
      try {
        const found = await searchPlaces(q, ctrl.signal)
        setResults(found)
        setState(found.length ? "idle" : "empty")
      } catch (error) {
        if ((error as DOMException).name !== "AbortError") setState("error")
      }
    }, 280)
    return () => {
      ctrl.abort()
      window.clearTimeout(t)
    }
  }, [q])

  return (
    <form
      className="mf-search"
      role="search"
      onSubmit={(e) => {
        e.preventDefault()
        if (results[0]) onPick(results[0])
      }}
    >
      <label htmlFor="mf-address">Address, hotel or landmark</label>
      <input
        id="mf-address"
        ref={input}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="e.g. Jackson Square, 700 Canal St…"
        autoComplete="street-address"
        enterKeyHint="search"
        aria-autocomplete="list"
        aria-controls="mf-address-results"
      />
      <ul id="mf-address-results" className="mf-search-results">
        {results.map((p, i) => (
          <li key={`${p.lat},${p.lng},${i}`}>
            <button type="button" onClick={() => onPick(p)}>
              <b>{p.label}</b>
              <small>{p.detail}</small>
            </button>
          </li>
        ))}
      </ul>
      {state === "loading" && <p className="mf-search-state">Searching…</p>}
      {state === "empty" && <p className="mf-search-state">No match. Try a street name or landmark.</p>}
      {state === "error" && <p className="mf-search-state">Address search is down. Check your connection and try again.</p>}
    </form>
  )
}

type CardProps = {
  r: Ranked
  selected: boolean
  saved: boolean
  registerRef: (node: HTMLElement | null) => void
  onSelect: () => void
  onMore: () => void
}

function HHChip({ r }: { r: Ranked }) {
  return <span className={`mf-chip mf-chip-${hhTone(r)}`}>{formatHappyHour(r.hh)}</span>
}

function PickCard({ r, index, onShare, onSave, ...p }: CardProps & { index: number; onShare: () => void; onSave: () => void }) {
  const v = r.venue
  const price = priceLine(r)
  const walk = formatWalk(r)
  return (
    <li
      ref={p.registerRef}
      className={`mf-pick mf-pick-${index + 1}${p.selected ? " is-selected" : ""}`}
      style={{ "--tilt": `${[-1.6, 1.1, -0.6][index]}deg`, "--drop": `${index * 90}ms` } as React.CSSProperties}
    >
      <button type="button" className="mf-pick-main" onClick={p.onSelect} aria-pressed={p.selected}>
        <span className="mf-pick-n">{index + 1}</span>
        <span className="mf-pick-area">{v.area}</span>
        <span className="mf-pick-name">{v.name}</span>
        <span className="mf-pick-meta">
          <span className="mf-walk">{walk ?? "Distance unknown"}</span>
          <span className="mf-price">
            <b>{price.headline}</b>
            {price.sub && <small>{price.sub}</small>}
          </span>
        </span>
        <HHChip r={r} />
        {v.start && <span className="mf-deal">{v.deal}</span>}
      </button>
      <div className="mf-actions">
        <a className="mf-go" href={walkingDirections(v)} target="_blank" rel="noreferrer">
          Walk there ↗
        </a>
        <button type="button" onClick={onShare} aria-label={`Share ${v.name}`}>
          Share
        </button>
        <button type="button" onClick={onSave} aria-pressed={p.saved} aria-label={p.saved ? `Unsave ${v.name}` : `Save ${v.name}`}>
          {p.saved ? "★" : "☆"}
        </button>
        <button type="button" onClick={p.onMore} aria-label={`Details for ${v.name}`}>
          ⋯
        </button>
      </div>
    </li>
  )
}

function Row({ r, n, ...p }: CardProps & { n: number }) {
  const v = r.venue
  const price = formatPrice(v)
  const walk = formatWalk(r)
  return (
    <li ref={p.registerRef} className={`mf-row${p.selected ? " is-selected" : ""}`}>
      <button type="button" className="mf-row-main" onClick={p.onSelect} aria-pressed={p.selected}>
        <span className="mf-row-n">{String(n).padStart(2, "0")}</span>
        <span className="mf-row-name">
          {v.name}
          {p.saved && <i aria-label="saved"> ★</i>}
        </span>
        <span className="mf-row-meta">
          {[walk ?? v.area, price ?? "Market price"].join(" · ")}
        </span>
        <HHChip r={r} />
      </button>
      <a className="mf-row-go" href={walkingDirections(v)} target="_blank" rel="noreferrer" aria-label={`Walking directions to ${v.name}`}>
        ↗
      </a>
      <button type="button" className="mf-row-more" onClick={p.onMore} aria-label={`Details for ${v.name}`}>
        ⋯
      </button>
    </li>
  )
}

function Detail({
  r,
  saved,
  stale,
  onClose,
  onShare,
  onSave,
}: {
  r: Ranked
  saved: boolean
  stale: boolean
  onClose: () => void
  onShare: () => void
  onSave: () => void
}) {
  const v = r.venue
  const price = priceLine(r)
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => closeRef.current?.focus(), [])
  return (
    <div className="mf-sheet" role="dialog" aria-modal="true" aria-label={v.name}>
      <button type="button" className="mf-sheet-backdrop" onClick={onClose} aria-label="Close" tabIndex={-1} />
      <article>
        <button ref={closeRef} type="button" className="mf-sheet-close" onClick={onClose}>
          Close ×
        </button>
        <p className="mf-kicker">{v.area} · New Orleans</p>
        <h2>{v.name}</h2>
        <p className="mf-sheet-addr">{v.address}</p>
        <dl>
          <div>
            <dt>Walk</dt>
            <dd>{formatWalk(r) ?? "Not mapped yet — use directions"}</dd>
          </div>
          <div>
            <dt>Price</dt>
            <dd>
              {price.headline}
              {price.sub && <small> {price.sub}</small>}
            </dd>
          </div>
          <div>
            <dt>Special</dt>
            <dd>{v.start ? v.deal : "No posted happy-hour special"}</dd>
          </div>
          <div>
            <dt>When</dt>
            <dd>
              <HHChip r={r} />
            </dd>
          </div>
          {v.note && (
            <div>
              <dt>Note</dt>
              <dd>{v.note}</dd>
            </div>
          )}
        </dl>
        {stale && <p className="mf-alert">This info is over {STALE_AFTER_DAYS} days old. Call ahead.</p>}
        <div className="mf-actions">
          <a className="mf-go" href={walkingDirections(v)} target="_blank" rel="noreferrer">
            Walk there ↗
          </a>
          <a href={v.source} target="_blank" rel="noreferrer">
            Menu / source ↗
          </a>
          <button type="button" onClick={onShare}>
            Share
          </button>
          <button type="button" onClick={onSave} aria-pressed={saved}>
            {saved ? "★ Saved" : "☆ Save"}
          </button>
        </div>
      </article>
    </div>
  )
}
