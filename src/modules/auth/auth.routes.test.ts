import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { app } from '../../app.js'
import { signSessionToken } from './auth.service.js'

// Exercises the real app: authRouter, requireAuth and app.ts wired together,
// not a stand-in router. Neither route queries the database (RF-03, RF-04),
// so a signed token is enough — no register/login round trip needed.
const user = {
  id: 'c1a2b3c4-0000-4000-8000-000000000001',
  email: 'ana@example.com',
  passwordHash: 'argon2-hash',
  createdAt: new Date(),
  updatedAt: new Date(),
}

describe('GET /auth/me', () => {
  // RF-03 · proves requireAuth is actually wired onto this route, not just
  // exercised through require-auth.test.ts's own throwaway app
  it('answers 200 with the session, through the real app', async () => {
    const token = await signSessionToken(user)

    const res = await request(app)
      .get('/auth/me')
      .set('Cookie', `session=${token}`)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ id: user.id, email: user.email })
  })

  // RF-03
  it('answers 401 without a session cookie', async () => {
    const res = await request(app).get('/auth/me')

    expect(res.status).toBe(401)
    expect(res.body).toMatchObject({ code: 'UNAUTHENTICATED' })
  })
})

describe('POST /auth/logout', () => {
  // RF-04 · proves the real route clears the cookie with attributes a
  // browser will actually honour, not just that clearCookie was called
  it('answers 204 and clears the session cookie, through the real app', async () => {
    const token = await signSessionToken(user)

    const res = await request(app)
      .post('/auth/logout')
      .set('Cookie', `session=${token}`)

    expect(res.status).toBe(204)
    expect(res.headers['set-cookie']?.[0]).toMatch(
      /^session=;.*Expires=Thu, 01 Jan 1970/,
    )
  })

  // RF-04
  it('answers 401 without a session cookie', async () => {
    const res = await request(app).post('/auth/logout')

    expect(res.status).toBe(401)
    expect(res.body).toMatchObject({ code: 'UNAUTHENTICATED' })
  })
})
