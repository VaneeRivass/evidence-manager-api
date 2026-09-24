import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The log would bury the test report.
    env: { LOG_LEVEL: 'silent' },
  },
})
