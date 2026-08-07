# SmallVille Hotel — Engineering Checklist System

Two web apps over one API and one PostgreSQL database:

| App | Who | Default port | Purpose |
|---|---|---|---|
| `client-staff` | Technicians, on phones | 5173 | Pick an outlet, tick tasks, add comments and photos |
| `client-admin` | You | 5174 | Live dashboard, staff, outlets, tasks, roster, reports |
| `server` | — | 4000 | Express API + Excel/PDF export |

---

## How the checklist actually works

**One run per (staff member, outlet, business date, shift).** That tuple is the
reset unit. When Ahmad opens Penthouse during the PM shift, the API finds or
creates *his* run for Penthouse / today / PM and returns a fresh unticked list.
Next shift, that tuple changes, so he gets a clean list again.

**Which shift is it?** The roster decides first, the clock decides second:

1. If you rostered them for this shift on this date → `rostered`.
2. If you rostered them for a different shift today and now is within 90 minutes
   of its start → their rostered shift (they came early / stayed late).
3. Otherwise → the shift whose time window contains right now, flagged
   `unscheduled`. They can still work; you see the flag on the dashboard.

Nobody is ever locked out by a missing roster entry. If you'd rather they were,
turn off **Allow staff to work without a roster entry** in Settings.

**Night shifts and the date.** A Night shift starting 22:00 on Aug-05 runs to
06:00 on Aug-06. The run's `business_date` is **Aug-05** — the day the shift
started — so the Aug-05 report is complete instead of split in half. Each tick
still stores its true wall-clock time, so a 01:47 check reports as 01:47.

**Task frequency.** Each task is `every shift`, `once a day`, or `once a week`.
Daily and weekly tasks that were already done in the period show up as already
answered, read-only, with who did it and when — so a 60-item list doesn't get
re-done three times a day.

**Ticks save instantly.** Pressing Yes writes immediately with a real timestamp.
Pressing No opens the comment box and will not save until a reason is typed —
that rule is a database CHECK constraint, not just UI, so it can't be bypassed.
Editing an answer keeps the original in `task_answer_history`.

---

## First-time setup

### 1. Install the two things that aren't on this machine yet

- **Node.js 20 LTS or newer** — https://nodejs.org (pick the LTS installer)
- **PostgreSQL 16** — https://www.postgresql.org/download/windows/
  Remember the password you give the `postgres` user.

Confirm both are on PATH (open a **new** terminal after installing):

```bash
node --version && npm --version && psql --version
```

### 2. Backend

```bash
cd server && npm install
```

Copy `.env.example` to `.env` and fill in `PGPASSWORD` and `JWT_SECRET`.
Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Create the database, apply the schema, and seed the 4 outlets / 3 shifts /
starter tasks:

```bash
cd server && npm run db:init
```

Create your admin login (prompts for username and password, nothing is stored
in a file):

```bash
cd server && npm run create-admin
```

Start it:

```bash
cd server && npm start
```

### 3. The two front-ends

In each of `client-staff` and `client-admin`, copy `.env.example` to `.env` and
set `VITE_API_URL` to the **LAN IP** of the server machine — not `localhost`.
A phone resolves `localhost` to itself, so it will never reach your server.

Find the IP:

```bash
ipconfig
```

Look for `IPv4 Address` on your active adapter, e.g. `192.168.1.50`. Then:

```
VITE_API_URL=http://192.168.1.50:4000
```

Install and run:

```bash
cd client-staff && npm install && npm run dev
```

```bash
cd client-admin && npm install && npm run dev
```

### 4. Let phones through the Windows firewall

Run once, as Administrator:

```bash
netsh advfirewall firewall add rule name="SmallVille API" dir=in action=allow protocol=TCP localport=4000
```

```bash
netsh advfirewall firewall add rule name="SmallVille Apps" dir=in action=allow protocol=TCP localport=5173-5174
```

Also add the front-end origins to `CORS_ORIGINS` in `server/.env`:

```
CORS_ORIGINS=http://192.168.1.50:5173,http://192.168.1.50:5174
```

Then restart the API. Staff open `http://192.168.1.50:5173` on their phones and
can "Add to Home Screen" so it behaves like an app.

> Give the server machine a **static / DHCP-reserved IP**. If it changes, every
> phone's bookmark and both `.env` files break at once.

---

## Who can do what

