# Evidence Manager API

REST API for the evidence manager. Express 5 + TypeScript + Prisma, deployed as a
serverless function on Vercel. **Binaries never pass through this API**: it issues
presigned URLs and the browser talks to object storage directly.

---

## Specification

Read before writing or changing code:

| Where | What |
|---|---|
| `docs/requirements.md` | `RF-01`…`RF-23`, `RNF-01`…`RNF-11`, the endpoint map, the flows |
| `docs/adr/` | The six architecture decisions and why the alternatives were dropped |
| `prisma/schema.prisma` | The schema. It is the source of truth, not a copy in a document |
| `../docs/` | Internal working notes, in Spanish. Not published |

**Do not answer from memory about requirements or decisions: read them.**

---

## Stack

| | |
|---|---|
| Runtime | Node.js 22 · TypeScript in strict mode |
| HTTP | **Express 5** — it captures async errors on its own; v4 leaves the request hanging |
| Database | PostgreSQL (Neon) + **Prisma 7** through `@prisma/adapter-pg`. Connection strings live in `prisma.config.ts` (CLI) and `src/shared/database/prisma.ts` (runtime), never in `schema.prisma`. The client is generated into `src/generated/prisma` — not committed |
| Storage | `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` against Cloudflare R2 |
| Validation | **Zod** — the schema is the validator, the TypeScript type and the OpenAPI source |
| Identity | **argon2** for hashing · **jose** for signing and verifying tokens |
| Logging | **pino** + `pino-http`, structured, with a request id |
| Tests | **Vitest** + **Supertest** against a real PostgreSQL in Docker |

---

## Structure

```
src/
├── modules/
│   ├── auth/     auth.routes · auth.controller · auth.service · auth.schema · auth.mapper
│   │             session        the session cookie and its token: name, attributes, sign, verify
│   │             require-auth.middleware   requireAuth, the middleware that reads it
│   │             express.d      declares req.user, the session
│   ├── cases/    cases.routes · cases.controller · cases.service · cases.schema · cases.mapper
│   │             require-owned-case.middleware   requireOwnedCase: the case exists, is live, is yours
│   └── files/    files.routes · files.controller · files.schema · files.constants
│                 files.service            ask for an upload link, ask for a download link
│                 confirm-upload.service   confirm an upload (RF-11), and everything that can go wrong
│                 check-upload.middleware  checkDeclaredFile, checkUploadKey: before the case is queried
│                 file-path                where a file sits in storage: built for an upload, resolved on confirmation
│                 files.policy             which files are accepted: allowed type and size, one file per case
├── shared/       infrastructure any module uses, knowing nothing of the business
│   ├── config/       env.ts — a Zod schema over process.env
│   ├── database/     prisma.ts — single client instance
│   ├── errors/       app-error · error-codes · error-handler.middleware (RFC 9457)
│   ├── logging/      logger.ts — pino + pino-http, with redaction
│   ├── storage/      storage.port · r2-storage.adapter · in-memory-storage.adapter (the tests' double):
│   │                 any object store, knowing nothing of cases; link lifetimes come from the caller
│   └── middleware/   validate.middleware — validateBody, validateQuery, validateParams
├── app.ts        createApp(storage) builds the app; `app` is it with R2, the one place storage is chosen. Never calls listen()
└── server.ts     app.listen()        → local and Render

api/index.ts      export default app  → Vercel

tests/
├── helpers.ts             shared by both kinds, no database
├── integration-setup.ts   empties every table before each integration test
└── integration/           auth.test · cases.test · files.test
```

**ESM with `NodeNext`: relative imports end in `.js`**, even when the file is `.ts`
(`import { app } from './app.js'`). Node resolves the compiled file and adds no extension
on its own.

**Organised by feature, not by file type.** Working on cases touches four files that sit
together. **Not hexagonal layers**: see `docs/adr/0006`.

**`shared/` is infrastructure only: what knows nothing of the business.** Whatever belongs
to one feature lives in that module, even when other modules use it — the session is
auth's, `requireAuth` included, and `requireOwnedCase` is cases', though the file routes use
it too. `validate.middleware` stays in `shared/`: it checks any schema and knows no feature.
**Error codes stay central** in `shared/errors/error-codes.ts`: they are the
contract with the client, and one list is what the client switches on. The few functions
that build an error shared by several modules, like `caseNotFound`, stay beside them in
`shared/errors/app-error.ts`, so a service never imports a middleware to throw one.

**Controllers translate HTTP and hold no business rules.** Services hold the rules and know
nothing about `req` or `res`, which is what makes them testable without a server.

---

## Rules that must not be broken

**No repository layer.** Services call Prisma directly. The reason is in `docs/adr/0006`:
tests run against a real database, so an abstraction whose only purpose is to be mocked
would give green tests over broken queries.

**Storage goes through `StoragePort`, injected — never imported.**

```ts
// ❌ not substitutable
import { r2Storage } from './r2-storage.adapter.js'

// ✅
export function createFilesService(storage: StoragePort) { … }
```

A service that also needs the database imports `prisma` and receives the storage —
`deleteCase(ownedCase, storage)`. It is the same rule applied to two dependencies: import what
runs locally, receive what does not.

**Middleware order: cheap before expensive.** A middleware file carries the `.middleware`
suffix, like every other file carries its role.

```ts
router.patch('/:id',
  requireAuth,                 // crypto, no database
  validateParams(idSchema),    // is :id a UUID?     → 400
  validateBody(updateCaseSchema), // read the body, is it valid? → 400 / 413
  requireOwnedCase,            // NOW the query      → 404 / 403
  update,
)
```

