import { jwtVerify } from 'jose'
import { describe, expect, it } from 'vitest'
import { env } from '../../shared/config/env.js'
import { signSessionToken, toPublicUser } from './auth.service.js'

describe('toPublicUser', () => {
  // RNF-01 · the hash never leaves, not even in the shape of the response
  it('drops the password hash off the user record', () => {
    const user = {
      id: 'u1',
      email: 'ana@example.com',
      passwordHash: 'argon2-hash',
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    expect(toPublicUser(user)).toEqual({ id: 'u1', email: 'ana@example.com' })
  })
})

describe('signSessionToken', () => {
  const user = {
    id: 'c1a2b3c4-0000-4000-8000-000000000001',
    email: 'ana@example.com',
    passwordHash: 'argon2-hash',
    createdAt: new Date(),
    updatedAt: new Date(),
  }
  const key = new TextEncoder().encode(env.JWT_SECRET)

  // RF-02a · an identity card, not a copy of the record
  it('carries only the user id and the email', async () => {
    const { payload } = await jwtVerify(await signSessionToken(user), key)

    expect(Object.keys(payload).sort()).toEqual(['email', 'exp', 'iat', 'sub'])
    expect(payload.sub).toBe(user.id)
    expect(payload.email).toBe(user.email)
  })

  // RF-02a
  it('expires 8 hours after it is issued', async () => {
    const { payload } = await jwtVerify(await signSessionToken(user), key)

    expect(payload.exp! - payload.iat!).toBe(8 * 60 * 60)
  })
})
