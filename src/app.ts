import express, { type Express } from 'express'
// Also validates the environment on import, on every entry point, Vercel
// included, which reaches this file through api/index.ts and never runs server.ts.
import { env } from './shared/config/env.js'
import { errorHandler, notFoundHandler } from './shared/errors/error-handler.js'
import { httpLogger } from './shared/logging/logger.js'
import { authRouter } from './modules/auth/auth.routes.js'
import { casesRouter } from './modules/cases/cases.routes.js'
import { createFilesRouter } from './modules/files/files.routes.js'
import { createR2Storage } from './modules/files/r2-storage.adapter.js'
import type { StoragePort } from './modules/files/storage.port.js'

// Builds the application and returns it. It never calls listen(): server.ts
// does that for a long-lived process, api/index.ts hands it to Vercel, and
// the tests pass it to Supertest without opening a port. See docs/adr/0001.
// The storage is handed in, so tests build it with the in-memory double
// (docs/adr/0006).
export function createApp(storage: StoragePort): Express {
  const app = express()

  // First, so every later line of the request, error included, carries its id.
  app.use(httpLogger)

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  // No global express.json(): a route reads its body inside validate(), after
  // requireAuth, so an unauthenticated request never pays for parsing it.
  app.use('/auth', authRouter)
  app.use('/cases', casesRouter)
  app.use('/cases', createFilesRouter(storage))

  // Last, in this order: no route matched, then whatever was thrown.
  app.use(notFoundHandler)
  app.use(errorHandler)

  return app
}

// The one place the real storage is chosen.
export const app = createApp(
  createR2Storage({
    endpoint: env.S3_ENDPOINT,
    bucket: env.S3_BUCKET,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  }),
)
