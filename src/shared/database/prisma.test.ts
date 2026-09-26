import { once } from 'node:events'
import { createServer, type AddressInfo } from 'node:net'
import request from 'supertest'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { listen } from '../../../tests/helpers.js'

// A database that accepts the connection and never says a word: the case a
// refused connection does not cover, because that one fails straight away.
const silentDatabase = createServer(() => {}).listen(0, '127.0.0.1')
await once(silentDatabase, 'listening')
const { port } = silentDatabase.address() as AddressInfo
afterAll(() => silentDatabase.close())

// env.ts reads DATABASE_URL once, on import, and helpers.ts has already
// imported it with the unit tests' address, which refuses at once. Forget the
// loaded modules so the app imported below reads this one.
vi.stubEnv('DATABASE_URL', `postgresql://user:pass@127.0.0.1:${port}/none`)
vi.resetModules()
const { app } = await import('../../app.js')

const server = await listen(app)
afterAll(() => server.close())

describe('the database client', () => {
  // RF-21 · RNF-07 · our error, before the platform gives up on the request
  it('answers 500 when the database never accepts the connection', async () => {
    const started = Date.now()
    const res = await request(server)
      .post('/auth/login')
      .send({ email: 'ana@example.com', password: 'whatever' })

    expect(res.status).toBe(500)
    expect(res.body).toMatchObject({ code: 'INTERNAL_ERROR' })
    expect(Date.now() - started).toBeLessThan(6_000)
  }, 10_000)
})
