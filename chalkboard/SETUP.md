# Chalkboard bounty: setup

Bartenders text a photo of their specials board to one phone number. A minute later Fais DoDo is updated and they get a thank-you text.

```
bartender's phone ──text+photo──▶ Twilio number ──▶ Cloudflare Worker (chalkboard/worker.js)
                                                          │ checks it's really Twilio
                                                          ▼
                                       GitHub "Chalkboard bounty" workflow
                                       reads the board with Claude, checks it,
                                       saves the photo as proof
                                  ┌─────────────┼──────────────┐
                        registered bartender   anyone else    not a menu / unknown bar
                        + clean reading
                              ▼                    ▼                ▼
                         live on the map     pull request      issue + friendly text
                         + thank-you text    for you to OK
```

## Try it today (no texting needed)

GitHub → **Actions** → **Chalkboard bounty** → **Run workflow**. Paste a direct link to a board photo, optionally a bar id like `luke`, and run. Leave *Publish* unticked and you'll get a pull request to look over. This only needs step 1 below.

## 1. Claude key (needed for everything) · about 5 minutes

1. At console.anthropic.com, create an API key and add a few dollars of credit.
2. In the repo: **Settings → Secrets and variables → Actions → New repository secret**. Name: `ANTHROPIC_API_KEY`, value: the key.
3. Still in Settings: **Actions → General → Workflow permissions**: tick *Allow GitHub Actions to create and approve pull requests*. Without this the review step can't open pull requests.

Optional repository **variables** (same page, *Variables* tab):
- `AUTO_PUBLISH` = `never` if every board should wait for your OK, even from registered bartenders.
- `CHALKBOARD_MODEL` to change which Claude model reads boards (default `claude-sonnet-5-5`).

## 2. A phone number · about 15 minutes, then a few days' wait

1. Sign up at twilio.com and buy a US local number that can do SMS and MMS (about $1.15 a month).
2. Register it for **A2P 10DLC**, the US carriers' rule for any app that sends texts. The *Sole Proprietor* option fits a one-person project (no business tax ID needed). Approval takes a few days. Until then, texts *to* the number arrive but replies may be blocked.
3. Add three more repo secrets: `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` (Twilio console home page) and `TWILIO_NUMBER` (the number, written like `+15045551234`).

## 3. The inbox · about 10 minutes, free

1. At dash.cloudflare.com: **Workers & Pages → Create → Worker**. Name it `faisdodo-inbox`, then *Edit code*, paste in all of `chalkboard/worker.js`, and *Deploy*.
2. Make a GitHub token: github.com → Settings → Developer settings → **Fine-grained tokens** → *Generate*. Repository: only `nhenia/faisdodo`. Permission: **Contents: Read and write**. Copy it.
3. In the Worker: **Settings → Variables and secrets**, add:
   - `TWILIO_AUTH_TOKEN` (secret)
   - `GITHUB_TOKEN` (secret): the token from step 2
   - `GITHUB_REPO` (text): `nhenia/faisdodo`
4. In Twilio: **Phone Numbers → your number → Messaging**, set "A message comes in" to *Webhook*, paste the Worker's address (like `https://faisdodo-inbox.<you>.workers.dev/`), method **POST**. Save.

## 4. Register your bartenders

Registered numbers go live without waiting for you. Everyone else becomes a pull request.

Add a repo secret named `BARTENDER_ROSTER`, mapping phone numbers to bar ids from `src/deals.json`:

```json
{ "+15045551234": "luke", "+15045559876": "bourbon-house" }
```

To add someone later, edit the secret (GitHub only lets you overwrite it, so keep your own copy of the list somewhere private). Phone numbers live only in this secret. They are never written to the repo or shown in workflow logs.

## What bartenders need to know

> Text a photo of your happy hour board to **(504) XXX-XXXX**. First time? Add your bar's name. You'll get a text back when it's on the map.
> Straight-on, whole board, good light. Reply STOP to opt out.

## Costs (checked November 2026)

| | Each photo | Monthly |
|---|---|---|
| Twilio number | | about $1.15 |
| Incoming photo text | about 2.5¢ (1.65¢ plus a carrier fee) | |
| Reply text | about 1.3¢ (0.83¢ plus a carrier fee) | |
| Claude reading the board | roughly 1 to 3¢ (estimate) | |
| Cloudflare Worker, GitHub Actions | free at this size | |

So 200 boards a month comes to roughly $10, plus 10DLC registration fees (see Twilio's A2P 10DLC page).

## Safety rules built in

- Only Twilio can trigger it (signed requests); forged requests get a "Forbidden."
- Registered bartender plus a clean reading goes live. Anything doubtful (smudges, "til close," overnight windows, "tonight only," a different bar's name on the board, failed data checks, unregistered sender) waits for you.
- Photos are shrunk and stripped of hidden location data before they're saved to `public/boards/` as proof.
- The website link for each bar is kept. The twice-weekly data robot stops nagging about website prices for 30 days after a board photo, because the board is the fresher source.

Photos in `public/boards/` are public. Tell bartenders to frame just the board, no faces.
