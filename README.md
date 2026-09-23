# Evidence Manager API

REST API for managing cases with attached evidence. Authenticated analysts create cases,
attach a file to each, and change its status. **Binaries never pass through this API**: it
issues short-lived presigned URLs and the browser talks to object storage directly.

| | |
|---|---|
| **API** | `<PRODUCTION URL>` |
| **Web client** | `<WEB PRODUCTION URL>` · [repository](https://github.com/VaneeRivass/evidence-manager-web) |
| **API docs** | `<PRODUCTION URL>/openapi.json` |
| **Demo account** | `<EMAIL>` / `<PASSWORD>` |

---

## Stack

| | |
|---|---|
| Runtime | Node.js 22 · TypeScript, strict |
| HTTP | Express 5 |
| Database | PostgreSQL on Neon · Prisma |
| Storage | Cloudflare R2, through the AWS S3 SDK |
| Validation | Zod — one schema is the validator, the type and the OpenAPI source |
| Identity | argon2 · jose · session in an `httpOnly` cookie |
| Logging | pino, structured, with a request identifier |
| Tests | Vitest · Supertest, against a real PostgreSQL |
| Deployment | Vercel |

---

## Architecture decisions

Six decisions, each with the alternatives that were considered and rejected.

| # | Decision | Why, in one line |
|---|---|---|
| [0001](docs/adr/0001-api-in-its-own-repository-deployed-on-vercel.md) | Own repository, deployed on Vercel | Render's free tier sleeps: 30 to 60 seconds on a cold visit |
| [0002](docs/adr/0002-postgresql-on-neon-with-a-pooled-connection.md) | Neon with a pooled connection | Serverless opens one connection pool per instance and exhausts the database |
| [0003](docs/adr/0003-session-cookie-behind-a-proxy.md) | `httpOnly` cookie behind a proxy | A cross-site cookie is blocked by Safari; a proxy makes it first-party and removes CORS |
| [0004](docs/adr/0004-r2-storage-with-upload-verification.md) | R2, and verification with `HeadObject` | A presigned `PUT` does not sign the byte count, so the declared size means nothing |
| [0005](docs/adr/0005-soft-delete-with-hard-file-delete.md) | Soft delete the record, destroy the file | Two systems with no shared transaction: the order decides whether an orphan is possible |
| [0006](docs/adr/0006-no-repository-pattern-injected-storage-port.md) | No repository, injected storage port | Abstract what cannot be run locally; use the real thing when it can |

Full requirements, the endpoint map and the known limitations:
[`docs/requirements.md`](docs/requirements.md).

---

## Running locally

**Prerequisites:** Node.js 22 and Docker.

```bash
git clone https://github.com/VaneeRivass/evidence-manager-api.git
cd evidence-manager-api
npm install

cp .env.example .env          # then fill in the values, see below
docker compose up -d          # PostgreSQL on 5432, two databases

npx prisma migrate dev        # create the schema
npx prisma db seed            # demo account and sample cases

npm run dev                   # http://localhost:3001
curl http://localhost:3001/health
```

### Environment variables

`.env.example` lists every key with placeholder values and **no real credentials**.

| Variable | What it is |
|---|---|
| `DATABASE_URL` | Neon's **pooled** connection string. Ends in `-pooler` and carries `?pgbouncer=true` |
| `DIRECT_URL` | Neon's **direct** connection string. Used only by migrations, which need a stable session |
| `JWT_SECRET` | At least 32 characters. Generate with `openssl rand -base64 32` |
| `S3_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
| `S3_BUCKET` · `S3_ACCESS_KEY_ID` · `S3_SECRET_ACCESS_KEY` | R2 bucket and its API token |
| `MAX_FILE_SIZE_BYTES` | Default `5242880` (5 MB) |
| `ALLOWED_MIME_TYPES` | Default `image/jpeg,image/png,application/pdf` |
| `WEB_ORIGIN` | The front end's origin, for the CORS fallback when the proxy is not in play |

The application **refuses to start** if any of these is missing: a Zod schema over the
environment fails fast. Better a failed deployment than discovering in production that
tokens are being signed with `undefined`.

### The storage bucket

Two settings that are easy to miss and break everything:

- **No public access.** R2 buckets are private by default; do not enable the public
  domain. The only way to read an object is a signed link.
- **CORS**, so the browser may `PUT` directly. Allowed origins: the front end's production
  URL and `http://localhost:3000`. Allowed methods: `PUT`, `GET`.
- **A lifecycle rule** on the `pending/` prefix, expiring after 1 day. That is what removes
  uploads that are never confirmed, with no cleanup process.

---

## Testing the file flow

Four steps, plus the download. The binary goes straight to storage and never touches this
API.

```bash
# 1 · Log in and keep the session cookie
curl -s -c cookies.txt -X POST http://localhost:3001/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"<DEMO EMAIL>","password":"<DEMO PASSWORD>"}'

# 2 · Create a case and keep its id
CASE=$(curl -s -b cookies.txt -X POST http://localhost:3001/cases \
  -H 'Content-Type: application/json' \
  -d '{"title":"Upload flow check","description":"Verifying the three steps"}' \
  | jq -r '.id')

# 3 · Ask for an upload link
curl -s -b cookies.txt -X POST http://localhost:3001/cases/$CASE/file/upload-url \
  -H 'Content-Type: application/json' \
  -d '{"fileName":"evidence.pdf","contentType":"application/pdf","size":120000}'
#    → { "uploadUrl": "...", "key": "pending/...", "expiresIn": 300 }

# 4 · Upload straight to storage. NOT to this API
curl -X PUT "<uploadUrl>" --upload-file evidence.pdf \
  -H 'Content-Type: application/pdf'
#    The Content-Type must be identical to the one that was signed

# 5 · Confirm. This is where HeadObject verifies existence, real size and real type
curl -s -b cookies.txt -X POST http://localhost:3001/cases/$CASE/file/complete \
  -H 'Content-Type: application/json' -d '{"key":"<key>"}'

# 6 · Download, through a link valid for 60 seconds
curl -s -b cookies.txt http://localhost:3001/cases/$CASE/file/download-url
```

**Worth trying:** skip step 4 and call step 5 straight away. It returns `400`, because
confirmation does not trust the client — it asks storage whether the object is actually
there.

---

## Structure

```
src/
├── modules/
│   ├── auth/     routes · controller · service · schema
│   ├── cases/    routes · controller · service · schema · mapper
│   └── files/    routes · controller · service · storage.port · r2-storage.adapter
├── shared/
│   ├── errors/       app-error · error-handler (RFC 9457)
│   ├── middleware/   require-auth · load-owned-case · validate
│   ├── config/       env.ts
│   └── prisma.ts
├── app.ts        builds and exports the app. Never calls listen()
└── server.ts     app.listen()        → local and Render

api/index.ts      export default app  → Vercel
```

Organised by feature rather than by file type: working on cases touches four files that sit
together. The three bootstrap files mean the same application deploys as a function and as
a container, and tests run against the exported app without opening a port.

---

## Scripts

```bash
npm run dev            # port 3001
npm run build
npm test               # Vitest: unit and integration
npm run test:watch
npm run lint
npx tsc --noEmit

npx prisma migrate dev     # create and apply a migration
npx prisma migrate deploy  # apply pending migrations (production and CI)
npx prisma studio          # inspect the database
npx prisma db seed
```

---

## Tests

Integration is the bulk: Supertest against the exported application, walking route,
middlewares, service, Prisma and a real PostgreSQL. The database is not mocked — mocking it
produces green tests over queries that would fail in production. Only storage is
substituted, through its port, because it cannot be run locally.

The tests that matter most are the ones proving a user cannot reach another user's case,
that a deleted case answers `404` even knowing its identifier, and that confirming an
invented key is rejected.

No coverage percentage is chased.

---

## Known limitations

Eight, each with why it is accepted and how it would be resolved, in
[`docs/requirements.md`](docs/requirements.md). The ones worth knowing before reading the
code:

- **The token cannot be revoked.** A stateless JWT, valid for 24 hours. No sign-out
  everywhere.
- **The file contents are not inspected.** Type and size are verified against storage, but
  not the bytes. The file is never served from the application's domain, which is what
  makes the risk acceptable.
- **Rate limiting is approximate.** Its counter lives in each instance's memory, and
  serverless instances share none.
- **One piece of evidence per case**, and two states. Both fixed by the brief.

---

## Use of AI

**Tool:** Claude Code (Claude Opus).

**What it produced:**
- First drafts of the documentation: requirements, architecture decisions, data model
- Scaffolding: configuration files, continuous integration workflow, issue templates
- `<COMPLETE: which parts of the code>`

**What I wrote or rewrote:**
- `<COMPLETE>`

**An error it introduced, and how it was corrected:**
- `<COMPLETE with one from the development log>`

Errors caught during the design phase, before any code was written:

| What it claimed | Why it was wrong |
|---|---|
| "Named exports, never default" | False in Next.js: pages and layouts **require** a default export. The rule would have been broken on day one |
| Middleware order with the ownership check before validation | It spends a database query on every malformed request. Validation is cheaper and goes first |
| `NEXT_PUBLIC_API_URL` for the proxy destination | That prefix inlines the value into the browser bundle. The rewrite runs on the server, so the variable must not be public |
| `middleware.ts` placed inside `app/` | Next does not run it there. The route guard would silently protect nothing |

`<KEEP ADDING as they appear during development>`
