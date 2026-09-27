import { describe, expect, it } from 'vitest'
import { parseEnv } from './env.js'

const valid = {
  DATABASE_URL: 'postgresql://localhost:5432/db',
  JWT_SECRET: 'a'.repeat(32),
  S3_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
  S3_BUCKET: 'evidence-manager',
  S3_ACCESS_KEY_ID: 'access-key',
  S3_SECRET_ACCESS_KEY: 'secret-key',
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

  // RNF-11 · no bucket, no storage: the process refuses to start and names it
  it('fails naming S3_BUCKET when it is missing', () => {
    const withoutBucket: Record<string, string> = { ...valid }
    delete withoutBucket.S3_BUCKET
    expect(() => parseEnv(withoutBucket)).toThrow(/S3_BUCKET/)
  })

  // RNF-11 · an endpoint without its scheme would only fail on the first upload
  it('fails naming S3_ENDPOINT when it is not a URL', () => {
    expect(() =>
      parseEnv({ ...valid, S3_ENDPOINT: 'account.r2.cloudflarestorage.com' }),
    ).toThrow(/S3_ENDPOINT/)
  })

  // RF-10 · MIME types ignore case, so the list is compared in lowercase
  it('lowercases ALLOWED_MIME_TYPES', () => {
    expect(
      parseEnv({ ...valid, ALLOWED_MIME_TYPES: 'image/PNG,Application/PDF' }),
    ).toMatchObject({ ALLOWED_MIME_TYPES: ['image/png', 'application/pdf'] })
  })

  // RF-10 · without a limit, MAX_FILE_SIZE_BYTES silently accepts anything
  it('fills MAX_FILE_SIZE_BYTES with its default of 5 MB', () => {
    expect(parseEnv(valid)).toMatchObject({
      MAX_FILE_SIZE_BYTES: 5 * 1024 * 1024,
    })
  })

  // RF-10 · the allowlist is read as a list, not a single string to split later
  it('splits ALLOWED_MIME_TYPES into a list', () => {
    expect(
      parseEnv({
        ...valid,
        ALLOWED_MIME_TYPES: 'image/jpeg, image/png,application/pdf',
      }),
    ).toMatchObject({
      ALLOWED_MIME_TYPES: ['image/jpeg', 'image/png', 'application/pdf'],
    })
  })

  // RF-10 · the app runs locally with no per-developer configuration, matching .env.example
  it('fills ALLOWED_MIME_TYPES with its default when unset', () => {
    expect(parseEnv(valid)).toMatchObject({
      ALLOWED_MIME_TYPES: ['image/jpeg', 'image/png', 'application/pdf'],
    })
  })

  // RF-10 · an empty allowlist would reject every upload with no way to tell why
  it('fails when ALLOWED_MIME_TYPES is set but empty', () => {
    expect(() => parseEnv({ ...valid, ALLOWED_MIME_TYPES: '' })).toThrow(
      /ALLOWED_MIME_TYPES/,
    )
  })
})
