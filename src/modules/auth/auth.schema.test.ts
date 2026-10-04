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

  // RF-01a · 254 is the longest address SMTP can deliver to
  it('rejects an email over 254 characters', () => {
    const result = registerSchema.safeParse({
      email: `${'a'.repeat(64)}@${'b'.repeat(186)}.com`,
      password: 'longenough1',
    })

    expect(result.success).toBe(false)
  })

  // RF-01b · the lower bound itself is allowed
  it('accepts a password of exactly 8 characters', () => {
    const result = registerSchema.safeParse({
      email: 'a@b.com',
      password: '12345678',
    })

    expect(result.success).toBe(true)
  })

  // RF-01b
  it('rejects a password of 7 characters', () => {
    const result = registerSchema.safeParse({
      email: 'a@b.com',
      password: 'aaaaaaa',
    })

    expect(result.success).toBe(false)
  })

  // RF-01b · characters, not bytes: each of these takes 8 bytes in UTF-8
  it.each([
    ['ññññ', 'four letters'],
    ['😀😀', 'two emoji'],
  ])('rejects %s, %s', (password) => {
    const result = registerSchema.safeParse({ email: 'a@b.com', password })

    expect(result.success).toBe(false)
  })

  // RF-01b · a composed emoji counts each code point: 🚶‍♂️ is 4
  it('counts every code point of a composed emoji', () => {
    const result = registerSchema.safeParse({
      email: 'a@b.com',
      password: '🚶‍♂️🚶‍♂️',
    })

    expect(result.success).toBe(true)
  })

  // RF-01b · characters, not bytes: 64 ñ take 128 bytes, 64 😀 take 256
  it.each(['a', 'ñ', '😀'])(
    'accepts 64 characters of %s and rejects 65',
    (character) => {
      const email = 'a@b.com'

      expect(
        registerSchema.safeParse({ email, password: character.repeat(64) })
          .success,
      ).toBe(true)
      expect(
        registerSchema.safeParse({ email, password: character.repeat(65) })
          .success,
      ).toBe(false)
    },
  )

  // RF-01b · long enough, yet nothing typed
  it.each([' '.repeat(8), '\t\n'.repeat(4)])(
    'rejects a password made only of whitespace (%j)',
    (password) => {
      const result = registerSchema.safeParse({ email: 'a@b.com', password })

      expect(result.error?.issues[0]?.code).toBe('custom')
      expect(result.error?.issues[0]).toHaveProperty(
        'params.code',
        'PASSWORD_BLANK',
      )
    },
  )

  // RF-01b · counted on the NFC form: eight 'é' built from a base and a mark
  // are four characters, too short, though they are eight code points as typed
  it('counts a decomposed accent as one character', () => {
    const email = 'a@b.com'

    expect(
      registerSchema.safeParse({ email, password: 'e\u0301'.repeat(4) })
        .success,
    ).toBe(false)
    expect(
      registerSchema.safeParse({ email, password: 'e\u0301'.repeat(8) })
        .success,
    ).toBe(true)
  })

  // RF-01b · the parsed value is NFC, so the hash is the same either way
  it('normalises the password to NFC', () => {
    const parsed = registerSchema.parse({
      email: 'a@b.com',
      password: 'e\u0301'.repeat(8),
    })

    expect(parsed.password).toBe('é'.repeat(8))
  })

  // RF-01b · a passphrase keeps its spaces, around and inside
  it('keeps the spaces of a password as typed', () => {
    const result = registerSchema.parse({
      email: 'a@b.com',
      password: '  clave segura  ',
    })

    expect(result.password).toBe('  clave segura  ')
  })

  // RF-01b · whitespace too long to be a password is still only whitespace: its
  // own code, one error, never "too long" and "too short" at once
  it('reports whitespace over the maximum as blank', () => {
    const result = registerSchema.safeParse({
      email: 'a@b.com',
      password: ' '.repeat(65),
    })

    expect(result.error?.issues).toHaveLength(1)
    expect(result.error?.issues[0]?.code).toBe('custom')
    expect(result.error?.issues[0]).toHaveProperty(
      'params.code',
      'PASSWORD_BLANK',
    )
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

  // RF-02 · the minimum is registration's, enforced when the password is set
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

  // RF-01b · no account holds a longer password, so a longer text is
  // rejected before it is hashed
  it('accepts a password of 64 characters and rejects one of 65', () => {
    const email = 'a@b.com'

    expect(
      loginSchema.safeParse({ email, password: 'a'.repeat(64) }).success,
    ).toBe(true)
    expect(
      loginSchema.safeParse({ email, password: 'a'.repeat(65) }).success,
    ).toBe(false)
  })
})
