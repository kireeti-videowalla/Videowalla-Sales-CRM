# Videowalla Sales Command Center

A private, internal sales operating system for Videowalla. It finds companies
worth calling, researches and scores them, prepares a complete call ticket for
each one, plans the salesperson's week automatically, and shows the owner
whether the money being spent is producing results.

It is not a CRM you fill in by hand. The point is that on Monday morning the
work is already prepared.

---

## What it actually does

**Every few hours** it reads the labelled alert emails in a connected Gmail
account (Google Alerts, Indeed, LinkedIn, forwarded messages), extracts the
companies and roles, and — where a Places API key is configured — searches
configured cities and industries for companies that fit the profile but are not
hiring.

**For each new opportunity** it deduplicates against everything already known,
runs a structured AI qualification pass, reads the company's own public website
for contact details, scores the lead 0-100 against configurable weights, and
turns it into a finished ticket: who to call, their number, what the company
wants, why Videowalla should call, and a suggested opening.

**Every Sunday evening** it freezes the previous week's scorecard, carries every
unfinished follow-up forward, works out how much can realistically fit into the
paid hours, sets weekly targets that match that capacity, assigns the leads, and
asks the owner to approve the plan.

**During the week** the salesperson starts a shift, works the queue top-down,
picks an outcome after each call and moves on. Follow-ups, stage movement,
activity history and owner alerts all happen behind that one action.

---

## Requirements

- Node.js 20.11 or newer
- PostgreSQL 14 or newer

Nothing else is required to run the full pipeline. AI keys, Gmail, Calendar and
Places are optional and improve results; without them the system still works and
says clearly which parts are unconfigured.

---

## Setup

```bash
npm install
cp .env.example .env          # then fill in the three REQUIRED variables
npm run prisma:deploy         # create the database schema
npm run seed                  # install default configuration (not sample data)
npm run bootstrap:owner       # create the first owner account
```

Then, in two terminals:

```bash
npm run dev                   # the application
npm run worker                # the background automation
```

`npm run worker` is not optional. Without it nothing is ingested, no week is
planned and no follow-up ever becomes due. Settings → Automation warns you when
no job has completed recently.

### Generating the secrets

```bash
openssl rand -base64 48   # SESSION_SECRET
openssl rand -hex 32      # ENCRYPTION_KEY  (exactly 64 hex characters)
openssl rand -hex 32      # CRON_SECRET
```

`ENCRYPTION_KEY` encrypts stored integration credentials. Changing it makes
every saved credential unreadable and they must be re-entered.

### First-run checklist

1. Sign in as the owner.
2. **Settings → Team** — invite the salesperson, set her weekly hours, planned
   shifts and pay. Share the invitation link the page gives you; there is no
   public sign-up.
3. **Settings → General** — confirm the Videowalla profile and ideal customer
   profile.
4. **Settings → Discovery** — review locations, industries and hiring keywords.
5. **Settings → Integrations** — connect Gmail and anything else you have keys
   for, and press *Test connection* on each.
6. **Sunday Review → Run planning now** — don't wait until Sunday for the first
   week.

---

## Configuration

Everything the automation uses is editable in the app. Nothing that matters is
hard-coded.

| Screen | Controls |
| --- | --- |
| Settings → General | Videowalla services and positioning, ideal customer profile, AI provider |
| Settings → Discovery | Lead sources, hiring keywords, locations and priorities, industries, posting-age bands |
| Settings → Scoring | The twelve scoring factors, their weights, and the band thresholds |
| Settings → Sprint & shifts | Weekly planning schedule, capacity maths, target ranges, shift and inactivity policy, performance-score weights |
| Settings → Follow-ups | Retry timings, reactivation windows, contact outcomes |
| Settings → Integrations | Credentials, notification rules, CSV import |
| Settings → Automation | Cron schedules, queue health, failed jobs |
| Team | Weekly hours, flexible shift pattern, compensation |

Compensation and hours are per-person and versioned: changing them does not
rewrite what a past week cost.

---

## Integrations

Each one reports its real state. An integration is `configured, untested` until a
live connection test actually succeeds — it never claims to work on the strength
of a saved credential alone.

| Integration | Used for | Without it |
| --- | --- | --- |
| Anthropic / OpenAI | Structured lead qualification | The built-in deterministic rules engine runs instead, at lower confidence, and uncertain leads go to Manual Review |
| Gmail (read-only) | Reading labelled alert emails | Email ingestion is skipped; manual URL and CSV import still work |
| Google Calendar | Meeting invitations from a ticket | The meeting is recorded and the rep is told plainly that no invitation was sent |
| Google Places | Local company discovery | Only hiring-intent and manual leads are found |
| Twilio / GoHighLevel | Verified call logging (Phase 3) | Contacts are labelled *manually reported*, never *verified* |

### What it will not do

The lead sources are limited to your own mailbox, official APIs, public company
pages and files you supply. The system does not log in to LinkedIn or Indeed,
does not solve CAPTCHAs, does not bypass rate limits or anti-bot measures, and
does not scrape access-controlled pages. Website enrichment reads only publicly
served pages, identifies itself in its user agent, and honours a blanket
`Disallow: /` in `robots.txt`.

