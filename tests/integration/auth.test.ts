import request from 'supertest'
import { afterAll, describe, expect, it } from 'vitest'
import { app } from '../../src/app.js'
import { prisma } from '../../src/shared/database/prisma.js'
import type { Session } from '../../src/modules/auth/session.js'
import { createUser } from '../integration-setup.js'
import { listen, problemOf, sessionCookieOf, withSession } from '../helpers.js'

// Exercises the real app: authRouter, its middlewares and app.ts wired
// together, not a stand-in router. What never reaches the database — /auth/me,
// /auth/logout, an invalid body — is in src/modules/auth/auth.routes.test.ts.
const server = await listen(app)
afterAll(() => server.close())

const register = (email: string, password = 'una-clave-larga') =>
  request(server).post('/auth/register').send({ email, password })

const login = (email: string, password: string) =>
  request(server).post('/auth/login').send({ email, password })

describe('POST /auth/register', () => {
  // RF-01
  it('answers 201 with the new user, never the password hash', async () => {
    const res = await register('nueva@example.com')
    const body = res.body as Session

    expect(res.status).toBe(201)
    expect(Object.keys(body).sort()).toEqual(['email', 'id'])
    expect(body.email).toBe('nueva@example.com')
  })

  // RF-01 · the password is stored only as an argon2 hash
  it('stores the password as a hash, never as sent', async () => {
    await register('nueva@example.com', 'una-clave-larga')

    const stored = await prisma.user.findUniqueOrThrow({
      where: { email: 'nueva@example.com' },
    })

    expect(stored.passwordHash).not.toContain('una-clave-larga')
    expect(stored.passwordHash).toMatch(/^\$argon2id\$/)
  })

  // RF-01
  it('answers 409 for an email already registered', async () => {
    const { email } = await createUser()

    const res = await register(email, 'otra-clave-larga')

    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({ code: 'EMAIL_TAKEN' })
  })

  // RF-01a · Ana@x.com and ana@x.com are the same account
  it('answers 409 for the same email in different capitals', async () => {
    await register('ana@example.com')

    const res = await register('ANA@Example.com')

    expect(res.status).toBe(409)
  })

  // RF-01 · both pass the lookup; the unique index decides, and the loser
  // gets a 409, never a 500
  it('answers 201 to one and 409 to the other when two register at once', async () => {
    const responses = await Promise.all([
      register('carrera@example.com'),
      register('carrera@example.com'),
    ])

    expect(responses.map((res) => res.status).sort()).toEqual([201, 409])
  })
})

describe('POST /auth/login', () => {
  // RF-02
  it('answers 200 with who signed in, never the password hash', async () => {
    const { email, password } = await createUser()

    const res = await login(email, password)
    const body = res.body as Session

    expect(res.status).toBe(200)
    expect(Object.keys(body).sort()).toEqual(['email', 'id'])
    expect(body.email).toBe(email)
  })

  // RNF-03 · RF-02a · unreadable from JavaScript, HTTPS only, not sent by
  // another site's form, and gone after one working day
  it('sets the session cookie HttpOnly, Secure, SameSite=Lax, for 8 hours', async () => {
    const { email, password } = await createUser()

    const cookie = sessionCookieOf(await login(email, password))

    expect(cookie?.value).not.toBe('')
    expect(cookie).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 8 * 60 * 60,
    })
  })

  // RF-02 · the email is normalised before the lookup too
  it('signs in with the email in other capitals and spaces around it', async () => {
    await register('ana@example.com', 'una-clave-larga')

    const res = await login('  ANA@Example.com ', 'una-clave-larga')

    expect(res.status).toBe(200)
  })

  // RF-02
  it('answers 401 for the wrong password', async () => {
    const { email } = await createUser()

    const res = await login(email, 'not-the-right-password')

    expect(res.status).toBe(401)
    expect(res.body).toMatchObject({ code: 'INVALID_CREDENTIALS' })
  })

  // RF-02 · an unknown email must not be distinguishable from a wrong
  // password: same status, same code, same fields — only requestId differs
  it('answers the same 401 body for an unknown email as for a wrong password', async () => {
    const { email } = await createUser()

    const wrongPassword = problemOf(
      await login(email, 'not-the-right-password'),
    )
    const unknownEmail = problemOf(
      await login('nadie@example.com', 'not-the-right-password'),
    )

    expect(unknownEmail.problem).toEqual(wrongPassword.problem)
    // Two requests, two ids: the bodies above were really compared apart.
    expect(unknownEmail.requestId).not.toBe(wrongPassword.requestId)
  })
})

describe('a whole session', () => {
  // RF-01 → RF-04 · the cookie /login issues is the one /me accepts: every
  // other test signs its own token, so only this one proves the two agree
  it('registers, signs in, reads the session with the issued cookie, and signs out', async () => {
    const registered = await register('flujo@example.com', 'una-clave-larga')
    expect(registered.status).toBe(201)

    const signedIn = await login('flujo@example.com', 'una-clave-larga')
    const cookie = withSession(sessionCookieOf(signedIn)?.value ?? '')

    const me = await request(server).get('/auth/me').set('Cookie', cookie)
    expect(me.status).toBe(200)
    expect(me.body).toEqual(registered.body)

    const out = await request(server).post('/auth/logout').set('Cookie', cookie)
    expect(out.status).toBe(204)
  })
})
