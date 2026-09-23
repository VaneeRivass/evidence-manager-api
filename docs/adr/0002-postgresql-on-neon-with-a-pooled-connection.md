# ADR-0002 · PostgreSQL on Neon, with a pooled connection

**Status:** accepted · **Date:** 2026-09-22

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
DATABASE_URL="postgresql://…@ep-abc-pooler.…/db?sslmode=require&pgbouncer=true"
DIRECT_URL="postgresql://…@ep-abc.…/db?sslmode=require"
```

The first goes through the connection pooler Neon provides: it accepts many client
connections and multiplexes them over a few real ones. The `pgbouncer=true` parameter
disables Prisma's prepared statement cache, which fails when each query may land on a
different connection.

The second is direct and is used only by migrations, through Prisma's `directUrl` field.

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
uses. Forgetting `directUrl` does not break day-to-day development: it breaks migrations,
which is the worst moment to find out. That is why migrations also run in continuous
integration, against an empty database.
