# ADR-0001 · API in its own repository, deployed on Vercel

**Status:** accepted · **Date:** 2026-09-22

## Context

The brief asks for independent repositories for the API and the front end, and suggests
deploying the front on Vercel and the API on Render if it does not fit on Vercel. It also
mentions the Prisma connection pool problem in serverless environments, which suggests that
execution model is expected.

Render's free tier suspends a service after fifteen minutes without traffic, and waking it
takes between thirty and sixty seconds. This application will be reviewed by someone who
opens it once, cold.

## Decision

The API is an Express project with TypeScript, in its own repository, deployed on Vercel as
a function.

The application and its bootstrap live in separate files: `src/app.ts` builds and exports
the application without listening on any port; `src/server.ts` starts it for local
development; `api/index.ts` exports it for Vercel.

## Alternatives considered

**Next.js with Route Handlers for everything.** It would have removed both the separate
origins and the third-party cookie problem, but it breaks the repository separation the
brief asks for, and it mixes in one project responsibilities the exercise wants to see
apart.

**Render.** A cold start of nearly a minute would have been the first thing a reviewer saw.
It remains a documented fallback, and thanks to the file separation switching would take
minutes, not a rewrite.

## Consequences

**In favour.** No service that falls asleep. The same application deploys to both models
without touching code. And the tests use Supertest against the exported application, with
no port opened and no process left hanging: the decision that solves deployment also solves
testing.

**Against.** In serverless each instance is an isolated process, so the database connection
pool has to be addressed (ADR-0002) and rate limiting becomes approximate, because its
counter is not shared between instances. The latter is accepted and recorded as a known
limitation.
