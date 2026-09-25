import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Only the sources: `npm run build` leaves compiled copies of the tests in dist/.
    include: ['src/**/*.test.ts'],
    // The log would bury the test report.
    env: { LOG_LEVEL: 'silent' },
  },
})