---

## How the numbers are produced

**Lead score (0-100)** — twelve weighted factors. Each records what it awarded
and a plain-language reason, shown on the ticket. Weights and band thresholds
are editable; changing them affects future scoring, leaving past decisions
explainable against the rules in force at the time.

**Weekly targets** — derived from the paid hours, not a fixed number. Overhead
is subtracted, committed work (overdue follow-ups, interested leads, unconfirmed
invitations) is funded first, and whatever time remains buys new contacts. The
plan can never exceed the available hours, and never exceeds the number of leads
actually prepared — a shortage is reported rather than papered over.

**Weekly performance score (0-100)** — attendance 15, contacts 20, follow-ups
20, note quality 10, conversations 10, interested leads 10, meetings 15. Every
point traces to a counted event. There is no AI judgement in this score.

**Cost and ROI** — derived from configured compensation. Revenue is only ever
attributed when a real deal is explicitly linked to a real ticket; otherwise the
reports say *no deals linked* rather than showing a zero.

### Estimates are labelled as estimates

Revenue and employee counts are usually inferred. Every such value stores its
source, confidence level and the date it was checked, and the UI marks it
visibly. Contact details are never invented — a missing phone number stays
missing and is listed under *Not known — confirm on the call*.

---

## Accountability

Tracking is limited to meaningful work inside this application: shifts, tickets
opened, outcomes recorded, notes written, follow-ups created, meetings booked.
There is no keylogging, no screenshots and no monitoring of anything outside the
product.

Activity events, stage history and contact attempts are append-only. A note can
be corrected, but the previous text is kept and the edit is visible. A
salesperson cannot delete history, alter timestamps, change scoring, or lift a
do-not-contact flag.

Verified and manually reported contacts are counted and displayed separately,
always.

---

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the application |
| `npm run worker` | Start background automation (required) |
| `npm run build` / `npm start` | Production build and serve |
| `npm run seed` | Install or refresh default configuration |
| `npm run bootstrap:owner` | Create the first owner account |
| `npm run seed:dev-fixtures` | Load clearly-labelled fake leads for development |
| `npm run seed:dev-fixtures -- --clean` | Remove them again |
| `npm test` | Unit tests (time, normalization, parsing, targets) |
| `npm run test:acceptance` | Full workflow against a real database |
| `npm run typecheck` | TypeScript, no emit |

### Tests

- `npm test` — 33 unit assertions covering DST-safe week boundaries, company
  and phone normalization, alert-email parsing and target calculation.
- `npm run test:acceptance` — 110 assertions driving the real pipeline
  end to end: three alert emails in, deduplication, qualification, enrichment,
  scoring, ticket creation, owner review, sprint planning, approval, a worked
  shift, outcomes, automatic follow-ups, do-not-contact enforcement, the frozen
  scorecard and carryover into the next week.
- `npx tsx scripts/followup-continuity-test.ts` — 14 assertions pinning the
  "never silently lose a follow-up" guarantee across repeat call attempts.

Both database-backed suites clean up after themselves and only touch records
they created.

---

## Deployment

Run the migrations, then the app and the worker:

```bash
npm run prisma:deploy
npm run build
npm start &
npm run worker &
```

On a platform without long-running processes, skip the worker and have a
scheduler POST to `/api/cron/tick` every few minutes with
`Authorization: Bearer $CRON_SECRET`. It runs the identical code path.

Set `APP_URL` to the real public URL, and add
`<APP_URL>/api/integrations/google/callback` to the Google OAuth client's
authorised redirect URIs.

The app sets `X-Robots-Tag: noindex, nofollow` on every response — it is a
private internal tool and should never be indexed.

---

## Architecture

```
src/
  app/            Next.js App Router — pages, server actions, API routes
  components/     UI primitives and interactive client components
  lib/
    auth/         Sessions, RBAC, invitations
    settings/     Typed, validated configuration store
    jobs/         Postgres-backed queue, cron scheduler, worker runtime
    ai/           Provider abstraction (Anthropic, OpenAI, offline rules)
    ingestion/    Email parsing and lead-source connectors
    pipeline/     Dedup, qualification, enrichment, scoring, stages, tickets
    sprint/       Capacity, dynamic targets, Sunday planning, scorecards
    shifts/       Shift lifecycle and hour accounting
    followups/    Follow-up rules engine
    integrations/ Gmail, Calendar, Places, credential storage
    reports/      Shift, weekly and monthly reporting
  worker/         Standalone background worker process
prisma/           Schema, migrations, configuration seed, dev fixtures
scripts/          Owner bootstrap and database-backed test suites
```

The job queue claims work with `SELECT … FOR UPDATE SKIP LOCKED`, so several
workers can run safely. Jobs retry with exponential backoff, carry idempotency
keys, and land in a visible dead-letter state rather than disappearing.

---

## Current status

Phase 1 is complete and verified end to end. Phase 2 (broader discovery), Phase
3 (verified call and email logging) and Phase 4 (advanced intelligence,
multi-salesperson) build on the same interfaces — the calling-provider and
enrichment-provider abstractions already exist and are stubbed.
