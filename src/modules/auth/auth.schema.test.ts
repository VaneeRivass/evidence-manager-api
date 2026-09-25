import { describe, expect, it } from 'vitest'
import { loginSchema, registerSchema } from './auth.schema.js'

describe('registerSchema', () => {
  // RF-01a
  it('normalises the email to lowercase', () => {
    const result = registerSchema.parse({
      email: 'Ana@Example.com',
      password: 'longenough1',
    })

    expect(result.email).toBe('ana@example.com')
  })

  // RF-01a · a space left by pasting or autofill is not a malformed address
  it('trims the spaces around the email', () => {
    const result = registerSchema.parse({
      email: '  Ana@Example.com ',
      password: 'longenough1',
    })

    expect(result.email).toBe('ana@example.com')
  })

  // RF-01b
  it('rejects a password under 8 bytes', () => {
    const result = registerSchema.safeParse({
      email: 'a@b.com',
      password: 'short',
    })

    expect(result.success).toBe(false)
  })

  // RF-01b
  it('rejects a password over 72 bytes', () => {
    const result = registerSchema.safeParse({
      email: 'a@b.com',
      password: 'a'.repeat(73),
    })

    expect(result.success).toBe(false)
  })

  // RF-01b · bcrypt would read only the first 72 bytes of a longer password
  // and silently discard the rest; the bound must be measured in bytes, not
  // characters, or a multi-byte password would be capped at the wrong length
  it('measures the password bound in bytes, not characters', () => {
    // 'á' is 2 bytes in UTF-8: 36 of them is exactly 72 bytes
    const atBound = registerSchema.safeParse({
      email: 'a@b.com',
      password: 'á'.repeat(36),
    })
    const overBound = registerSchema.safeParse({
      email: 'a@b.com',
      password: 'á'.repeat(37),
    })

    expect(atBound.success).toBe(true)
    expect(overBound.success).toBe(false)
  })
})

describe('loginSchema', () => {
  // RF-02 · the email is normalised before lookup, as it was before storing
  it('normalises the email the same way registration does', () => {
    const result = loginSchema.parse({
      email: '  Ana@Example.com ',
      password: 'whatever',
    })

    expect(result.email).toBe('ana@example.com')
  })

  // RF-02 · the password policy is registration's: a password stored under
  // an older, looser policy must still be able to sign in
  it('accepts a password shorter than the registration minimum', () => {
    const result = loginSchema.safeParse({
      email: 'a@b.com',
      password: 'short',
    })

    expect(result.success).toBe(true)
  })

  // RNF-04
  it('rejects an empty password', () => {
    const result = loginSchema.safeParse({ email: 'a@b.com', password: '' })

    expect(result.success).toBe(false)
  })
})
