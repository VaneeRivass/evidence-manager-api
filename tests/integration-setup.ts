import { beforeAll, beforeEach } from 'vitest'
import { registerUser } from '../src/modules/auth/auth.service.js'
import { prisma } from '../src/shared/database/prisma.js'

// Integration tests only: vitest.config.ts runs this before each of their
// files. Nothing here connects on import, so the check below runs before the
// first query.

// Every test empties every table, so the database the app is about to use must
// be named as a test one. Checked on the name, not on where the value came
// from: a TEST_DATABASE_URL copied from the `_dev` line is refused too.
const url = process.env.DATABASE_URL ?? ''
const database = URL.canParse(url) ? new URL(url).pathname.slice(1) : ''

if (!database.endsWith('_test')) {
  throw new Error(
    `Integration tests empty every table, so they run only against a database whose name ends in _test (got "${database}"). Set TEST_DATABASE_URL in .env (see .env.example) and run npm run db:up.`,
  )
}

// Read from the database, not listed by hand: a new table is covered the day
// its migration lands. Built once per file: the schema does not change during
// a run.
let truncateAll: string

beforeAll(async () => {
  // The first query of the file: if PostgreSQL is not up, it fails here, and
  // Vitest would print Prisma's error with its message cut off.
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `.catch((error: unknown) => {
    throw new Error(
      `Could not query the test database "${database}". Is PostgreSQL running? Start it with npm run db:up.`,
      { cause: error },
    )
  })
  if (tables.length === 0) {
    throw new Error('The test database has no tables: run npm run db:up')
  }

  const names = tables.map(({ tablename }) => `"${tablename}"`).join(', ')
  truncateAll = `TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`
})

// See docs/adr/0006 · a test's data never leaks into the next one, and no
// test depends on a shared seed.
beforeEach(async () => {
  await prisma.$executeRawUnsafe(truncateAll)
})

// An account that already exists, for tests about what happens next — signing
// in, a duplicate email — so they skip the /auth/register round trip.
// Registered through the service, so it is stored exactly as a real sign-up
// stores it.
export async function createUser(): Promise<{
  email: string
  password: string
}> {
  const email = `${crypto.randomUUID()}@example.com`
  const password = 'correct horse battery staple'
  await registerUser({ email, password })

  return { email, password }
}
