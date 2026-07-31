# Go live by Monday

Everything here is Google or your own data. No Apollo, no ZoomInfo, no
Clearbit, no lead scrapers, no third-party data brokers. The system finds
companies from **your own Gmail alerts**, the **Google Places API**, and
**companies' own public websites** — nothing else.

Work through this in order. At any point run `npm run check` and it will tell
you exactly what is still missing.

---

## Before you start, gather these

| Thing | Where it comes from | Needed for |
| --- | --- | --- |
| A server or host that stays on | Any VPS, or your own machine | Everything |
| A PostgreSQL database | Comes with the Docker setup, or any managed Postgres | Everything |
| A Google account for Videowalla | You already have `videowalla.co` | Gmail + Calendar |
| A Google Cloud project | console.cloud.google.com — free to create | Gmail, Calendar, Places |
| A credit card on Google Cloud | Only for the Places API | Finding companies that are *not* hiring |
| An Anthropic or OpenAI key | *Optional* | Better lead qualification |

The only genuinely required items are the host and the database. Everything
else improves the system, and the app tells you honestly what is switched off.

---

## Step 1 — Get it running (about 20 minutes)

### Option A: Docker (simplest, one command)

> **Not yet verified.** The Dockerfile and compose file are written and
> reviewed, but I could not build them in my sandbox because Docker Hub was
> blocked there. Try it first; if anything fails, Option B is fully tested.

```bash
git clone <your repo url> videowalla-crm
cd videowalla-crm
cp .env.example .env
```

Edit `.env` and set these five:

```bash
POSTGRES_PASSWORD=<make up a long password>
SESSION_SECRET=<paste: openssl rand -base64 48>
ENCRYPTION_KEY=<paste: openssl rand -hex 32>
APP_URL=https://sales.videowalla.co     # or http://your-server-ip:3000 to start
CRON_SECRET=<paste: openssl rand -hex 32>
```

Then:

```bash
docker compose up -d --build
docker compose exec app npx prisma migrate deploy
docker compose exec app npm run seed
docker compose exec -it app npm run bootstrap:owner
docker compose exec app npm run check
```

### Option B: Plain Node (fully tested)

Requires Node 20.11+ and PostgreSQL 14+ already installed.

```bash
git clone <your repo url> videowalla-crm
cd videowalla-crm
npm install
cp .env.example .env          # fill in DATABASE_URL, SESSION_SECRET, ENCRYPTION_KEY, APP_URL
npm run prisma:deploy
npm run seed
npm run bootstrap:owner
npm run build
```

Then run **both** of these, and keep both running:

```bash
npm start        # the website
npm run worker   # the automation
```

> **The worker is not optional.** Without it nothing is ever ingested, no week
> is planned, and no follow-up ever becomes due. On a real server use `pm2`,
> `systemd` or `docker compose` so both restart automatically.

Check it: `npm run check`

---

## Step 2 — Google Cloud setup (about 15 minutes)

Do this once at **console.cloud.google.com**, signed in as your Videowalla
Google account.

### 2a. Create the project
1. Top bar → project dropdown → **New Project**
2. Name it `Videowalla Sales` → **Create**

### 2b. Turn on the APIs
**APIs & Services → Library**, search for and **Enable** each:
- **Gmail API** — reads your alert emails
- **Google Calendar API** — sends meeting invitations
- **Places API (New)** — finds companies that are not hiring *(needs billing)*

### 2c. Consent screen
**APIs & Services → OAuth consent screen**
- User type: **Internal** if you have Google Workspace on videowalla.co (easiest).
  Otherwise **External**, and add your own email under *Test users*.
- App name: `Videowalla Sales Command Center`
- Support email: your address → **Save**

### 2d. Create the OAuth client
**APIs & Services → Credentials → Create Credentials → OAuth client ID**
- Application type: **Web application**
- Name: `Sales Command Center`
- **Authorised redirect URI** — this must match exactly:
  ```
  https://sales.videowalla.co/api/integrations/google/callback
  ```
  (Use whatever your `APP_URL` is, with `/api/integrations/google/callback` on the end.)
- **Create**, then copy the **Client ID** and **Client secret** into `.env`:
  ```bash
  GOOGLE_CLIENT_ID=...
  GOOGLE_CLIENT_SECRET=...
  ```

### 2e. Places API key (optional but recommended)
**Credentials → Create Credentials → API key**. Copy it, then **Restrict key →
API restrictions → Places API (New)**. Put it in `.env` as
`GOOGLE_PLACES_API_KEY`, or paste it into Settings → Integrations later.

**Restart the app** after editing `.env`.

---

## Step 3 — Set up your lead inbox (about 15 minutes)

This is where most leads come from, so it is worth doing properly.

### 3a. Create Gmail labels
In Gmail, create these labels exactly (spelling matters):

- `Google Alerts`
- `Job Alerts`
- `Hiring Opportunities`
- `Local Businesses`
- `Lead Sources`
- `Manual Review`

### 3b. Set up Google Alerts
Go to **google.com/alerts** and create one alert per phrase below. For each:
*Show options* → **Deliver to: your email**, **How often: As-it-happens**.

```
"content creator" jobs Toronto
"social media manager" hiring Toronto
"videographer" hiring Ontario
"video editor" jobs Toronto
"marketing manager" hiring Burlington OR Oakville OR Mississauga
"media buyer" jobs Ontario
"marketing coordinator" hiring Hamilton
"in-house content creator" Ontario
```

