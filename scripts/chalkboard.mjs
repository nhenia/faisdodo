#!/usr/bin/env node
// Chalkboard bounty — run by .github/workflows/chalkboard.yml when a bartender texts a photo.
//
//  1. Works out which bar sent it (registered phone number, or the bar's name in the text/photo).
//  2. Shrinks the photo and asks Claude to read every special, day and time on it.
//  3. Checks the reading against the rules in chalkboard-lib.mjs.
//  4. Updates that bar in src/deals.json and saves the photo to public/boards/<bar>/ as proof.
//  5. Tells the workflow what to do next (publish, open a pull request for review, or just reply).
//
// Inputs (environment): FROM, BODY, MEDIA_URLS (JSON list) or IMAGE_URL (manual runs), VENUE_ID (manual runs), BARTENDER_ROSTER,
// ANTHROPIC_API_KEY, CHALKBOARD_MODEL, AUTO_PUBLISH, TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN (photo download).
// Phone numbers are never printed or written to the repo.

import fs from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import {
  EXTRACTION_TOOL, extractionPrompt, identifyVenue, venueFromText, checkExtraction, applyBoard, describeChange, REPLIES, DAY_NAMES,
} from "./chalkboard-lib.mjs"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const dealsFile = path.join(root, "src", "deals.json")
const env = process.env
const MODEL = env.CHALKBOARD_MODEL || "claude-sonnet-5-5"
const AUTO = (env.AUTO_PUBLISH || "registered").toLowerCase() // "registered" | "never"

const outputs = {}
async function finish(fields, report = "") {
  Object.assign(outputs, fields)
  const lines = Object.entries(outputs).map(([k, v]) => `${k}<<__EOF__\n${v ?? ""}\n__EOF__`)
  if (env.GITHUB_OUTPUT) await fs.appendFile(env.GITHUB_OUTPUT, `${lines.join("\n")}\n`)
  if (report) await fs.writeFile(path.join(root, "chalkboard-result.md"), report)
  if (report && env.GITHUB_STEP_SUMMARY) await fs.appendFile(env.GITHUB_STEP_SUMMARY, report)
  console.log(`status=${outputs.status} venue=${outputs.venue ?? "-"}\nreply: ${outputs.reply}`)
}

// New Orleans calendar date and weekday, whatever the server's clock says.
function nolaToday(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" })
      .formatToParts(now).map((p) => [p.type, p.value]),
  )
  return { date: `${parts.year}-${parts.month}-${parts.day}`, label: `${parts.weekday} ${parts.year}-${parts.month}-${parts.day}`, day: DAY_NAMES.indexOf(parts.weekday) }
}

async function download(url, dir, n) {
  const headers = {}
  if (/twilio\.com/.test(new URL(url).host) && env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN)
    headers.Authorization = `Basic ${Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64")}`
  const res = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(30000) })
  if (!res.ok) throw new Error(`photo download failed (HTTP ${res.status})`)
  const type = res.headers.get("content-type") ?? ""
  if (!type.startsWith("image/")) throw new Error(`not an image (${type || "unknown type"})`)
  const file = path.join(dir, `in-${n}.${type.split("/")[1].replace(/[^a-z0-9]/g, "") || "img"}`)
  await fs.writeFile(file, Buffer.from(await res.arrayBuffer()))
  return { file, type }
}

// Shrink to a sensible size and strip location data from the photo (EXIF) before anything else.
function prepare({ file, type }, out, longEdge) {
  try {
    execFileSync("convert", [`${file}[0]`, "-auto-orient", "-strip", "-resize", `${longEdge}x${longEdge}>`, "-quality", "82", out])
    return out
  } catch {
    if (!/jpe?g|png|webp|gif/.test(type)) throw new Error("photo format not supported; please send a JPG")
    return file // no ImageMagick (e.g. on a laptop): send the original
  }
}

async function readBoard(images, venue, today) {
  const content = [
    ...(await Promise.all(images.map(async (file) => ({
      type: "image",
      source: { type: "base64", media_type: file.endsWith(".png") ? "image/png" : "image/jpeg", data: (await fs.readFile(file)).toString("base64") },
    })))),
    { type: "text", text: extractionPrompt(venue, today) },
  ]
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      tools: [EXTRACTION_TOOL],
      tool_choice: { type: "tool", name: EXTRACTION_TOOL.name },
      messages: [{ role: "user", content }],
    }),
    signal: AbortSignal.timeout(120000),
  })
  if (!res.ok) throw new Error(`Claude API HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const block = (await res.json()).content?.find((b) => b.type === "tool_use")
  if (!block) throw new Error("Claude did not return a reading")
  return block.input
}

// --- Run ------------------------------------------------------------------------------------------
const data = JSON.parse(await fs.readFile(dealsFile, "utf8"))
const from = (env.FROM ?? "").trim()
const body = (env.BODY ?? "").trim()
const media = (env.IMAGE_URL ? [env.IMAGE_URL.trim()] : JSON.parse(env.MEDIA_URLS || "[]")).filter(Boolean).slice(0, 3)
const today = nolaToday()

if (!media.length) {
  await finish({ status: "reply", reply: /^\s*(help|info)\b/i.test(body) ? REPLIES.help : REPLIES.noPhoto })
  process.exit(0)
}

let roster = {}
try { roster = JSON.parse(env.BARTENDER_ROSTER || "{}") } catch { console.warn("BARTENDER_ROSTER is not valid JSON; treating everyone as unregistered") }

let who = identifyVenue({ from, body, roster, venues: data.venues })
if (env.VENUE_ID) {
  const venue = data.venues.find((v) => v.id === env.VENUE_ID)
  if (!venue) throw new Error(`No venue with id "${env.VENUE_ID}" in src/deals.json`)
  who = { venue, trusted: env.TRUST_MANUAL === "true", how: "chosen by hand" }
}

const work = await fs.mkdtemp(path.join(os.tmpdir(), "chalkboard-"))
let reading, images
try {
  const raw = await Promise.all(media.map((url, i) => download(url, work, i)))
  images = raw.map((r, i) => ({ forModel: prepare(r, path.join(work, `model-${i}.jpg`), 1568), forRepo: prepare(r, path.join(work, `board-${i}.jpg`), 1200) }))
  reading = await readBoard(images.map((i) => i.forModel), who.venue, today)
} catch (error) {
  console.error(error)
  const unsupported = /format|not an image/.test(error.message)
  await finish(
    { status: unsupported ? "reply" : "failed", venue: who.venue?.id ?? "", reply: unsupported ? REPLIES.rejected("I couldn't open that photo.") : REPLIES.failed },
    `## Chalkboard bounty: couldn't read the photo\n\n- Bar: ${who.venue?.name ?? "unknown"}\n- Error: ${error.message}\n`,
  )
  process.exit(0)
}

