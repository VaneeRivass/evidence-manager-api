import request from 'supertest'
import { afterAll, describe, expect, it } from 'vitest'
import { app } from '../../app.js'
import { signSessionToken } from './session.js'
import {
  expiredToken,
  listen,
  sampleUser as user,
  sessionCookieOf,
  tamperedToken,
  withSession,
} from '../../../tests/helpers.js'

// Exercises the real app: authRouter, its middlewares and app.ts wired
// together, not a stand-in router. Only what never reaches the database:
// /auth/me and /auth/logout need a signed token alone (RF-03, RF-04), and an
// invalid body is refused before any query.
const server = await listen(app)
afterAll(() => server.close())

describe('POST /auth/register', () => {
  const register = (email: string, password: string) =>
    request(server).post('/auth/register').send({ email, password })

  // RF-01 · proves validation is wired onto the real route, and that it
  // names every offending field
  it('answers 400 naming each invalid field', async () => {
    const res = await register('not-an-email', 'short')

    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      errors: [
        { field: 'email', code: 'INVALID_FORMAT' },
        { field: 'password', code: 'TOO_SHORT', params: { min: 8 } },
      ],
    })
  })

  // RF-01b · RF-23 · the client needs the limit to say "72 at most"
  it('answers 400 with the byte limit for a password over 72 bytes', async () => {
    const res = await register('ana@example.com', 'a'.repeat(73))

    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      errors: [{ field: 'password', code: 'TOO_LONG', params: { max: 72 } }],
    })
  })
})

describe('GET /auth/me', () => {
  // RF-03 · proves requireAuth is wired onto the real route, not just onto
  // require-auth.test.ts's throwaway app
  it('answers 200 with the session', async () => {
    const token = await signSessionToken(user)

    const res = await request(server)
      .get('/auth/me')
      .set('Cookie', withSession(token))

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ id: user.id, email: user.email })
  })

  // RF-03
  it('answers 401 without a session cookie', async () => {
    const res = await request(server).get('/auth/me')

    expect(res.status).toBe(401)
    expect(res.body).toMatchObject({ code: 'UNAUTHENTICATED' })
  })

  // RF-03 · RF-02a · a bad token is the same 401 as no token at all
  it.each([
    ['a tampered token', tamperedToken],
    ['an expired token', expiredToken],
  ])('answers 401 with %s', async (_case, tokenFor) => {
    const res = await request(server)
      .get('/auth/me')
      .set('Cookie', withSession(await tokenFor()))

    expect(res.status).toBe(401)
    expect(res.body).toMatchObject({ code: 'UNAUTHENTICATED' })
  })
})

describe('POST /auth/logout', () => {
  // RF-04 · proves the real route clears the cookie with attributes a
  // browser will actually honour, not just that clearCookie was called
  it('answers 204 and clears the session cookie', async () => {
    const token = await signSessionToken(user)

    const res = await request(server)
      .post('/auth/logout')
      .set('Cookie', withSession(token))

    expect(res.status).toBe(204)
    // Same attributes as login set: a browser ignores a clear that differs
    expect(sessionCookieOf(res)).toMatchObject({
      value: '',
      expires: new Date(0),
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
    })
  })

  // RF-04
  it('answers 401 without a session cookie', async () => {
    const res = await request(server).post('/auth/logout')

    expect(res.status).toBe(401)
    expect(res.body).toMatchObject({ code: 'UNAUTHENTICATED' })
  })

  // RF-04 · the known limitation "The token cannot be revoked", pinned down:
  // if this starts failing, revocation was added and the docs must change
  it('leaves a copy of the token working until it expires', async () => {
    const cookie = withSession(await signSessionToken(user))

    await request(server).post('/auth/logout').set('Cookie', cookie)
    const res = await request(server).get('/auth/me').set('Cookie', cookie)

    expect(res.status).toBe(200)
  })
})
