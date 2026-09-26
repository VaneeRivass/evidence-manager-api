import express from 'express'
import request from 'supertest'
import { afterAll, describe, expect, it } from 'vitest'
import { signSessionToken } from './session.js'
import {
  listen,
  sampleUser as user,
  withSession,
} from '../../../tests/helpers.js'
import { errorHandler } from '../../shared/errors/error-handler.js'
import { requireAuth } from './require-auth.js'

// Answers with whatever requireAuth left on the request, so each test sees
// exactly what a real handler behind it would receive.
const testApp = express()
testApp.get('/test-route', requireAuth, (req, res) => {
  res.json(req.user)
})
testApp.use(errorHandler)
const server = await listen(testApp)
afterAll(() => server.close())

describe('requireAuth', () => {
  // RF-03 · no cookie, no session
  it('answers 401 when there is no session cookie', async () => {
    const res = await request(server).get('/test-route')

    expect(res.status).toBe(401)
    expect(res.body).toMatchObject({ code: 'UNAUTHENTICATED' })
  })

  // RF-03 · a cookie with the right name but no valid token in it
  it('answers 401 when the session cookie is not a valid token', async () => {
    const res = await request(server)
      .get('/test-route')
      .set('Cookie', withSession('not-a-token'))

    expect(res.status).toBe(401)
    expect(res.body).toMatchObject({ code: 'UNAUTHENTICATED' })
  })

  // RF-03 · the handler behind it receives who is asking
  it('lets a valid session through with the user on the request', async () => {
    const token = await signSessionToken(user)

    const res = await request(server)
      .get('/test-route')
      .set('Cookie', withSession(token))

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ id: user.id, email: user.email })
  })

  // RF-03 · a browser sends every cookie for the site in one header
  it('finds the session among other cookies', async () => {
    const token = await signSessionToken(user)

    const res = await request(server)
      .get('/test-route')
      .set('Cookie', `theme=dark; ${withSession(token)}; lang=es`)

    expect(res.status).toBe(200)
  })

  // RF-03 · other cookies are not a session
  it('answers 401 when there are cookies but none is the session', async () => {
    const res = await request(server)
      .get('/test-route')
      .set('Cookie', 'theme=dark; lang=es')

    expect(res.status).toBe(401)
  })
})
