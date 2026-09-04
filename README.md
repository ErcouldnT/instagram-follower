# Instagram Follower

Captures a public Instagram profile's **following** and **followers** lists into
SQLite, then diffs captures over time to show who was gained and lost — and who
never followed back.

Both lists are captured in a single scan on purpose: the questions worth asking
span them. "Follows them but is not followed back" cannot be answered from
either list alone.

Multi-user: each account signs in with an email and password and sees only its
own scans. Because every account shares one Instagram session, scans run **one
at a time** in a global queue, with live position and progress over SSE.

## Stack

|            |                                                 |
| ---------- | ----------------------------------------------- |
| Framework  | SvelteKit 2 + Svelte 5 (runes), `adapter-node`  |
| Language   | TypeScript 6, strict — no `.js`/`.mjs` sources  |
| Database   | SQLite via Drizzle ORM + `better-sqlite3`       |
| Migrations | `drizzle-kit generate` only, applied at boot    |
| Styling    | Tailwind CSS 4 (`@tailwindcss/vite`)            |
| Build      | Vite 8                                          |
| Tooling    | ESLint 10 (flat config), Prettier 3, Playwright |

## Getting started

```bash
npm install
cp .env.example .env
# set BETTER_AUTH_SECRET (openssl rand -base64 32) and IG_COOKIE
npm run dev
```

Then open the app and create an account at `/signup`.

The database file is created automatically at `DATABASE_PATH` (default
`./data/app.db`) and migrations are applied on boot.

### Instagram credentials

The private endpoints this app uses need a logged-in session, supplied as
`IG_COOKIE` — the entire `Cookie:` request header from a logged-in
`instagram.com` tab.

