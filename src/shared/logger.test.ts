import express from 'express'
import request from 'supertest'
import { beforeEach, describe, expect, it } from 'vitest'
import { errorHandler, notFoundHandler } from './errors/error-handler.js'
import { createLoggers } from './logger.js'

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
