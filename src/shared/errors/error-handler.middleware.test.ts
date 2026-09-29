import express, { type Request, type Response } from 'express'
import request from 'supertest'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { app } from '../../app.js'
import { listen, problemOf } from '../../../tests/helpers.js'
import { httpLogger } from '../logging/logger.js'
import { PayloadTooLarge } from './app-error.js'
import { ErrorCode } from './error-codes.js'
import { errorHandler } from './error-handler.middleware.js'

// A throwaway app with the real middlewares: a route that throws a bug, and one
// that throws an error with params, without depending on what real routes do.
const testApp = express()
testApp.use(httpLogger)
testApp.get('/bug', () => {
  throw new TypeError("Cannot read properties of undefined (reading 'userId')")
})
testApp.get('/with-params', () => {
  throw PayloadTooLarge(ErrorCode.PAYLOAD_TOO_LARGE, 'Body is 19 MB', {
    max: 102400,
  })
})
testApp.use(errorHandler)

const server = await listen(app)
afterAll(() => server.close())
const testAppServer = await listen(testApp)
afterAll(() => testAppServer.close())

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

describe('error handler', () => {
  // RF-21 · RF-22
  it('answers an unknown route with a 404 problem document', async () => {
    const res = await request(server).get('/does-not-exist')

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
    const res = await request(testAppServer).get('/with-params')

    expect(res.status).toBe(413)
    expect(res.body).toMatchObject({
      code: 'PAYLOAD_TOO_LARGE',
      params: { max: 102400 },
    })
  })

  // RF-21 · the body is read only by the route that validates it
  it('answers an unknown route with a 404 even when its body is malformed', async () => {
    const res = await request(server)
      .post('/does-not-exist')
      .set('Content-Type', 'application/json')
      .send('{"broken"')

    expect(res.status).toBe(404)
    expect(res.body).toMatchObject({ code: 'ROUTE_NOT_FOUND' })
  })

  // RNF-07
  it('answers an unexpected failure with a 500 that reveals nothing', async () => {
    const res = await request(testAppServer).get('/bug')

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
    const res = await request(server)
      .get('/does-not-exist')
      .set('X-Request-Id', 'planted')

    expect(problemOf(res).requestId).not.toBe('planted')
  })
})

// Express's own guidance: once the response has started, a second answer
// cannot be written — the error goes to Express, which closes the connection.
describe('an error after the response has started', () => {
  it('hands the error to Express instead of answering again', () => {
    const error = new Error('stream broke mid-response')
    const status = vi.fn()
    const next = vi.fn()
    const res = { headersSent: true, status } as unknown as Response

    errorHandler(error, {} as Request, res, next)

    expect(next).toHaveBeenCalledWith(error)
    expect(status).not.toHaveBeenCalled()
  })
})
