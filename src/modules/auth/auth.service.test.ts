import { jwtVerify, SignJWT } from 'jose'
import { describe, expect, it } from 'vitest'
import { env } from '../../shared/config/env.js'
import { toPublicUser } from './auth.service.js'
import { signSessionToken, verifySessionToken } from './session.js'

// A signed-up user as the database returns it, and the key the service signs
// with — rebuilt here from the secret, so the tests check against the secret
// itself and not against the code under test.
const user = {
  id: 'c1a2b3c4-0000-4000-8000-000000000001',
  email: 'ana@example.com',
  passwordHash: 'argon2-hash',
  createdAt: new Date(),
  updatedAt: new Date(),
}
const key = new TextEncoder().encode(env.JWT_SECRET)

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

describe('verifySessionToken', () => {
  const now = () => Math.floor(Date.now() / 1000)
  // Every failure is the same 401: the client only needs to know there is no
  // valid session, not which check failed.
  const unauthenticated = { status: 401, code: 'UNAUTHENTICATED' }

  // RF-03 · the identity comes back out of a token this API signed
  it('returns the id and email of a token it signed', async () => {
    const session = await verifySessionToken(await signSessionToken(user))

    expect(session).toEqual({ id: user.id, email: user.email })
  })

  // RF-03 · a token whose payload was edited no longer matches its signature
  it('rejects a token whose payload was altered', async () => {
    const [header, , signature] = (await signSessionToken(user)).split('.')
    const forged = Buffer.from(
      JSON.stringify({ sub: 'someone-else', email: 'eve@example.com' }),
    ).toString('base64url')

    await expect(
      verifySessionToken(`${header}.${forged}.${signature}`),
    ).rejects.toMatchObject(unauthenticated)
  })

  // RF-03 · a token signed with any other secret is not ours
  it('rejects a token signed with another secret', async () => {
    const token = await new SignJWT({ email: user.email })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode('another-secret-at-least-32-chars!!'))

    await expect(verifySessionToken(token)).rejects.toMatchObject(
      unauthenticated,
    )
  })

  // RF-02a · issued nine hours ago, expired one hour ago
  it('rejects an expired token', async () => {
    const token = await new SignJWT({ email: user.email })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuedAt(now() - 9 * 60 * 60)
      .setExpirationTime(now() - 60 * 60)
      .sign(key)

    await expect(verifySessionToken(token)).rejects.toMatchObject(
      unauthenticated,
    )
  })

  // RF-03 · the log should be able to tell an expired token from a forged one
  it("names the failure in the error's message, for the log, not the client", async () => {
    const expired = await new SignJWT({ email: user.email })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuedAt(now() - 9 * 60 * 60)
      .setExpirationTime(now() - 60 * 60)
      .sign(key)

    await expect(verifySessionToken(expired)).rejects.toThrow(
      /No valid session: .+/,
    )
    await expect(verifySessionToken('not-a-token')).rejects.toThrow(
      /No valid session: .+/,
    )
  })

  // RF-03 · correctly signed, but not the shape this API issues
  it('rejects a signed token without an email', async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(user.id)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key)

    await expect(verifySessionToken(token)).rejects.toMatchObject(
      unauthenticated,
    )
  })

  // RF-03
  it('rejects something that is not a token', async () => {
    await expect(verifySessionToken('not-a-token')).rejects.toMatchObject(
      unauthenticated,
    )
  })
})
