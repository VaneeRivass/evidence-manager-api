import { describe, expect, it } from 'vitest'
import { sampleUser as user } from '../../../tests/helpers.js'
import { toPublicUser } from './auth.service.js'

describe('toPublicUser', () => {
  // RNF-01 · the hash never leaves, not even in the shape of the response
  it('drops the password hash off the user record', () => {
    expect(toPublicUser(user)).toEqual({ id: user.id, email: user.email })
  })
})
