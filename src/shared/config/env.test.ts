import { describe, expect, it } from 'vitest'
import { parseEnv } from './env.js'

const valid = {
  DATABASE_URL: 'postgresql://localhost:5432/db',
  JWT_SECRET: 'a'.repeat(32),
}

describe('parseEnv', () => {
  // RNF-11 · the process refuses to start, and says which variable is missing
  it('fails naming DATABASE_URL when it is missing', () => {
    expect(() => parseEnv({ JWT_SECRET: valid.JWT_SECRET })).toThrow(
      /DATABASE_URL/,
    )
  })

  // RNF-11 · a short secret can be brute-forced offline from a single token
  it('fails naming JWT_SECRET when it is under 32 characters', () => {
    expect(() => parseEnv({ ...valid, JWT_SECRET: 'a'.repeat(31) })).toThrow(
      /JWT_SECRET/,
    )
  })

  // RNF-11 · a typo in the log level is caught at boot, not ignored
  it('fails on a log level that does not exist', () => {
    expect(() => parseEnv({ ...valid, LOG_LEVEL: 'verbose' })).toThrow(
      /LOG_LEVEL/,
    )
  })

  // RF-02a · 8 hours unless an environment says otherwise
  it('fills the optional variables with their defaults', () => {
    expect(parseEnv(valid)).toMatchObject({
      PORT: 3001,
      SESSION_TTL_SECONDS: 8 * 60 * 60,
      LOG_LEVEL: 'info',
    })
  })

  // RF-02a · environment variables are text: the number is read from it
  it('reads the session lifetime from text', () => {
    expect(parseEnv({ ...valid, SESSION_TTL_SECONDS: '60' })).toMatchObject({
      SESSION_TTL_SECONDS: 60,
    })
  })
})