**With an extension (easiest).** [Cookie-Editor](https://cookie-editor.com/) is
open source (GPL-3.0, [source](https://github.com/moustachauve/cookie-editor))
and exports straight to the format needed:

| Browser                       | Install                                                                                                     |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Chrome / Edge / Brave / Opera | [Chrome Web Store](https://chromewebstore.google.com/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm) |
| Firefox                       | [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/cookie-editor/)                            |

Open `instagram.com` while logged in, click the extension, then
**Export → Header String**. That copies exactly what `IG_COOKIE` expects.

**Without an extension.** DevTools → Network tab → reload the page → click any
request to `instagram.com` → Request Headers → copy the whole `cookie:` value.

> A cookie export is a full login. It is not a password — it bypasses 2FA and
> stays valid until Instagram invalidates the session. Only ever install a
> cookie extension you can verify, never paste the value anywhere but this
> app's environment, and log the session out of Instagram to revoke it.

Credentials are read through `$env/dynamic/private`, so rotating a cookie is a
restart — not a rebuild.

## Accounts and privacy

Sign-up is email + password through Better Auth. There is no email
verification, because no mail transport is configured — enable
`requireEmailVerification` in `src/lib/server/auth.ts` once SMTP exists.

Scans belong to the account that started them. Ownership is part of the SQL
predicate on every read and delete, not a check applied afterwards, so another
user's scan id returns 404 rather than their data. `src/hooks.server.ts` guards
every route that is not explicitly public, which makes a newly added route
private by default.

**`BETTER_AUTH_SECRET` is required in production.** Without it the app refuses
to start rather than falling back to an ephemeral secret that would sign
everyone out on each restart.

> Everyone on an instance shares one Instagram session — the `IG_COOKIE`. A
> user's scans are private to them, but every scan is performed _as_ whoever
> owns that cookie. Only give accounts to people you would hand the session to.

### Tests

```bash
npx playwright install chromium   # once
npm test
```

The suite covers the auth guards, cross-account isolation (one account gets a
404 for another's scan id), and the queue reporting positions over SSE. It runs
against a throwaway database with a deliberately invalid `IG_COOKIE`, so scans
reach the queue and then fail fast at Instagram without needing a real session.

## The scan queue

One scan runs at a time across the whole instance. Two scans at once would
double the request rate against the single shared Instagram session, which is
exactly what gets it rate limited or banned.

Waiting scans are stored with status `queued` and ordered by creation time, so
a redeploy does not lose anyone's place. A scan caught mid-flight by a restart
goes back to the **front** of the queue and its partial rows are deleted first —
the final tallies are derived from the table, so leftovers would inflate them.

Live state arrives over server-sent events at `/api/events`. EventSource
reconnects on its own, which matters when a scan can sit in the queue for a
long time. The stream is projected per user: you see your own scans in full,
and other people's only as a count of how many are waiting and whether the
runner is busy.

## Scripts

| Script                        | Purpose                                       |
| ----------------------------- | --------------------------------------------- |
| `npm run dev`                 | Dev server                                    |
| `npm run build` / `npm start` | Production build and run                      |
| `npm run check`               | `svelte-check` typecheck                      |
| `npm run lint` / `format`     | Prettier + ESLint                             |
| `npm run db:generate`         | Generate a migration after editing the schema |
| `npm run db:studio`           | Browse the database                           |
| `npm test`                    | Playwright end-to-end suite                   |

## Database

Schema lives in `src/lib/server/db/schema.ts`. **All schema changes go through
Drizzle migrations** — edit the schema, then:

```bash
npm run db:generate
```

Never hand-write SQL in `drizzle/` and never run `drizzle-kit migrate` or
`push`; the app applies pending migrations itself at startup
(`src/hooks.server.ts`).

Two tables:

- **`scans`** — one capture. Records which lists were walked
  (`captured_following` / `captured_followers`), the authoritative counts, and
  `reported_*_count` (what Instagram claimed, kept only for drift diagnostics).
- **`instagram_users`** — one row per account per scan, with `in_following` and
  `in_followers` flags. `ON DELETE CASCADE` from the scan, unique on
  `(scan_id, instagram_user_id)`.

Those two flags are what the relationship views are built from:

| View                | Predicate                           |
| ------------------- | ----------------------------------- |
| Mutual              | `in_following AND in_followers`     |
| Doesn't follow back | `in_following AND NOT in_followers` |
| Not followed back   | `in_followers AND NOT in_following` |

They are relative to the **scanned profile**, not to whichever session cookie is
configured.

## Deployment (Coolify)

Deploy as a **Docker Compose** resource pointing at `docker-compose.yml`.

Set these in Coolify's environment:

| Variable    | Notes                                                                                                            |
| ----------- | ---------------------------------------------------------------------------------------------------------------- |
| `IG_COOKIE` | Required. The whole cookie header.                                                                               |
| `ORIGIN`    | Required. Public URL, e.g. `https://follower.example.com`. Without it SvelteKit's CSRF check rejects form posts. |

The compose file publishes no host port — Coolify's proxy reaches the container
directly and terminates TLS for the domain.

The SQLite file lives on the named volume `instagram-follower-data` mounted at
`/data`, so it survives redeploys. The image is built for the host's
architecture and compiles `better-sqlite3` from source if no arm64 prebuild
matches.

## Notes and caveats

**This scrapes private Instagram endpoints.** They are undocumented and can
change without notice. The app uses the `/api/v1/friendships/{id}/following`
and `/followers` routes, which paginate with an opaque `max_id` cursor and
authenticate via the `X-IG-App-ID` header.

> An earlier version used the legacy `/graphql/query/?query_hash=…` endpoint.
> Those hashes were build artefacts of Instagram's own bundle and rotated
> without warning, so they needed environment overrides to stay working. The
> `/api/v1` routes take no such parameter — there is nothing left to rotate,
> and the `IG_QUERY_HASH_*` variables are gone.

- Scanning is deliberately slow (jittered ~1s between pages, a 10s pause every
  5 pages) and never concurrent. Removing those delays, or the queue, gets the
  session rate-limited or banned.
- Capturing both lists doubles the requests sent to Instagram. Either list can
  be switched off per scan, at the cost of the cross-list views.
- Each list is capped at `MAX_PAGES` (2000) pages.

**Sign-up is open by default.** Anyone who can reach the instance can create an
account and scan using your Instagram session. Put it behind Coolify's auth or a
private network if that is not what you want.
