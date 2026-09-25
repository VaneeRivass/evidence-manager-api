import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'
import { errorHandler } from '../errors/error-handler.js'
import { validate } from './validate.js'

const schema = z.object({
  title: z.string().min(3),
  email: z.string().toLowerCase().pipe(z.email()),
})

const probe = express()
probe.use(express.json())
probe.post('/probe', validate(schema), (req, res) => {
  res.json(req.body)
})
probe.use(errorHandler)

describe('validate', () => {
  // RF-01 · RF-23 · one entry per invalid field, not just the first one
  it('answers 400 with a per-field breakdown', async () => {
    const res = await request(probe)
      .post('/probe')
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
    const res = await request(probe)
      .post('/probe')
      .send({ title: 'A valid title' })

    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({
      errors: [{ field: 'email', code: 'INVALID_TYPE' }],
    })
  })

  it('replaces the body with the parsed, transformed value on success', async () => {
    const res = await request(probe)
      .post('/probe')
      .send({ title: 'Case title', email: 'Ana@Example.com' })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ title: 'Case title', email: 'ana@example.com' })
  })
})
