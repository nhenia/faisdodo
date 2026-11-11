// Chalkboard bounty — the rules. Pure functions only (no internet, no files), so they're easy to test.
// scripts/chalkboard.mjs does the fetching and writing; scripts/chalkboard.test.mjs tests this file.

export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

// The shape Claude must fill in when it reads a board (sent as a "tool" so the answer is always JSON).
export const EXTRACTION_TOOL = {
  name: "record_specials",
  description: "Record exactly what this photo of a bar's specials board or menu says. Never guess.",
  input_schema: {
    type: "object",
    required: ["is_specials_board", "items", "windows", "confidence"],
    properties: {
      is_specials_board: {
        type: "boolean",
        description: "True only if the photo shows a bar or restaurant's happy hour / specials board or menu.",
      },
      venue_name_on_board: { type: ["string", "null"], description: "The bar's name if it's written in the photo." },
      items: {
        type: "array",
        description: "Every special, in board order.",
        items: {
          type: "object",
          required: ["what", "price", "price_text"],
          properties: {
            what: { type: "string", description: 'The item as written, tidied: "Gulf oysters", "house margarita".' },
            price: { type: ["number", "null"], description: "Dollars as a number (1.5 for $1.50, 0.75 for 75¢). null for half-off, BOGO or unreadable." },
            unit: {
              type: "string",
              enum: ["each", "half-dozen", "dozen", "drink", "plate", "percent-off", "other"],
              description: "What the price buys. Use percent-off for 'half off', '50% off', '$2 off'.",
            },
            price_text: { type: "string", description: 'The price exactly as written: "$1.50", "1/2 off", "2 for $10".' },
          },
        },
      },
      windows: {
        type: "array",
        description: "When the specials run. One entry per distinct time window.",
        items: {
          type: "object",
          required: ["days", "start", "end"],
          properties: {
            days: { type: "array", items: { type: "integer", minimum: 0, maximum: 6 }, description: "0=Sunday … 6=Saturday" },
            start: { type: ["string", "null"], description: '24-hour "HH:MM", e.g. "15:00". null if not written.' },
            end: { type: ["string", "null"], description: '24-hour "HH:MM". Use the word "close" if it says til close. null if not written.' },
            label: { type: ["string", "null"], description: 'e.g. "Happy hour", "Late night", "Reverse happy hour"' },
          },
        },
      },
      one_day_only: { type: "boolean", description: 'True if these are "tonight only" / dated specials, not a recurring happy hour.' },
      confidence: { type: "string", enum: ["high", "medium", "low"], description: "How sure you are that every price and time is read correctly." },
      unreadable: { type: "array", items: { type: "string" }, description: "Anything you could not read for sure." },
    },
  },
}

export function extractionPrompt(venue, today) {
  const current = venue
    ? `This photo was sent for ${venue.name} (${venue.address}). What we currently list: "${venue.deal}", days ${venue.days.join(",")}, ${venue.start}–${venue.end}.`
    : "We don't know which bar sent this photo yet."
  return [
    "A bartender in New Orleans texted this photo of their specials board or menu.",
    current,
    `Today is ${today.label} in New Orleans.`,
    "Read the board and call record_specials. Rules:",
    "- Only record what is actually written or printed. Never fill gaps from what we currently list.",
    "- Convert times to 24-hour HH:MM (3-6pm → 15:00 and 18:00). 'Daily' or 'every day' means all 7 days.",
    "- Weekday words: M-F = 1,2,3,4,5. If no days are written but it says happy hour, assume every day and lower confidence to medium.",
    "- If something is smudged, cut off or ambiguous, put it in `unreadable` and lower confidence.",
    "- If the photo isn't a specials board or menu, set is_specials_board to false and leave the lists empty.",
  ].join("\n")
}

// --- Which bar is this? -----------------------------------------------------------------------
const norm = (s) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, " ").replace(/\b(the|bar|restaurant|oyster|and|&)\b/g, " ").replace(/\s+/g, " ").trim()

