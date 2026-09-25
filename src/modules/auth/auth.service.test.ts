import { describe, expect, it } from 'vitest'
import { toPublicUser } from './auth.service.js'

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
