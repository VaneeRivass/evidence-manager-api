import request from 'supertest'
import { afterAll, describe, expect, it } from 'vitest'
import vercelHandler from '../api/index.js'
import { app } from './app.js'
import { listen } from '../tests/helpers.js'

const server = await listen(app)
afterAll(() => server.close())

describe('the application', () => {
  // RNF-10 · the first thing anyone checks after bringing the API up
  it('answers GET /health with 200', async () => {
    const res = await request(server).get('/health')

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok' })
  })

  // Hardening · proves helmet is on the real app, not just installed
  it('answers with the hardened headers', async () => {
    const res = await request(server).get('/health')

    expect(res.headers['x-content-type-options']).toBe('nosniff')
    // Helmet hides the framework by default; a banner only helps an attacker.
    expect(res.headers['x-powered-by']).toBeUndefined()
  })

  // RNF-09 · Vercel runs the very app the tests and server.ts use, not a copy
  it('hands Vercel the same app, built once in app.ts', () => {
    expect(vercelHandler).toBe(app)
  })
})
