import { useEffect, useRef, useState } from "react"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import type { Ranked } from "./logic"
import { hasCoords } from "./logic"
import type { Origin } from "./location"

// The oyster-eye: a ruffled half shell holding a human eye. Drawn once, reused for every marker.
export const oysterEyeSvg = (n?: number | string) => `
<svg class="mf-eye" viewBox="0 0 48 44" aria-hidden="true">
  <path class="shell" d="M24 2c7 0 15 3 19 9 4 7 4 14 0 21-4 7-11 10-19 10S9 39 5 32C1 25 1 18 5 11 9 5 17 2 24 2z"/>
  <path class="ruffle" d="M8 13c4-3 7 1 10-2s7 0 10-2 7 1 10 0M6 30c4 3 8-1 11 2s8 0 11 2 7-1 12-3"/>
  <path class="lid" d="M9 22c5-8 25-8 30 0-5 8-25 8-30 0z"/>
  <circle class="iris" cx="24" cy="22" r="6.4"/>
  <circle class="pupil" cx="24" cy="22" r="2.8"/>
  <circle class="glint" cx="26.2" cy="19.8" r="1.2"/>
</svg>${n != null ? `<b>${n}</b>` : ""}`

type Props = {
  items: Ranked[]
  origin: Origin
  selectedId: string | null
  onSelect: (id: string) => void
  expanded: boolean
}

type Cluster = { ids: string[]; lat: number; lng: number }

const CLUSTER_PX = 34

export default function OysterMap({ items, origin, selectedId, onSelect, expanded }: Props) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  const originMarker = useRef<L.Marker | null>(null)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect
  const [tilesFailed, setTilesFailed] = useState(false)
  const [view, setView] = useState(0) // bumps on zoom/move so clusters recompute

  const mapped = items.filter((r) => hasCoords(r.venue))
  const unmappedCount = items.length - mapped.length

  // Create the map once.
  useEffect(() => {
    if (!el.current || map.current) return
    const m = L.map(el.current, { zoomControl: false, attributionControl: true, tap: false } as L.MapOptions)
    m.setView([origin.lat, origin.lng], 15)
    L.control.zoom({ position: "bottomright" }).addTo(m)
    let errors = 0
    let loads = 0
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      maxZoom: 19,
      subdomains: "abcd",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    })
      .on("tileerror", () => {
        // Only complain when tiles are failing across the board, not for one flaky tile.
        if (++errors >= 3 && loads === 0) setTilesFailed(true)
      })
      .on("tileload", () => {
        loads++
        setTilesFailed(false)
      })
      .addTo(m)
    layer.current = L.layerGroup().addTo(m)
    m.on("zoomend moveend", () => setView((v) => v + 1))
    map.current = m
    return () => {
      m.remove()
      map.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Re-measure when the map grows/shrinks (Map mode).
  useEffect(() => {
    const m = map.current
    if (!m) return
    const t = window.setTimeout(() => m.invalidateSize({ pan: false }), 360)
    return () => window.clearTimeout(t)
  }, [expanded])

  // Frame the origin + the three best results whenever the search center changes.
  const mappedKey = mapped.slice(0, 3).map((r) => r.venue.id).join()
  useEffect(() => {
    const m = map.current
    if (!m) return
    const pts: L.LatLngExpression[] = [[origin.lat, origin.lng]]
    mapped.slice(0, 3).forEach((r) => pts.push([r.venue.lat!, r.venue.lng!]))
    if (pts.length > 1) m.fitBounds(L.latLngBounds(pts), { padding: [36, 36], maxZoom: 16 })
    else m.setView([origin.lat, origin.lng], 15)

    originMarker.current?.remove()
    originMarker.current = L.marker([origin.lat, origin.lng], {
      icon: L.divIcon({ className: "mf-you", html: "<i></i><span>YOU</span>", iconSize: [22, 22] }),
      keyboard: false,
      interactive: false,
      zIndexOffset: -100,
    }).addTo(m)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [origin.lat, origin.lng, mappedKey])

  // Bring the selected venue into view (selection from the list).
  useEffect(() => {
    const m = map.current
    const r = mapped.find((x) => x.venue.id === selectedId)
    if (!m || !r) return
    const ll = L.latLng(r.venue.lat!, r.venue.lng!)
    if (!m.getBounds().pad(-0.15).contains(ll)) m.panTo(ll, { animate: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId])

  // Draw markers, merging ones that overlap on screen. The selected venue is never hidden in a cluster.
  useEffect(() => {
    const m = map.current
    const g = layer.current
    if (!m || !g) return
    g.clearLayers()
    const order = new Map(items.map((r, i) => [r.venue.id, i + 1]))
    const clusters: (Cluster & { px: L.Point })[] = []
    for (const r of mapped) {
      const v = r.venue
      const px = m.latLngToContainerPoint([v.lat!, v.lng!])
      const near = v.id === selectedId ? null : clusters.find((c) => !c.ids.includes(selectedId ?? "") && c.px.distanceTo(px) < CLUSTER_PX)
      if (near) near.ids.push(v.id)
      else clusters.push({ ids: [v.id], lat: v.lat!, lng: v.lng!, px })
    }
    for (const c of clusters) {
      if (c.ids.length === 1) {
        const id = c.ids[0]
        const r = mapped.find((x) => x.venue.id === id)!
        const selected = id === selectedId
        const live = r.hh.state === "now"
        const marker = L.marker([c.lat, c.lng], {
          icon: L.divIcon({
            className: `mf-pin${selected ? " is-selected" : ""}${live ? " is-live" : ""}`,
            html: oysterEyeSvg(order.get(id)),
            iconSize: selected ? [52, 48] : [36, 33],
            iconAnchor: selected ? [26, 44] : [18, 30],
          }),
          title: r.venue.name,
          alt: r.venue.name,
          riseOnHover: true,
          zIndexOffset: selected ? 1000 : live ? 200 : 0,
        })
        marker.on("click", () => onSelectRef.current(id))
        marker.addTo(g)
      } else {
        const names = c.ids.map((id) => mapped.find((x) => x.venue.id === id)!.venue.name)
        const marker = L.marker([c.lat, c.lng], {
          icon: L.divIcon({ className: "mf-pin mf-cluster", html: oysterEyeSvg(`×${c.ids.length}`), iconSize: [44, 40], iconAnchor: [22, 36] }),
          title: names.join(", "),
          alt: `${c.ids.length} spots: ${names.join(", ")}`,
        })
        marker.on("click", () => {
          const pts = c.ids.map((id) => {
            const v = mapped.find((x) => x.venue.id === id)!.venue
            return L.latLng(v.lat!, v.lng!)
          })
          m.fitBounds(L.latLngBounds(pts), { padding: [60, 60], maxZoom: 19 })
        })
        marker.addTo(g)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, selectedId, view])

  return (
    <div className={`mf-map${expanded ? " is-expanded" : ""}`}>
      <div ref={el} className="mf-map-canvas" role="region" aria-label="Map of oyster spots" />
      <div className="mf-map-riso" aria-hidden="true" />
      {tilesFailed && <p className="mf-map-note">Street map didn't load. Oyster markers are still placed correctly.</p>}
      {unmappedCount > 0 && (
        <p className="mf-map-count">
          {mapped.length} on map · {unmappedCount} awaiting coordinates
        </p>
      )}
    </div>
  )
}
