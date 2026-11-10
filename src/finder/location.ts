// Where is the user? Device location first, typed address as the fallback.
import type { Coordinates } from "./logic"
import { DEFAULT_ORIGIN } from "./logic"

export type Origin = Coordinates & { label: string; source: "device" | "address" | "default" }

const SESSION_KEY = "faisdodo-origin"

export const defaultOrigin = (): Origin => ({ ...DEFAULT_ORIGIN, source: "default" })

export function loadOrigin(): Origin | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "null")
    if (saved && Number.isFinite(saved.lat) && Number.isFinite(saved.lng)) return saved
  } catch {
    /* storage blocked or corrupt: start fresh */
  }
  return null
}

export function saveOrigin(origin: Origin) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(origin))
  } catch {
    /* private mode: remembering is a nicety, not a requirement */
  }
}

export type LocateError = "unsupported" | "denied" | "unavailable" | "timeout"

export function locate(): Promise<Origin> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject("unsupported" satisfies LocateError)
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ lat: coords.latitude, lng: coords.longitude, label: "You are here", source: "device" }),
      (error) =>
        reject(
          (error.code === error.PERMISSION_DENIED
            ? "denied"
            : error.code === error.TIMEOUT
              ? "timeout"
              : "unavailable") satisfies LocateError,
        ),
      // Coarse and cached is fine for "what's walkable": fast beats precise.
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 },
    )
  })
}

export const locateMessage: Record<LocateError, string> = {
  unsupported: "This browser can't share location. Type an address instead.",
  denied: "Location is off. Type an address or a landmark instead.",
  unavailable: "Couldn't get a fix on you. Type an address instead.",
  timeout: "Location took too long. Type an address instead.",
}

export type Place = Origin & { detail: string }

/**
 * Address autocomplete via Photon (OpenStreetMap data, built for search-as-you-type, no key).
 * Results are biased toward New Orleans but any address works.
 */
export async function searchPlaces(query: string, signal?: AbortSignal): Promise<Place[]> {
  const q = query.trim()
  if (q.length < 3) return []
  const url = `https://photon.komoot.io/api/?limit=5&lang=en&lat=${DEFAULT_ORIGIN.lat}&lon=${DEFAULT_ORIGIN.lng}&q=${encodeURIComponent(q)}`
  const res = await fetch(url, { signal })
  if (!res.ok) throw new Error(`Address search failed (${res.status})`)
  const json = (await res.json()) as {
    features: { geometry: { coordinates: [number, number] }; properties: Record<string, string | undefined> }[]
  }
  return json.features.map(({ geometry, properties: p }) => {
    const street = [p.housenumber, p.street].filter(Boolean).join(" ")
    const label = p.name || street || p.city || "Selected place"
    const detail = [p.name && street ? street : null, p.district, p.city, p.state].filter(Boolean).join(", ")
    return { lat: geometry.coordinates[1], lng: geometry.coordinates[0], label, detail, source: "address" as const }
  })
}
