import { Router } from 'express'
import { requireAuth } from '../auth/require-auth.js'
import { caseParams } from '../cases/cases.schema.js'
import { requireOwnedCase } from '../../shared/middleware/require-owned-case.js'
import { validate, validateParams } from '../../shared/middleware/validate.js'
import {
  completeUpload,
  requestDownloadUrl,
  requestUploadUrl,
} from './files.controller.js'
import { completeUploadSchema, requestUploadSchema } from './files.schema.js'
import { createFilesService } from './files.service.js'
import type { StoragePort } from './storage.port.js'

// Mounted under /cases, beside the cases routes: every route here belongs to one
// case and passes the same ownership guard.
export function createFilesRouter(storage: StoragePort): Router {
  const files = createFilesService(storage)
  const router = Router()

  router.post(
    '/:id/file/upload-url',
    requireAuth,
    validateParams(caseParams),
    validate(requestUploadSchema),
    requireOwnedCase,
    requestUploadUrl(files),
  )
  router.post(
    '/:id/file/complete',
    requireAuth,
    validateParams(caseParams),
    validate(completeUploadSchema),
    requireOwnedCase,
    completeUpload(files),
  )
  router.get(
    '/:id/file/download-url',
    requireAuth,
    validateParams(caseParams),
    requireOwnedCase,
    requestDownloadUrl(files),
  )

  return router
}
