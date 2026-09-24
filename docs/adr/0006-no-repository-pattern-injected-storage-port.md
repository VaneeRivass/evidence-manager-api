# ADR-0006 · No repository pattern, with an injected storage port

**Status:** accepted · **Date:** 2026-09-22

## Context

Two external dependencies: PostgreSQL and Cloudflare R2. The widespread habit is to wrap
both behind an abstraction of one's own — a repository for the database, a client for
storage — so they can be substituted in tests.

There is an established rule about this: **do not mock what you do not own** (Freeman and
Pryce, *Growing Object-Oriented Software, Guided by Tests*, 2009). "Own" means *you wrote
that type*, not *it is your service*. Neither `PrismaClient` nor `S3Client` is ours, so
neither should be mocked directly.

The question, then, is not whether to abstract everything or nothing, but **what to do in
each case**.

## Decision

The criterion is whether the real dependency can be run locally:

| Dependency | Runs locally? | What is done |
|---|---|---|
| PostgreSQL | **Yes**, `docker compose up` | The real one is used, in tests too |
| Cloudflare R2 | **No**: credentials, network and cost | A port of our own, substituted |

So: **services call Prisma directly, with no repository layer**, and storage is used
through an interface of ours with two implementations, one against R2 and one in memory for
tests.

And one detail decides whether the port is real or decorative: **the dependency is
injected, not imported.**

```ts
// ❌ The service picks its own dependency: nothing is substitutable
import { r2Storage } from './r2-storage.adapter.js'

// ✅ It is handed in
export function createFilesService(storage: StoragePort) { … }
```

Wiring happens in one place: the application passes the real implementation, the tests pass
the double.

## Alternatives considered

**A repository pattern over Prisma.** Prisma is already the abstraction over the database;
wrapping it in an object that re-exposes its own types adds indirection with no gain. The
usual argument in favour is testability, and it does not apply here: **mocking the database
produces green tests over queries that would fail in production**. A fake repository does
not know whether the column exists, or whether the owner filter is present.

**Full hexagonal architecture**, with ports for every dependency. That would mean spending
the first two days on structure instead of features, for a CRUD of twelve endpoints. It is
the over-engineering that the simplicity criterion itself warns against.

**No abstraction at all, not even for storage.** It would force signing real URLs against
Cloudflare on every test run: slow, requiring credentials in continuous integration, and
dependent on the network.

## Consequences

**In favour.** Less code and one fewer indirection. Integration tests walk the whole chain
— route, middlewares, service, Prisma, real PostgreSQL — so a badly written filter fails
the test. And storage is substituted in milliseconds, with no credentials and no network.

**Against.** Services are coupled to Prisma: changing ORM would mean touching all of them.
This is accepted because changing ORM is not a foreseeable scenario, and because a
repository would not fully prevent it either — its return types would still be Prisma's.

**And an operational consequence:** tests need PostgreSQL running. That is why the project
includes `docker compose` and continuous integration starts a container with the same
image.
