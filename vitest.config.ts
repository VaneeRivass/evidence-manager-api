import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Only the sources: `npm run build` leaves compiled copies of the tests in dist/.
    include: ['src/**/*.test.ts'],
    env: {
      // The log would bury the test report.
      LOG_LEVEL: 'silent',
      // A fixed secret, so importing app.ts passes the environment check (RNF-11).
      JWT_SECRET: 'test-secret-at-least-thirty-two-chars',
    },
  },
})
