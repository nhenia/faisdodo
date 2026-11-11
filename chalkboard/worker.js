// Fais DoDo text-message inbox (a Cloudflare Worker — free tier is plenty).
//
// Twilio calls this when someone texts the Fais DoDo number. It:
//   1. proves the request really came from Twilio (signature check), so strangers can't spam the bot;
//   2. hands the sender, message and photo links to the GitHub "Chalkboard bounty" workflow;
//   3. answers the bartender right away so they know it landed.
// The workflow texts them again with the result a minute or two later.
//
// Settings (Cloudflare → Worker → Settings → Variables, all "Secret" except GITHUB_REPO):
//   TWILIO_AUTH_TOKEN  from the Twilio console
//   GITHUB_TOKEN       fine-grained token, repo nhenia/faisdodo only, permission "Contents: read and write"
//   GITHUB_REPO        nhenia/faisdodo
// Setup steps: chalkboard/SETUP.md

const twiml = (message) =>
  new Response(
    `<?xml version="1.0" encoding="UTF-8"?><Response>${message ? `<Message>${message.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c])}</Message>` : ""}</Response>`,
    { headers: { "content-type": "text/xml" } },
  )

// Twilio's signature: base64(HMAC-SHA1(auth token, full URL + every POST field name+value, sorted by name)).
export async function validTwilioSignature(url, params, signature, authToken) {
  if (!signature || !authToken) return false
  const payload = url + [...params.keys()].sort().map((k) => k + params.get(k)).join("")
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(authToken), { name: "HMAC", hash: "SHA-1" }, false, ["sign"])
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)))
  if (expected.length !== signature.length) return false
  let diff = 0 // constant-time compare
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  return diff === 0
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response("Fais DoDo chalkboard inbox is running.", { status: 200 })

    const params = new URLSearchParams(await request.text())
    if (!(await validTwilioSignature(request.url, params, request.headers.get("x-twilio-signature"), env.TWILIO_AUTH_TOKEN)))
      return new Response("Forbidden", { status: 403 })

    const count = Math.min(Number(params.get("NumMedia") || 0), 3)
    const media = Array.from({ length: count }, (_, i) => params.get(`MediaUrl${i}`)).filter(Boolean)
    const body = (params.get("Body") || "").slice(0, 500)

    const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/dispatches`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.GITHUB_TOKEN}`,
        accept: "application/vnd.github+json",
        "user-agent": "faisdodo-chalkboard-inbox",
      },
      body: JSON.stringify({
        event_type: "chalkboard",
        client_payload: { from: params.get("From"), body, media: JSON.stringify(media) },
      }),
    })
    if (!res.ok) {
      console.error("GitHub dispatch failed", res.status, await res.text())
      return twiml("Sorry, the Fais DoDo inbox is having trouble. Try again in a few minutes.")
    }
    // STOP/START/HELP keywords are answered by Twilio itself; photo-less texts get their reply from the workflow.
    return twiml(media.length ? "Got your board! Reading it now. I'll text you when it's on the map." : "")
  },
}
