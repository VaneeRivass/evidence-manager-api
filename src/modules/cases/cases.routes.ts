import { Router } from 'express'
import { requireAuth } from '../auth/require-auth.js'
import type { StoragePort } from '../files/storage.port.js'
import { requireOwnedCase } from '../../shared/middleware/require-owned-case.js'
import {
  validateBody,
  validateParams,
  validateQuery,
} from '../../shared/middleware/validate.js'
import { create, list, read, remove, update } from './cases.controller.js'
import {
  caseParams,
  createCaseSchema,
  listCasesQuery,
  updateCaseSchema,
} from './cases.schema.js'

// Receives the storage like createFilesRouter, for the one route that needs
// it: deleting a case deletes its file from storage.
export function createCasesRouter(storage: StoragePort): Router {
  const router = Router()

  // Cheap before expensive: the signature, then the id, the query or the body,
  // and only then the database. A malformed request never reaches it.
  router.post('/', requireAuth, validateBody(createCaseSchema), create)
  router.get('/', requireAuth, validateQuery(listCasesQuery), list)

  router.get(
    '/:id',
    requireAuth,
    validateParams(caseParams),
    requireOwnedCase,
    read,
  )
  router.patch(
    '/:id',
    requireAuth,
    validateParams(caseParams),
    validateBody(updateCaseSchema),
    requireOwnedCase,
    update,
  )
  router.delete(
    '/:id',
    requireAuth,
    validateParams(caseParams),
    requireOwnedCase,
    remove(storage),
  )

  return router
}
