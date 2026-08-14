# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Web system for Querify Analytics, a solo-operated data analytics academy (Excel, SQL Server, Power BI, Python — live courses over Microsoft Teams, Mexico market). Instagram DMs drive prospects to a web form; this system captures their contact info and automates follow-up (the original leak this was built to fix: people who ask about price and disappear).

Two independent parts in one repo:

```
querify-web/          Static public site (HTML/CSS/JS, zero dependencies, zero build step)
querify-backend/       Node.js (Express + PostgreSQL) API, admin panel, follow-up engine
ESTADO.md              Living project-status doc — read this first when resuming work
```

`ESTADO.md` (Spanish) is the actual source of truth for project state, decisions already made, and what's pending for production. Read it before making architecture-level suggestions.

## Commands

All commands run from `querify-backend/` (the site has no build step or package.json — it's served as static files).

```bash
npm install       # install deps
npm start         # run the server (node src/server.js)
npm run dev       # run with --watch (auto-restart on file change)
npm run db:init   # (re)initialize DB schema + seed via scripts/db-init.js
npm run hash -- "some-password"   # generate a bcrypt hash for ADMIN_PASS_HASH
```

There is no test suite, linter, or build step in this repo — do not invent npm scripts for these.

Local setup needs Node 18+ and PostgreSQL reachable via `DATABASE_URL` (see `.env.example`, copy to `.env`). With `STATIC_DIR=../querify-web` set, the backend serves the static site, the API, and the admin panel all from one process on `http://localhost:3000` (admin at `/admin`).

The backend runs in **simulation mode** per-integration: any of WhatsApp, email (Microsoft Graph), Excel/SharePoint sync, or Stripe that's missing credentials in `.env` silently simulates instead of failing — this lets the full lead → welcome → sequence → timeline flow, and separately the full inscripción → pago 1 → alumno → plan de pagos flow, be exercised locally with zero external accounts. `config.simulate.{whatsapp,email,sync,stripe}` in `src/db.js` is the source of truth for this behavior.

To watch the follow-up sequence run in minutes instead of days during local testing, lower these in `.env`: `SEQ_STEP1_HOURS`, `SEQ_STEP2_HOURS`, `SEQ_STEP3_HOURS`, and set `CRON_SCHEDULE=* * * * *`.

## Backend architecture (`querify-backend/src/`)

Request flow: `server.js` wires up Express, session middleware, the cron job, and (optionally) static file serving, then mounts `routes.js` at `/` and `admin.js` at `/admin`.

- **`db.js`** — the config module. All env vars are read once here into a single `config` object; every other module imports `config` from here rather than touching `process.env` directly. Also derives `config.simulate` (see above) and exports the pg `pool`/`query` helper.
- **`routes.js`** — public surface: `POST /api/leads` (the form endpoint — validates server-side regardless of client validation, checks a honeypot field, then delegates to `engine.altaProspecto`), `GET /api/cohortes/:curso` + `POST /api/inscripcion` (cohort selector and checkout kickoff for "apartar mi lugar"), and two webhooks: WhatsApp (`GET` for Meta's verification handshake, `POST` for incoming messages, which stop a prospect's active sequence) and Stripe (`POST /webhook/stripe`, verifies the signature via `providers.verificarEventoStripe` on the **raw** body — `server.js` applies `express.raw()` to that one path before the global `express.json()`).
- **`engine.js`** — the business logic core: dedup rules, prospect upsert (`altaProspecto`), channel selection with WhatsApp→email fallback (`enviar`/`enviarConVars`), the sequence engine (`correrSecuencia`, invoked hourly by the cron in `server.js`), and the inscripción/cohorte/pago logic (`iniciarInscripcion`, `confirmarInscripcion`, `confirmarPago`, `procesarWebhookStripe`, `revisarPagosPorVencer` — same cron, for pagos 2-5).
- **`providers.js`** — the only place that talks to external services: Meta Cloud API for WhatsApp, Microsoft Graph for both email and Excel/SharePoint sync, and Stripe for Checkout Sessions + webhook signature verification. Email is sent via `POST /users/{buzón}/sendMail` as a shared mailbox (`MAIL_FROM`), reusing the same Graph app registration/token (`getGraphToken`) as the sync feature — there is no SMTP, they're both gated by the same `GRAPH_TENANT_ID`/`GRAPH_CLIENT_ID`/`GRAPH_CLIENT_SECRET` credentials. Every function here degrades to simulation when `config.simulate.*` is true, and Graph sync is always best-effort (failures are logged, never thrown — it must never block lead intake).
- **`templates.js`** — the message templates (bienvenida/recordatorio/valor/cierre/pago/inscripcion) as both plain text (for email/logs) and Meta template params (for WhatsApp). `fill()` supports any `{{N}}` placeholder (not just 1-3) so the `pago` template can carry monto + liga de pago. `inscripcion` is sent from `confirmarInscripcion` to confirm the pago 1 → alumno transition — it isn't part of the prospect follow-up sequence.
- **`admin.js`** — self-contained server-rendered admin panel (session-based login, no separate frontend framework — HTML is built with template literals and a shared `layout()` helper in this same file). Routes: prospects (list/filter, detail with message timeline, send-failure log), **alumnos** (list, detail with the 5-payment plan and a manual "mark as paid" action), and **cohortes** (list/edit fecha de inicio + cupo per curso × modalidad, plus creating new cohorts).

### Data model (`db/schema.sql`)

Five tables: `prospectos` (leads, one row per person, tracks sequence state via `estado_secuencia`/`paso_actual`), `mensajes` (append-only timeline of every send attempt/failure/simulation/inbound reply, joined to a prospect **or** an alumno via `alumno_id`), `cohortes` (curso × modalidad × fecha_inicio, with `cupo_maximo`/`lugares_ocupados` — replaces the old `fechas_inicio`; can have several rows per curso×modalidad over time, one per generation, unlike the old table which held only "the next" date; `engine.proximaFecha` reads from here for the "valor" message), `alumnos` (created only when payment 1 is confirmed, optionally linked to the originating `prospecto_id`), `pagos` (5 rows per alumno, semanas 0/2/4/6/8, `estado` pendiente/pagado/vencido, `metodo` stripe/manual).

Schema is applied idempotently on every boot (`initDb()` in `server.js` runs `schema.sql` via `CREATE TABLE IF NOT EXISTS`, then seeds `cohortes` only if empty) — there is no separate migration tool or migration files. A couple of inline `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` / `DROP NOT NULL` statements at the bottom of `schema.sql` cover column-level changes for local DBs created before `cohortes`/`alumnos` existed (safe to do since the project has no production data yet — see `ESTADO.md`).

### Business rules that are load-bearing (don't casually change without checking `ESTADO.md`)

- **Dedup window**: a repeat contact within `DEDUP_RESET_DAYS` (default 14) updates the existing prospect's course and fills in missing contact fields, but does **not** restart the sequence. Outside that window, it's treated as a cold lead returning — sequence restarts from step 0 with `fecha_inicio_secuencia` reset to now.
- **Sequence steps** are offsets in hours from `fecha_inicio_secuencia`, checked by the hourly cron: step 0 recordatorio (default 24h), step 1 valor (default 72h), step 2 cierre (default 168h/7d), then `estado_secuencia` flips to `finalizada`.
- **Channel logic**: WhatsApp is primary when a phone number is present; email is fallback only if a WhatsApp send fails and an email address exists. If no phone at all, channel is email-only. Same fallback mechanism (`enviarConVars`) is reused for payment-link reminders to alumnos.
- **Any inbound WhatsApp reply stops the sequence** (webhook handler in `routes.js`, matched by phone-number suffix to tolerate Mexico's historical `1` prefix in `wa_id`).
- **Cupo se ocupa al confirmar el pago 1, no al iniciar el checkout** — `iniciarInscripcion` only checks capacity to avoid handing out a dead link; `confirmarInscripcion` (called from the Stripe webhook) is what actually increments `lugares_ocupados`, creates the `alumno`, and generates the 5 `pagos` rows.
- **Pagos 2-5 se cobran por WhatsApp/correo, no con tarjeta guardada** — no recurring/saved-card billing; the cron (`revisarPagosPorVencer`) generates a fresh Checkout Session per payment near its due date and sends it through the same channel mechanism as the sequence.
- **Business decisions already settled** (see `ESTADO.md` § "Decisiones ya tomadas" for the full list and reasoning) — WhatsApp via Meta Cloud API directly (no third-party provider), Node/Express over the originally-considered Python/FastAPI, Railway over Render for hosting (Render's free tier sleeps, breaking the hourly cron), Instagram DM stays manual/unautomated, Stripe Checkout Sessions (not Payment Links) for the enrollment flow, `cohortes` merged into (replacing) `fechas_inicio`. Don't reopen these without a concrete new reason.

## Frontend (`querify-web/`)

Static HTML/CSS/JS, no framework, no bundler, no npm — edit files directly and open/serve them as-is.

- **`assets/css/styles.css`** — all design tokens (colors, fonts, radii, shadows) live in a single `:root` block at the top. Change the palette/typography only there. Light theme, primary blue `#3B82F6`/`#2563EB`, deliberately no glow effects or heavy shadows; fonts are Montserrat (headings), Work Sans (body), IBM Plex Mono (code-like details).
- **`assets/js/app.js`** — mobile nav toggle, dynamic footer year, the lead form, and the inscripción (apartar lugar) form. The lead form's client-side validation mirrors (but does not replace) the backend's server-side validation in `routes.js` (name required, phone-length table per country code in `PHONE_LEN`, at least one of phone/email, honeypot field `#empresa`); its submission is fire-and-forget: it POSTs to `LEADS_ENDPOINT` (`/api/leads` by default) and redirects to `gracias.html` immediately without waiting for the response — this async UX is an intentional product decision, not an oversight. The inscripción form (`initInscripcionForm`, on `cursos/inscripcion.html`) is deliberately **not** fire-and-forget — it awaits `POST /api/inscripcion` and redirects to the real Stripe Checkout URL (or shows the error, e.g. "sin cupo") because there's a real payment step to hand off to.
- To point the site at a backend hosted separately (not same-origin), change `LEADS_ENDPOINT`/`COHORTES_ENDPOINT`/`INSCRIPCION_ENDPOINT` in `app.js` to the full backend URL and add the site's origin to `CORS_ORIGINS` in the backend's `.env`.
- `cursos/*.html` are the 4 course landing pages, each with real course curriculum content (not placeholder), plus `cursos/inscripcion.html` — one shared page (not per-course) for "apartar mi lugar": cohort/date picker with live cupo (from `GET /api/cohortes/:curso`), the 5-payment plan, and the form that kicks off Stripe Checkout. `inscripcion-gracias.html` (repo root, alongside `gracias.html`) is the post-payment confirmation page.

## Language note

Code comments, commit messages, `ESTADO.md`, and the admin panel UI are in Spanish (Mexico market product). Match that when editing existing Spanish comments/strings; it's fine to write new code comments in either language but stay consistent within a file.
