import { Router } from 'express'
import { requireAuth } from '../auth/require-auth.js'
import type { StoragePort } from '../files/storage.port.js'
import { loadOwnedCase } from '../../shared/middleware/load-owned-case.js'
import {
  validate,
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
// it: deleting a case destroys its file.
export function createCasesRouter(storage: StoragePort): Router {
  const router = Router()

  // Cheap before expensive: the signature, then the id, the query or the body,
  // and only then the database. A malformed request never reaches it.
  router.post('/', requireAuth, validate(createCaseSchema), create)
  router.get('/', requireAuth, validateQuery(listCasesQuery), list)

  router.get(
    '/:id',
    requireAuth,
    validateParams(caseParams),
    loadOwnedCase,
    read,
  )
  router.patch(
    '/:id',
    requireAuth,
    validateParams(caseParams),
    validate(updateCaseSchema),
    loadOwnedCase,
    update,
  )
  router.delete(
    '/:id',
    requireAuth,
    validateParams(caseParams),
    loadOwnedCase,
    remove(storage),
  )

  return router
}
