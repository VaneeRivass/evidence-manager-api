import express from 'express'
import request from 'supertest'
import { afterAll, describe, expect, it } from 'vitest'
import * as z from 'zod'
import { errorHandler } from '../errors/error-handler.js'
import { listen } from '../../../tests/helpers.js'
import { validate } from './validate.js'

const schema = z.object({
  title: z.string().min(3),
  email: z.string().toLowerCase().pipe(z.email()),
})

// No body parser of its own: validate() reads the body.
const testApp = express()
testApp.post('/test-route', validate(schema), (req, res) => {
  res.json(req.body)
})
testApp.use(errorHandler)
const server = await listen(testApp)
afterAll(() => server.close())

describe('validate', () => {
  // RF-01 · RF-23 · one entry per invalid field, not just the first one
  it('answers 400 with a per-field breakdown', async () => {
    const res = await request(server)
      .post('/test-route')
      .send({ title: 'ab', email: 'not-an-email' })

    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      errors: [
        { field: 'title', code: 'TOO_SHORT', params: { min: 3 } },
        { field: 'email', code: 'INVALID_FORMAT' },
      ],
    })
  })

  // RNF-04 · a field missing entirely fails the same way as one with the
  // wrong type: neither reaches the service
  it('names a missing field', async () => {
    const res = await request(server)
      .post('/test-route')
      .send({ title: 'A valid title' })

    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({
      errors: [{ field: 'email', code: 'INVALID_TYPE' }],
    })
  })

  it('replaces the body with the parsed, transformed value on success', async () => {
    const res = await request(server)
      .post('/test-route')
      .send({ title: 'Case title', email: 'Ana@Example.com' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ title: 'Case title', email: 'ana@example.com' })
  })

  // RF-01 · RNF-07 · the client's mistake, not ours: 400, never 500
  it('answers a malformed JSON body with a 400', async () => {
    const res = await request(server)
      .post('/test-route')
      .set('Content-Type', 'application/json')
      .send('{"title": "Case title"')

    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({
      title: 'Bad Request',
      code: 'UNREADABLE_BODY',
    })
  })

  // RF-01 · valid JSON, but not an object: the parser refuses it before the
  // schema, so it is unreadable, not a validation error
  it.each(['"text"', '42', 'null'])(
    'answers a bare %s with a 400 as unreadable',
    async (body) => {
      const res = await request(server)
        .post('/test-route')
        .set('Content-Type', 'application/json')
        .send(body)

      expect(res.status).toBe(400)
      expect(res.body).toMatchObject({ code: 'UNREADABLE_BODY' })
    },
  )

  // RF-01 · a form or a file never reaches the schema, and no made-up field
  // is named
  it('answers a body that is not JSON with a 400', async () => {
    const res = await request(server)
      .post('/test-route')
      .type('form')
      .send({ title: 'Case title' })

    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ code: 'UNREADABLE_BODY' })
    expect(res.body).not.toHaveProperty('errors')
  })

  // RNF-07
  it('answers a body over 100 KB with a 413 and the limit', async () => {
    const res = await request(server)
      .post('/test-route')
      .send({ title: 'a'.repeat(200_000), email: 'ana@x.com' })

    expect(res.status).toBe(413)
    expect(res.body).toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      params: { max: 102400 },
    })
  })
})