Three roles. The API enforces all of this per route — hiding a button is only a
convenience, never the control.

| | Admin (IT) | HOD | Staff |
|---|---|---|---|
| Staff app — tick checklists | ✔ | ✔ | ✔ |
| Dashboard, Reports, exports | ✔ | ✔ | — |
| Schedule, Tasks, Outlets, Categories | ✔ | ✔ | — |
| Settings + shift times | ✔ | — | — |
| Create / edit **staff** accounts | ✔ | ✔ | — |
| Create / edit **HOD or admin** accounts | ✔ | — | — |
| Change anyone's role | ✔ | — | — |

A HOD runs the department: they schedule the team, maintain the checklists, read
every report, and add technicians. What they cannot do is grant anyone authority
— only IT creates admins and HODs, or promotes an existing account. A HOD who
opens `/settings` directly is redirected; a HOD who calls the API directly gets
a 403.

Existing databases need one migration to allow the new role:

```bash
psql -U postgres -d smallville_engineering -f db/migrations/001_add_hod_role.sql
```

Fresh installs get it from `schema.sql` and need nothing.

## Day-to-day

1. **Staff** → add each technician. Give them a temporary password and leave
   *"Ask them to change it at first sign-in"* ticked.
2. **Outlets** → the four are seeded; add more any time.
3. **Categories** → shared across all outlets. Define "Electrical" once.
4. **Tasks** → pick an outlet, add tasks under categories, reorder with ↑ ↓.
   Use *Copy tasks from another outlet* when a new outlet has the same list.
5. **Roster** → set the week. `Copy this week to next` saves most of the typing.
6. **Dashboard** → live coverage for the current shift, plus every issue raised.
7. **Reports** → pick a date (or range) and a staff member, then read on screen
   or export to Excel / PDF.

---

## Reports

`Reports` → set **From** and **To** to the same day to get exactly "what did this
person do on this date, and at what time".

- **On screen** — every tick, with the real local time, sorted chronologically.
- **Excel** — 3 sheets: full log (colour-coded, auto-filtered), per-staff/outlet
  summary, and a sheet recording exactly which filters produced the file.
- **PDF** — one page per date + shift, formatted for signing or emailing.

---

## Going to production on the hotel server

The `npm run dev` servers are fine for testing but shouldn't be what the team
uses daily. Build static files and serve them:

```bash
cd client-staff && npm run build
```

```bash
cd client-admin && npm run build
```

That produces `dist/` in each. Serve them with IIS, nginx, or `npm run preview`.
Keep the API running with a service manager so it survives reboots — on Windows,
[NSSM](https://nssm.cc/) or `pm2` + `pm2-windows-startup` both work.

**Back up the database.** One scheduled task is enough:

```bash
pg_dump -U postgres smallville_engineering > backup_%DATE%.sql
```

Photos live in `server/uploads/` — back that folder up too.

---

## Project layout

```
db/
  schema.sql          Tables, indexes, triggers, reporting views
  seed.sql            4 outlets, 3 shifts, 5 categories, starter tasks
server/
  scripts/            db:init and create-admin
  src/
    config.js db.js index.js
    middleware/       auth (JWT + bcrypt), error handling
    utils/            shifts.js  ← shift + business-date resolution
                      settings.js, audit.js
    routes/           auth users outlets categories tasks shifts
                      roster runs dashboard reports settings
client-staff/         Vite + React, mobile-first, EN/AR with RTL
client-admin/         Vite + React, sidebar layout, drawer under 900px
```

The one file worth reading before changing anything is
[server/src/utils/shifts.js](server/src/utils/shifts.js) — shift resolution and
the business-date rule live there, and most surprising report behaviour traces
back to it.

---

## Known limitations

- **No offline mode.** A tick needs the network. If wifi drops mid-round the
  button shows an error and the technician retries. Dead spots in the building
  are worth checking before rollout.
- **HTTP, not HTTPS.** Fine on a trusted VLAN; passwords are hashed at rest but
  travel in the clear on the wire. If this ever leaves the LAN, put it behind a
  reverse proxy with TLS first.
- **Photos are served without auth.** Filenames are random UUIDs, but anyone on
  the LAN who has a URL can open it.
- **Never run `npm run db:init` against a database with real data** expecting a
  reset — it skips the schema if tables exist and only re-applies the seed.
