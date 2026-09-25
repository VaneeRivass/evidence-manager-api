import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import * as z from 'zod'
import { ValidationError } from './errors/app-error.js'
import { FieldCode } from './errors/error-codes.js'
import { errorHandler, notFoundHandler } from './errors/error-handler.js'
import { createLoggers } from './logger.js'
import { validate } from './middleware/validate.js'

// The app's own loggers, writing to an array instead of stdout, and at info:
// the test run silences the real ones.
let lines: Record<string, unknown>[] = []
const { logger, httpLogger } = createLoggers(
  {
    write: (line: string) =>
      lines.push(JSON.parse(line) as Record<string, unknown>),
  },
  'info',
)

const app = express()
app.use(httpLogger)
app.get('/login', (_req, res) => {
  res.cookie('session', 'token-from-set-cookie').json({ ok: true })
})
app.post('/invalid', () => {
  throw new ValidationError([
    { field: 'password', code: FieldCode.TOO_SHORT, params: { min: 8 } },
  ])
})
app.post('/parse', validate(z.object({})), (_req, res) => {
  res.json({ ok: true })
})
app.use(notFoundHandler)
app.use(errorHandler)

beforeEach(() => {
  lines = []
})

describe('request logging', () => {
  // RF-22
  it('logs the same request id the error response returns', async () => {
    const res = await request(app).get('/does-not-exist')
    const { requestId } = res.body as { requestId: string }

    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({
      reqId: requestId,
      req: { method: 'GET', url: '/does-not-exist' },
      res: { statusCode: 404 },
      err: { code: 'ROUTE_NOT_FOUND' },
    })
  })

  // CLAUDE.md · passwordHash never leaves, not in a response, not in a log
  it('leaves cookies and tokens out of the request line', async () => {
    await request(app)
      .get('/login')
      .set('Cookie', 'session=token-from-cookie')
      .set('Authorization', 'Bearer token-from-authorization')

    const written = JSON.stringify(lines)
    expect(written).not.toContain('token-from-cookie')
    expect(written).not.toContain('token-from-authorization')
    expect(written).not.toContain('token-from-set-cookie')
  })

  // RF-22 · the log alone must say which field failed, without reproducing it
  it('logs which fields failed a validation', async () => {
    await request(app).post('/invalid')

    expect(lines[0]).toMatchObject({
      err: {
        code: 'VALIDATION_ERROR',
        errors: [{ field: 'password', code: 'TOO_SHORT', params: { min: 8 } }],
      },
    })
  })

  // RNF-07 · JSON.parse quotes the body in its message, and the body may
  // carry a password: the malformed body must not reach the log
  it('logs a malformed body as a warning, without quoting it', async () => {
    await request(app)
      .post('/parse')
      .set('Content-Type', 'application/json')
      .send('{"password": "secret-in-body"')

    expect(lines[0]).toMatchObject({
      level: 40,
      err: { code: 'UNREADABLE_BODY' },
    })
    expect(JSON.stringify(lines)).not.toContain('secret-in-body')
  })

  // CLAUDE.md · passwordHash never leaves, not in a response, not in a log
  it('redacts secrets in a log written by hand', () => {
    // As a careless handler would: headers and body logged whole, and a raw
    // record passed straight to the logger, unwrapped and one level deep.
    logger.info({
      req: { headers: { cookie: 'c-secret', authorization: 'a-secret' } },
      res: { headers: { 'set-cookie': 's-secret' } },
      body: { password: 'p-secret' },
      passwordHash: 'top-level-secret',
      user: { passwordHash: 'nested-secret' },
    })

    expect(JSON.stringify(lines)).not.toMatch(/-secret/)
  })
})
