import { config } from 'dotenv'
import { defineConfig } from 'vitest/config'

// Read directly, not through src/shared/config/env.ts: that module validates
// DATABASE_URL, and here the point is to set it before anything imports it.
config()

// Two kinds of test, told apart by whether they use the database. See the
// Testing section of CLAUDE.md.
export default defineConfig({
  test: {
    env: {
      // The log would bury the test report.
      LOG_LEVEL: 'silent',
      // A fixed secret, so importing app.ts passes the environment check (RNF-11).
      JWT_SECRET: 'test-secret-at-least-thirty-two-chars',
      // The tests expect the default 8 hours, whatever a local .env sets it
      // to while watching a session expire.
      SESSION_TTL_SECONDS: String(8 * 60 * 60),
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          // Only the sources: `npm run build` leaves compiled copies in dist/.
          include: ['src/**/*.test.ts'],
          env: {
            // Points nowhere: a unit test that queries by mistake fails with a
            // refused connection instead of touching a real database. An IP,
            // not a host name, so not even a DNS lookup leaves the machine.
            DATABASE_URL: 'postgresql://127.0.0.1:1/none',
          },
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          setupFiles: ['./tests/integration-setup.ts'],
          // They share one database: two files at once would empty each
          // other's tables mid-test.
          fileParallelism: false,
          env: {
            // The app connects to whatever DATABASE_URL says and never reads
            // TEST_DATABASE_URL, so here DATABASE_URL gets the test database.
            DATABASE_URL: process.env.TEST_DATABASE_URL,
          },
        },
      },
    ],
  },
})