Adjust the cities to match your priority list. You can change or add keywords
any time in **Settings → Discovery**.

### 3c. Auto-label the alerts
In Gmail: **Settings → Filters → Create a new filter**
- From: `googlealerts-noreply@google.com` → **Apply label: Google Alerts**

Repeat for job boards you subscribe to:
- From: `indeed.com` → **Apply label: Job Alerts**
- From: `linkedin.com` → **Apply label: Job Alerts**

Tick **"Also apply filter to matching conversations"** so existing mail is
picked up too.

### 3d. Anything you spot yourself
Forward it to your own inbox and label it `Manual Review`. The system reads
that label too and will process whatever you send it.

---

## Step 4 — Connect it all (5 minutes)

Sign in to the app as the owner.

1. **Settings → Integrations**
   - **Gmail** → *Connect this account* → approve → then press **Test connection**
   - **Google Calendar** → *Connect this account* → approve → **Test connection**
   - **Google Places** → paste the API key → Save → **Test connection**
   - *(Optional)* **Anthropic** or **OpenAI** → paste key → Save → **Test connection**

Nothing shows as connected until a test actually passes. If a test fails it
tells you why.

---

## Step 5 — Set up your salesperson (5 minutes)

**Settings → Team**

1. **Invite someone**: her name, her email, role **Sales representative** →
   *Create invitation*
2. The page shows you a link. **Send her that link** (WhatsApp, text, email —
   however you normally reach her). She sets her own password. There is no
   public sign-up, so this link is the only way in.
3. Once she appears, set:
   - **Working schedule** — e.g. 8 hours total: Monday 09:00 for 4 hours,
     Tuesday 09:00 for 4 hours. Any split works as long as the days add up to
     the weekly total.
   - **Compensation** — e.g. `100.00` per working week, cadence *Every two
     weeks*. Without this, every cost and ROI number reads as zero.

---

## Step 6 — Prepare the first week (5 minutes)

Normally this happens by itself on Sunday at 6pm. For the first week, do it now.

1. **Sunday Review → Run planning now** → *Run now*
2. Wait about a minute, then refresh. It will have gone and read your Gmail
   labels, extracted the companies, qualified and scored them, and built a
   proposed week.
3. **Review exceptions** — anything the system was not confident about is held
   here rather than being dialled blind. Tick the good ones → *Approve selected
   for calling*.
4. Check the targets. The engine explains why it chose them (*"Why the engine
   chose these targets"*). Change any number if you disagree.
5. **Approve next week.**

She is notified, and her queue appears.

Run `npm run check` one last time. It should say **READY**.

---

## Monday morning — what she does

Send her this. It is the whole job.

1. Open the app, go to **This Week**
2. Press **Start shift**
3. Open the top lead in the queue
4. Call the number on screen. The suggested opening is there to read out.
5. Pick what happened: *No answer*, *Connected*, *Interested*, etc.
6. Add a short note if it asks for one
7. Move to the next lead
8. Press **End shift** when done

That is it. Follow-ups, reminders, ticket movement and your reports all happen
automatically behind those clicks. She never has to search Google, Indeed or
LinkedIn.

---

## Monday morning — what you do

Open **Overview**. Within about ten seconds you can see whether she is clocked
in, hours done against hours paid, contacts and follow-ups completed against
target, conversations, interested leads, meetings booked, this week's score
against last week's, and what it is costing per conversation and per meeting.

**Live Activity** shows what she is doing right now, built from real actions in
the app — no screenshots, no keylogging, nothing outside this product.

---

## If something looks wrong

| Symptom | Cause | Fix |
| --- | --- | --- |
| Her queue is empty | No week approved, or no leads found | Sunday Review → Run planning now, then approve |
| No new leads ever appear | Worker not running, or Gmail not connected | `npm run check` will say which |
| "Gmail label not found" | Label name does not match exactly | Check spelling in Gmail, including capitals |
| Everything lands in Review Required | No AI key configured | Normal. Approve them by hand, or add a key |
| Costs and ROI all show zero | Compensation not set | Settings → Team |
| Nothing happens on Sunday | Worker not running | It must run continuously, not just when you visit |

`npm run check` diagnoses all of the above in one command.

---

## What this system will not do

It will not log in to LinkedIn or Indeed, solve CAPTCHAs, bypass rate limits or
scrape pages behind access controls. It reads your own mailbox, official Google
APIs, and companies' own public websites.

It will not invent a phone number, an email address or a person's name. If it
does not have one, the ticket says so and lists it under *Not known — confirm
on the call*.

It will not present a guess as a fact. Revenue and employee counts are marked
as estimates with their confidence level and where they came from.

It will not claim revenue that is not real. Reports show *no deals linked*
rather than a zero that looks like a result.

---

## Things I could not do for you

Being straight about the boundaries:

- **I could not deploy it.** I had no hosting credentials, so the app currently
  only exists as code in your repository. Step 1 is yours.
- **I could not set up your Google Cloud project.** That needs you signed in to
  your own Google account. Step 2 is yours.
- **I could not test the Google integrations against live credentials.** The
  code is written and the connection tests are built in, but until you connect
  a real account and press *Test connection*, Gmail, Calendar and Places are
  unproven. The app is honest about this — it shows them as *not configured*
  rather than pretending.
- **I could not verify the Docker build.** Docker Hub was blocked in my
  environment. Option B is fully tested.

Everything that does not depend on your credentials has been built and verified
end to end against a real database and a real browser.