// Unknown sender with no name in the text? Maybe the bar's name is on the board itself.
if (!who.venue && reading.venue_name_on_board) {
  const named = venueFromText(reading.venue_name_on_board, data.venues)
  if (named) who = { venue: named, trusted: false, how: "name written on the board" }
}

const check = checkExtraction(reading, who.venue)
const readingMd = [
  "### What the board says",
  ...reading.items.map((i) => `- ${i.price_text} — ${i.what}`),
  ...(reading.windows ?? []).map((w) => `- When: ${w.label ? `${w.label}, ` : ""}days ${w.days.join(",")} · ${w.start ?? "?"}–${w.end ?? "?"}`),
  `- Reading confidence: ${reading.confidence}${reading.unreadable?.length ? ` (couldn't read: ${reading.unreadable.join("; ")})` : ""}`,
].join("\n")

if (check.fatal) {
  await finish({ status: "reply", venue: who.venue?.id ?? "", reply: REPLIES.rejected(check.fatal) }, `## Chalkboard bounty: rejected\n\n${check.fatal}\n`)
  process.exit(0)
}
if (!who.venue) {
  await finish(
    { status: "unknown", venue: "", reply: REPLIES.unknownBar },
    `## Chalkboard from an unknown bar\n\nSomeone sent a board but I couldn't match it to a bar on the list` +
      `${reading.venue_name_on_board ? ` (the board says "${reading.venue_name_on_board}")` : ""}. If it's a new bar, add it to \`src/deals.json\`.\n\n${readingMd}\n`,
  )
  process.exit(0)
}

// Save the photo(s) as evidence, then update the entry.
const venue = who.venue
const boardDir = path.join(root, "public", "boards", venue.id)
await fs.mkdir(boardDir, { recursive: true })
const boardFiles = []
for (const [i, img] of images.entries()) {
  const name = `${today.date}${images.length > 1 ? `-${i + 1}` : ""}.jpg`
  await fs.copyFile(img.forRepo, path.join(boardDir, name))
  boardFiles.push(`boards/${venue.id}/${name}`)
}
const after = applyBoard(venue, reading, { date: today.date, boardUrl: boardFiles[0] })
const change = describeChange(venue, after)
data.venues = data.venues.map((v) => (v.id === venue.id ? after : v))
await fs.writeFile(dealsFile, `${JSON.stringify(data, null, 2)}\n`)

const publish = who.trusted && AUTO !== "never" && check.problems.length === 0
const status = publish ? "published" : "review"
const reply = publish ? (change.lines.length ? REPLIES.published(venue, change.summary) : REPLIES.unchanged(venue)) : REPLIES.review(venue)
const why = publish
  ? "Sent from a registered number and passed every check, so it went live automatically."
  : [
      `Needs a human because:`,
      ...(who.trusted ? [] : [`- the sender isn't registered to ${venue.name} (matched by ${who.how})`]),
      ...(AUTO === "never" ? ["- auto-publish is switched off (AUTO_PUBLISH=never)"] : []),
      ...check.problems.map((p) => `- ${p}`),
    ].join("\n")

await finish(
  { status, venue: venue.id, venue_name: venue.name, reply, branch: `chalkboard/${venue.id}-${today.date}-${Date.now().toString(36)}`, title: `Chalkboard: ${venue.name} (${today.date})` },
  [
    `## Chalkboard: ${venue.name}`,
    "",
    why,
    "",
    "### Changes to the map",
    ...(change.lines.length ? change.lines.map((l) => `- ${l}`) : ["- None: the board matches what we list. Marked as freshly checked."]),
    "",
    readingMd,
    "",
    `### The photo\n${boardFiles.map((f) => `- \`public/${f}\``).join("\n")}`,
    "",
    publish ? "" : "_Merge this pull request to publish. Edit `src/deals.json` in the PR first if something's off._\n",
  ].join("\n"),
)