/** Find a venue by name mentioned in free text ("Luke", "this is from Bourbon House"). */
export function venueFromText(text, venues) {
  if (!text) return null
  const t = ` ${norm(text)} `
  const hits = venues.filter((v) => {
    const n = norm(v.name)
    return (n && t.includes(` ${n} `)) || t.includes(` ${norm(v.id.replace(/-/g, " "))} `)
  })
  return hits.length === 1 ? hits[0] : null // two matches = ambiguous = ask a human
}

/** roster: {"+15045551234": "luke"} — kept in the BARTENDER_ROSTER secret, never in the repo. */
export function identifyVenue({ from, body, roster, venues }) {
  const rostered = roster?.[from]
  if (rostered) {
    const venue = venues.find((v) => v.id === rostered)
    if (venue) return { venue, trusted: true, how: "registered number" }
  }
  const named = venueFromText(body, venues)
  return named ? { venue: named, trusted: false, how: "named in the text" } : { venue: null, trusted: false, how: "unknown" }
}

// --- Is the reading safe to publish? ------------------------------------------------------------
const minutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))

/** Returns { problems: [...] }. Any problem means a human reviews it instead of auto-publishing. */
export function checkExtraction(x, venue) {
  const problems = []
  if (!x?.is_specials_board) return { fatal: "That doesn't look like a specials board or menu.", problems }
  if (x.one_day_only) problems.push('It looks like a one-day special ("tonight only"); the map only shows recurring happy hours.')
  if (!x.items?.length) return { fatal: "I couldn't read any specials on that board.", problems }
  if (!x.windows?.length) problems.push("No days or times are written on the board.")

  for (const w of x.windows ?? []) {
    if (!w.days?.length || w.days.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) problems.push("The days don't make sense.")
    if (w.end === "close") problems.push(`"Til close" needs a real closing time (${w.label ?? "window"}).`)
    else if (!HHMM.test(w.start ?? "") || !HHMM.test(w.end ?? "")) problems.push(`Missing or unreadable times (${w.label ?? "window"}).`)
    else {
      const length = minutes(w.end) - minutes(w.start)
      if (length <= 0) problems.push(`The window runs past midnight (${w.start}–${w.end}); check it by hand.`)
      else if (length < 30 || length > 12 * 60) problems.push(`A ${Math.round(length / 60)}-hour happy hour seems wrong (${w.start}–${w.end}).`)
    }
  }
  for (const item of x.items) {
    if (item.price != null && !(item.price > 0 && item.price < 100)) problems.push(`Odd price for ${item.what}: ${item.price_text}.`)
  }
  if (x.confidence !== "high") problems.push(`Reading confidence is ${x.confidence}.`)
  if (x.unreadable?.length) problems.push(`Couldn't read: ${x.unreadable.join("; ")}.`)
  if (venue && x.venue_name_on_board) {
    const [onBoard, listed] = [norm(x.venue_name_on_board), norm(venue.name)]
    if (onBoard && listed && !onBoard.includes(listed) && !listed.includes(onBoard))
      problems.push(`The board says "${x.venue_name_on_board}" but this was sent for ${venue.name}.`)
  }
  return { problems: [...new Set(problems)] }
}

// --- Board → bar list entry ---------------------------------------------------------------------
const money = (n) => (n < 1 ? `${Math.round(n * 100)}¢` : `$${Number.isInteger(n) ? n : n.toFixed(2)}`)
export const clock = (hhmm) => {
  const h = Number(hhmm.slice(0, 2))
  const m = hhmm.slice(3)
  return `${h % 12 || 12}${m === "00" ? "" : `:${m}`}${h < 12 ? "am" : "pm"}`
}
export function dayRange(days) {
  const d = [...new Set(days)].sort((a, b) => a - b)
  if (d.length === 7) return "daily"
  const key = d.join(",")
  if (key === "1,2,3,4,5") return "Mon–Fri"
  if (key === "0,6") return "weekends"
  const contiguous = d.every((v, i) => i === 0 || v === d[i - 1] + 1)
  return contiguous && d.length > 2 ? `${DAY_NAMES[d[0]]}–${DAY_NAMES[d.at(-1)]}` : d.map((x) => DAY_NAMES[x]).join(", ")
}
const UNIT_MAP = { each: "each", "half-dozen": "half-dozen", dozen: "dozen" }

