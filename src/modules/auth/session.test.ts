import { jwtVerify } from 'jose'
import { describe, expect, it } from 'vitest'
import {
  expiredToken,
  sampleUser as user,
  sessionKey as key,
  signToken,
  tamperedToken,
} from '../../../tests/helpers.js'
import { signSessionToken, verifySessionToken } from './session.js'

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
    await expect(
      verifySessionToken(await tamperedToken()),
    ).rejects.toMatchObject(unauthenticated)
  })

  // RF-03 · a token signed with any other secret is not ours
  it('rejects a token signed with another secret', async () => {
    const token = await signToken({
      key: new TextEncoder().encode('another-secret-at-least-32-chars!!'),
    })

    await expect(verifySessionToken(token)).rejects.toMatchObject(
      unauthenticated,
    )
  })

  // RF-03 · the right secret is not enough: the token does not get to choose
  // its own algorithm, only HS256 is accepted
  it('rejects a token signed with the right secret but another algorithm', async () => {
    const token = await signToken({ alg: 'HS512' })

    await expect(verifySessionToken(token)).rejects.toMatchObject(
      unauthenticated,
    )
  })

  // RF-02a
  it('rejects an expired token', async () => {
    await expect(
      verifySessionToken(await expiredToken()),
    ).rejects.toMatchObject(unauthenticated)
  })

  // RF-03 · the log should be able to tell an expired token from a forged one
  it("names the failure in the error's message, for the log, not the client", async () => {
    await expect(verifySessionToken(await expiredToken())).rejects.toThrow(
      /No valid session: .+/,
    )
    await expect(verifySessionToken('not-a-token')).rejects.toThrow(
      /No valid session: .+/,
    )
  })

  // RF-03 · correctly signed, but not the shape this API issues
  it('rejects a signed token without an email', async () => {
    const token = await signToken({ payload: {} })

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
