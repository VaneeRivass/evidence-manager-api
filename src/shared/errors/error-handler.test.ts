import express from 'express'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { app } from '../../app.js'
import { httpLogger } from '../logger.js'
import { Conflict } from './app-error.js'
import { errorHandler } from './error-handler.js'

// No route throws these yet, so a minimal app with the real middlewares does.
const probe = express()
probe.use(httpLogger)
probe.get('/bug', () => {
  throw new TypeError("Cannot read properties of undefined (reading 'userId')")
})
probe.get('/conflict', () => {
  throw Conflict('FILE_TOO_LARGE', 'Object is 19 MB', { max: 5242880 })
})
probe.use(errorHandler)

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

// Splits the id, which changes on every request, from the rest of the body.
const problemOf = (res: request.Response) => {
  const { requestId, ...problem } = res.body as Record<string, unknown>
  return { requestId, problem }
}

describe('error handler', () => {
  // RF-21 · RF-22
  it('answers an unknown route with a 404 problem document', async () => {
    const res = await request(app).get('/does-not-exist')

    expect(res.status).toBe(404)
    expect(res.headers['content-type']).toMatch(/^application\/problem\+json/)
    const { requestId, problem } = problemOf(res)
    expect(problem).toEqual({
      title: 'Not Found',
      status: 404,
      code: 'ROUTE_NOT_FOUND',
    })
    expect(requestId).toMatch(uuid)
  })

  // RF-23
  it('returns the code and params of an AppError', async () => {
    const res = await request(probe).get('/conflict')

    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({
      code: 'FILE_TOO_LARGE',
      params: { max: 5242880 },
    })
  })

  // RNF-07
  it('answers an unexpected failure with a 500 that reveals nothing', async () => {
    const res = await request(probe).get('/bug')

    expect(res.status).toBe(500)
    const { requestId, problem } = problemOf(res)
    expect(problem).toEqual({
      title: 'Internal Server Error',
      status: 500,
      code: 'INTERNAL_ERROR',
    })
    expect(requestId).toMatch(uuid)
    expect(res.text).not.toContain('userId')
  })

  // RF-22
  it('ignores a request id sent by the client', async () => {
    const res = await request(app)
      .get('/does-not-exist')
      .set('X-Request-Id', 'planted')

    expect(problemOf(res).requestId).not.toBe('planted')
  })
})