/**
 * Builds the updated entry. Fields the app reads today (deal, price, unit, days, start, end, note)
 * are filled from the board; the full board is kept in `items`/`windows` for the reskin.
 */
export function applyBoard(venue, x, { date, boardUrl }) {
  const [main, ...extra] = x.windows
  const priced = x.items.filter((i) => i.price != null && i.unit !== "percent-off")
  const oysters = priced.filter((i) => UNIT_MAP[i.unit] && /oyster/i.test(i.what))
  const headline = (oysters.length ? oysters : priced).sort((a, b) => a.price - b.price)[0]
  const deal = x.items.map((i) => `${i.price_text} ${i.what}`.trim()).join("; ")
  const extraWindows = extra.filter((w) => HHMM.test(w.start ?? "") && HHMM.test(w.end ?? ""))
  const note = extraWindows.map((w) => `${w.label ?? "Also"}: ${dayRange(w.days)} ${clock(w.start)}–${clock(w.end)}`).join(" · ")
  return {
    ...venue,
    deal,
    price: headline ? headline.price : null,
    unit: headline ? (UNIT_MAP[headline.unit] ?? "plate") : "variable",
    days: [...new Set(main.days)].sort((a, b) => a - b),
    start: main.start,
    end: main.end,
    note: note || venue.note,
    verified: date,
    board: boardUrl,
    items: x.items.map(({ what, price, unit, price_text }) => ({ what, price, unit, price_text })),
    windows: x.windows.map(({ days, start, end, label }) => ({ days, start, end, label: label ?? null })),
  }
}

/** Plain-words list of what changed, for the PR, the commit and the text-message reply. */
export function describeChange(before, after) {
  const hours = (v) => (v.start && v.end ? `${dayRange(v.days)} ${clock(v.start)}–${clock(v.end)}` : "no hours")
  const price = (v) => (v.price == null ? "no price" : `${money(v.price)}${v.unit === "each" ? " ea" : v.unit === "plate" ? "" : ` / ${v.unit}`}`)
  const lines = []
  if (before.deal !== after.deal) lines.push(`Specials: "${before.deal}" → "${after.deal}"`)
  if (price(before) !== price(after)) lines.push(`Headline price: ${price(before)} → ${price(after)}`)
  if (hours(before) !== hours(after)) lines.push(`Hours: ${hours(before)} → ${hours(after)}`)
  if ((before.note ?? "") !== (after.note ?? "")) lines.push(`Note: "${before.note ?? ""}" → "${after.note ?? ""}"`)
  return { lines, summary: `${after.deal.slice(0, 80)}${after.deal.length > 80 ? "…" : ""}, ${hours(after)}` }
}

// --- Text-message replies (kept under ~300 characters) ----------------------------------------------
export const REPLIES = {
  help: "Fais DoDo: text a photo of your happy hour board or menu. First time? Add your bar's name with the photo. Reply STOP to opt out.",
  noPhoto: "Got your text! To update your happy hour, send a photo of your specials board or menu (add the bar's name if it's your first time).",
  unknownBar: "Thanks! I couldn't tell which bar this is. Text the photo again with your bar's name, e.g. \"Luke\".",
  published: (venue, summary) => `${venue.name} is updated on Fais DoDo: ${summary}. Live in a couple of minutes. Thank you!`,
  unchanged: (venue) => `Thanks! ${venue.name}'s specials match what we have, so I've marked them as freshly checked.`,
  review: (venue) => `Got it! A human will double-check ${venue.name}'s new specials and publish them shortly. Thank you!`,
  rejected: (reason) => `${reason} Try a straight-on photo of the whole board in good light.`,
  failed: "Sorry, something went wrong reading your photo. A human will take a look.",
}
