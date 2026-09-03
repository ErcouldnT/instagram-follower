# Instagram Follower

Takes a snapshot of a public Instagram profile's **following** or **followers**
list, stores it in SQLite, and diffs two snapshots to show who was gained and lost.

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
cp .env.example .env      # then paste a real IG_COOKIE
npm run dev
```

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

## Scripts

| Script                            | Purpose                                                    |
| --------------------------------- | ---------------------------------------------------------- |
| `npm run dev`                     | Dev server                                                 |
| `npm run build` / `npm start`     | Production build and run                                   |
| `npm run check`                   | `svelte-check` typecheck                                   |
| `npm run lint` / `npm run format` | Prettier + ESLint                                          |
| `npm run db:generate`             | Generate a migration after editing the schema              |
| `npm run db:studio`               | Browse the database                                        |
| `npm test`                        | Playwright tests (`npx playwright install chromium` first) |

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

- **`scans`** — one pagination pass. Carries `relation` (which list was walked),
  `status` (`running` / `completed` / `failed`), the authoritative `count`, and
  `reported_count` (what Instagram claimed, kept only for drift diagnostics).
- **`instagram_users`** — the accounts found, `ON DELETE CASCADE` from the scan,
  with a unique index on `(scan_id, instagram_user_id)`.

## Deployment (Coolify)

Deploy as a **Docker Compose** resource pointing at `docker-compose.yml`.

Set these in Coolify's environment:

| Variable                                 | Notes                                                                                                                             |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `IG_COOKIE`                              | Required. The whole cookie header.                                                                                                |
| `ORIGIN`                                 | Required. Public URL, e.g. `https://follower.example.com`. Without it SvelteKit's CSRF check rejects form posts behind the proxy. |
| `IG_QUERY_HASH_FOLLOWING` / `_FOLLOWERS` | Optional overrides — see below.                                                                                                   |

The compose file publishes no host port — Coolify's proxy reaches the container
directly and terminates TLS for the domain.

The SQLite file lives on the named volume `instagram-follower-data` mounted at
`/data`, so it survives redeploys. The image is built for the host's
architecture and compiles `better-sqlite3` from source if no arm64 prebuild
matches.

## Notes and caveats

**This scrapes private Instagram endpoints.** They are undocumented and change
without notice:

- The **GraphQL query hashes** rotate. When scans start failing with "no
  follower data", grab the current hash from a browser session and set
  `IG_QUERY_HASH_FOLLOWING` / `IG_QUERY_HASH_FOLLOWERS` — no rebuild needed.
- Scanning is deliberately slow (jittered ~1s between pages, a 10s pause every
  5 pages). Removing those delays gets the session rate-limited or banned.
- A scan is capped at `MAX_PAGES` (2000) pages.

**Following ≠ followers.** They are two different lists and the app treats them
as such; a scan records which one it walked and only same-list scans can be
compared.

**There is no authentication.** Anyone who can reach the app can scan with your
Instagram session. Put it behind Coolify's auth or a private network.
