import { Router } from 'express'
import { requireAuth } from '../auth/require-auth.js'
import { caseParams } from '../cases/cases.schema.js'
import { requireOwnedCase } from '../../shared/middleware/require-owned-case.js'
import {
  validateBody,
  validateParams,
} from '../../shared/middleware/validate.js'
import {
  completeUpload,
  requestDownloadUrl,
  requestUploadUrl,
} from './files.controller.js'
import { checkDeclaredFile, checkUploadKey } from './files.middleware.js'
import { completeUploadSchema, requestUploadSchema } from './files.schema.js'
import { createFilesService } from './files.service.js'
import type { StoragePort } from './storage.port.js'

// Mounted under /cases, beside the cases routes: every route here belongs to one
// case and passes the same ownership guard. Cheap before expensive: what
// needs no database (the body, the declared file, the key) comes before it.
export function createFilesRouter(storage: StoragePort): Router {
  const files = createFilesService(storage)
  const router = Router()

  router.post(
    '/:id/file/upload-url',
    requireAuth,
    validateParams(caseParams),
    validateBody(requestUploadSchema),
    checkDeclaredFile,
    requireOwnedCase,
    requestUploadUrl(files),
  )
  router.post(
    '/:id/file/complete',
    requireAuth,
    validateParams(caseParams),
    validateBody(completeUploadSchema),
    checkUploadKey,
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