Validating after querying wastes a round trip on every malformed request.

**Ownership lives in one middleware.** `requireOwnedCase` filters `deletedAt: null`, throws
`404` when absent and `403` when it belongs to someone else. Never copy that check into a
controller: copied five times it gets forgotten once, and that is the vulnerability.

**404 when it does not exist. 403 when it exists and is not yours.** No ambiguity.

**Every case query filters `deletedAt: null`.** Forgetting it in a single route leaks
deleted records, silently.

**Deleting a case: remove its object from storage FIRST, then touch the database.** If storage fails,
the database is untouched and the user retries — deleting an object that no longer exists
does not fail. The reverse order loses the key before the object, and the orphan is
permanent.

**`POST /cases/:id/file/complete` verifies with `HeadObject`:** the object exists, its real
size is within the limit, its real type is in the allowlist, and the key belongs to
that case and user. If size or type do not match, **delete the object** before rejecting.
A presigned `PUT` signs the address, the method and the content type — **not the byte
count**.

**Uploads land in `pending/` and move on confirmation.** A bucket lifecycle rule deletes
anything left there for 24 hours, so an abandoned upload never becomes a permanent orphan.
There is no cleanup process: serverless has no background jobs.

**Never `multipart/form-data`.** No binary ever enters this process.

**Emails are normalised to lowercase** before storing and before querying. Passwords are
validated between 8 and 64 characters (code points, not bytes) on the NFC form, and one made
only of whitespace is rejected with its own code. Passwords are normalised to NFC before
hashing, so composed and decomposed accents sign in the same.

**Nothing leaves in the database's shape.** Every module maps what it returns through an
explicit mapper that **names the fields that go out**, never the ones it hides: `auth.mapper.ts`
for users, `cases.mapper.ts` for cases. A column added to the schema tomorrow does not leak
on its own. An enum's values are not copied into a validator either: they are read from
`src/generated/prisma/enums.ts`, so a state added to the schema cannot be rejected by a
list someone forgot to update.

**`passwordHash` never leaves.** Not in a response, not in a log. Pino redacts
`authorization`, `cookie`, the response's `set-cookie` (it carries the session token) and
any `password` field.

**Errors follow RFC 9457** with `application/problem+json`, a stable machine-readable code
and the `requestId`. Services throw `NotFound()` or `Forbidden()` and know nothing about
HTTP; one middleware at the end of the chain translates and guarantees no stack trace ever
reaches the client.

**Session JWT in an `HttpOnly; Secure; SameSite=Lax` cookie.** Never `localStorage`.

---

## Commands

```bash
npm run db:up                  # FRESH PostgreSQL every time: recreated, both databases migrated
npm run dev                    # port 3001
npm run build                  # compile to dist/

npx prisma migrate dev         # create a new migration after changing the schema
npx prisma migrate deploy      # apply pending migrations (production and CI)
npx prisma studio              # inspect the database
npx prisma db seed             # demo account (sample cases optional, see #22)

npm test                       # Vitest: unit and integration
npm run test:unit              # no database, no Docker
npm run test:integration       # real PostgreSQL: run npm run db:up first
npm run test:watch
npm run lint
npx tsc --noEmit               # type check without emitting
```

---

## Testing

**Two kinds, told apart by one question: does it use the database?**

| | Unit | Integration |
|---|---|---|
| Uses the database | No | Yes, a real PostgreSQL |
| File name | `*.test.ts` | `*.test.ts` |
| Lives | In `src/`, next to the file it tests | In `tests/integration/`, one file per module |
| Needs Docker | No | Yes |
| Runs | All files at once | **One file at a time** |
| Command | `npm run test:unit` | `npm run test:integration` |

Supertest appears in both: it sends HTTP requests to the app, served by the test itself on
a temporary port of `127.0.0.1` — which is why `app.ts` never calls `listen()`. What makes a
test integration is the database, not Supertest.

**Integration is the bulk.** It exercises the whole chain: route, middlewares, service,
Prisma, real PostgreSQL. A wrong `where` clause fails the test. An integration test may use
other modules to set itself up — the cases tests sign in through `auth` — and is named after
the module it checks: `tests/integration/cases.test.ts`. The folder, not a suffix, says it is
integration: Vitest picks each kind by its path.

**A real database, never a mock.** Every table is emptied before each integration test. The
files run one at a time because they share that one database: two at once would empty each
other's tables mid-test. Each test creates the data it needs; there is no shared seed,
because a test whose data is not visible in the test cannot be read.

**Only the storage is substituted**, through `StoragePort`, because it cannot be run
locally. That is the rule: abstract what you cannot execute, use the real thing when you
can.

**Unit tests never leave the process** — no database, no network, no file system (Michael
Feathers' rule, *Working Effectively with Legacy Code*). A temporary port on `127.0.0.1`
does not count: the request goes out and comes back to the same process. MIME allowlist,
size limit, key sanitising, token signing and verification, DTO mapping, query parameter
parsing — middlewares tested on a throwaway app, like `validateBody` or `requireAuth`, and
routes that never query, like `/auth/me`, tested on the real app.
Their `DATABASE_URL` points nowhere, so a unit test that queries by mistake fails instead
of touching real data.

**The test name is descriptive; the requirement id goes in a comment above it.** When a
test fails you read its name, and `grep RF-07` finds the comment just the same.

**No coverage percentage as a goal.** Three tests proving that authorisation works are
worth more than forty checking accessors.
