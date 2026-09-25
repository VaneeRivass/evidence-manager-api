import express from 'express'
// Imported for its side effect: validates the environment on every entry point,
// Vercel included, which reaches this file through api/index.ts and never runs server.ts.
import './shared/config/env.js'
import { errorHandler, notFoundHandler } from './shared/errors/error-handler.js'
import { httpLogger } from './shared/logger.js'
import { authRouter } from './modules/auth/auth.routes.js'

// Builds the application and exports it. It never calls listen(): server.ts
// does that for a long-lived process, api/index.ts hands it to Vercel, and
// the tests pass it to Supertest without opening a port. See docs/adr/0001.
export const app = express()

// First, so every later line of the request, error included, carries its id.
app.use(httpLogger)
// No binary ever enters this process, so JSON is the only body this parses.
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

app.use('/auth', authRouter)

// Last, in this order: no route matched, then whatever was thrown.
app.use(notFoundHandler)
app.use(errorHandler)
