import test from "node:test"
import assert from "node:assert/strict"
import { identifyVenue, venueFromText, checkExtraction, applyBoard, describeChange, dayRange, clock } from "./chalkboard-lib.mjs"

const luke = {
  id: "luke", name: "Luke", area: "CBD", address: "333 St Charles Ave", kind: ["raw"], price: 1.5, unit: "each",
  deal: "$1.50 Gulf oysters", days: [0, 1, 2, 3, 4, 5, 6], start: "15:00", end: "18:00", note: "", source: "https://x.test",
}
const bourbon = { ...luke, id: "bourbon-house", name: "Bourbon House" }
const felix = { ...luke, id: "felix", name: "Felix's Restaurant & Oyster Bar" }
const venues = [luke, bourbon, felix]

const board = (over = {}) => ({
  is_specials_board: true,
  venue_name_on_board: "Luke",
  items: [
    { what: "Gulf oysters", price: 2, unit: "each", price_text: "$2" },
    { what: "house wine", price: 6, unit: "drink", price_text: "$6" },
    { what: "draft beer", price: null, unit: "percent-off", price_text: "1/2 off" },
  ],
  windows: [{ days: [1, 2, 3, 4, 5], start: "16:00", end: "18:00", label: "Happy hour" }],
  confidence: "high",
  unreadable: [],
  ...over,
})

test("finds the bar: registered number first, then the name in the text", () => {
  assert.deepEqual(identifyVenue({ from: "+15045550000", body: "", roster: { "+15045550000": "luke" }, venues }).venue.id, "luke")
  assert.equal(identifyVenue({ from: "+15045550000", body: "", roster: { "+15045550000": "luke" }, venues }).trusted, true)
  const named = identifyVenue({ from: "+1999", body: "hey this is bourbon house!", roster: {}, venues })
  assert.equal(named.venue.id, "bourbon-house")
  assert.equal(named.trusted, false, "a name in a text is never trusted on its own")
  assert.equal(venueFromText("Felix's", venues).id, "felix")
  assert.equal(venueFromText("new specials", venues), null)
  assert.equal(identifyVenue({ from: "+1999", body: "", roster: {}, venues }).venue, null)
})

test("a clean board passes every check", () => {
  assert.deepEqual(checkExtraction(board(), luke), { problems: [] })
})

test("anything doubtful goes to a human", () => {
  const p = (over) => checkExtraction(board(over), luke).problems.join(" | ")
  assert.match(p({ confidence: "medium" }), /confidence is medium/)
  assert.match(p({ unreadable: ["price of wine"] }), /Couldn't read/)
  assert.match(p({ windows: [{ days: [1], start: "22:00", end: "close" }] }), /closing time/)
  assert.match(p({ windows: [{ days: [1], start: "22:00", end: "02:00" }] }), /past midnight/)
  assert.match(p({ windows: [{ days: [1], start: "09:00", end: "23:30" }] }), /seems wrong/)
  assert.match(p({ windows: [] }), /No days or times/)
  assert.match(p({ one_day_only: true }), /one-day special/)
  assert.match(p({ items: [{ what: "oysters", price: 150, unit: "each", price_text: "$150" }] }), /Odd price/)
  assert.match(p({ venue_name_on_board: "Bourbon House" }), /says "Bourbon House"/)
  assert.equal(p({ venue_name_on_board: "LUKE" }), "", "same bar, different capitals is fine")
})

test("not a menu, or nothing readable, is rejected outright", () => {
  assert.ok(checkExtraction({ is_specials_board: false, items: [], windows: [] }, luke).fatal)
  assert.ok(checkExtraction(board({ items: [] }), luke).fatal)
})

test("board becomes a valid bar entry", () => {
  const after = applyBoard(luke, board(), { date: "2026-11-10", boardUrl: "boards/luke/2026-11-10.jpg" })
  assert.equal(after.price, 2, "headline price is the cheapest oyster item")
  assert.equal(after.unit, "each")
  assert.deepEqual(after.days, [1, 2, 3, 4, 5])
  assert.equal(after.start, "16:00")
  assert.equal(after.deal, "$2 Gulf oysters; $6 house wine; 1/2 off draft beer")
  assert.equal(after.verified, "2026-11-10")
  assert.equal(after.board, "boards/luke/2026-11-10.jpg")
  assert.equal(after.source, luke.source, "website link is kept")
  assert.equal(after.items.length, 3)
  assert.match(`${after.start}-${after.end}`, /^\d{2}:\d{2}-\d{2}:\d{2}$/, "passes the data file's own time rule")
})

test("extra windows land in the note; no oysters means cheapest item headlines", () => {
  const b = board({
    items: [{ what: "margarita", price: 5, unit: "drink", price_text: "$5" }, { what: "fries", price: 4, unit: "plate", price_text: "$4" }],
    windows: [{ days: [1, 2, 3, 4, 5], start: "15:00", end: "18:00" }, { days: [0, 1, 2, 3, 4, 5, 6], start: "22:00", end: "23:59", label: "Late night" }],
  })
  const after = applyBoard(luke, b, { date: "2026-11-10", boardUrl: "x" })
  assert.equal(after.price, 4)
  assert.equal(after.unit, "plate")
  assert.equal(after.note, "Late night: daily 10pm–11:59pm")
})

test("changes are described in plain words", () => {
  const after = applyBoard(luke, board(), { date: "2026-11-10", boardUrl: "x" })
  const { lines, summary } = describeChange(luke, after)
  assert.ok(lines.includes("Headline price: $1.50 ea → $2 ea"))
  assert.ok(lines.includes("Hours: daily 3pm–6pm → Mon–Fri 4pm–6pm"))
  assert.match(summary, /Mon–Fri 4pm–6pm$/)
  assert.deepEqual(describeChange(luke, luke).lines, [])
})

test("day and clock labels", () => {
  assert.equal(dayRange([5, 6, 0]), "Sun, Fri, Sat")
  assert.equal(dayRange([2, 3, 4]), "Tue–Thu")
  assert.equal(dayRange([0, 6]), "weekends")
  assert.equal(clock("00:30"), "12:30am")
  assert.equal(clock("12:00"), "12pm")
})
