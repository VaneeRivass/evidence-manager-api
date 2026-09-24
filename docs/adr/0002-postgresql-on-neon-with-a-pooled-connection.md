# ADR-0002 · PostgreSQL on Neon, with a pooled connection

**Status:** accepted · **Date:** 2026-09-22 · **Revised:** 2026-09-24, Prisma 7 configuration

## Context

The API is deployed as a function on Vercel (ADR-0001). In that model there is no permanent
process: each request may be served by a freshly created instance running the code from
scratch.

Connecting to PostgreSQL is not like calling an HTTP API. Each connection is a persistent
socket, and on the server side PostgreSQL spawns a dedicated process that consumes memory.
That is why the number of simultaneous connections has a hard limit.

One instance creates its own Prisma client, which opens its own set of connections. With
fifty simultaneous requests, fifty sets are opened, and the database rejects the rest with
"too many clients".

## Decision

Managed PostgreSQL on Neon, using its two connection strings:

```
DATABASE_URL="postgresql://…@ep-abc-pooler.…/db?sslmode=require"
DIRECT_URL="postgresql://…@ep-abc.…/db?sslmode=require"
```

The first goes through the connection pooler Neon provides: it accepts many client
connections and multiplexes them over a few real ones. It is used by the application at
runtime: Prisma 7 connects through a driver adapter, `@prisma/adapter-pg`, which receives
this string when the client is built.

The second is direct and is used only by the Prisma CLI — migrations — through the
`datasource.url` field of `prisma.config.ts`. Migrations need a stable session and schema
locks that a pooler in transaction mode does not guarantee.

Prisma 7 no longer reads connection strings from `schema.prisma`: the `url` and `directUrl`
fields of earlier versions are gone. The split between the two strings is the same; only
where each one is declared has changed.

**Pinned at 7.10.0** — the latest stable release of the 7.x line, not of Prisma overall:
`latest` on npm resolves to an 8.0.0 release candidate. `npm audit` flags 4 high-severity
findings, all transitive dependencies of the Prisma **CLI** (`deepmerge-ts`, `mysql2` for a
connector this project never uses) — none reach `@prisma/client` or `@prisma/adapter-pg`,
what the deployed API imports. The only fix offered downgrades to Prisma 6, which
reintroduces the `directUrl` problem this ADR solves, so the risk is accepted, CLI-only.

## Alternatives considered

**Prisma Accelerate.** Solves the same problem over HTTP and adds query caching, but it is
a paid product, one more vendor in the chain and an extra network hop. The caching is not
needed here.

**Supabase.** Excellent, but it brings authentication, storage and row-level security.
Using it only as a database wastes it; using it fully would consume the very requirements
the exercise asks to implement.

**A direct connection with no pooler.** That is what breaks under load, and it is precisely
the problem the brief points at.

## Consequences

**In favour.** The API scales horizontally without exhausting the database. The free tier
requires no payment method and allows database branches, useful for isolating tests.

**Against.** Two environment variables to maintain, and remembering which one each thing
uses. Pointing `prisma.config.ts` at the pooled string does not break day-to-day
development, where both strings are the same local database: it breaks migrations in
production, which is the worst moment to find out. That is why migrations also run in
continuous integration, against an empty database.
