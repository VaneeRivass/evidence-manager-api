import { Router } from 'express'
import { requireAuth } from '../auth/require-auth.js'
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

export const casesRouter = Router()

// Cheap before expensive: the signature, then the id, the query or the body,
// and only then the database. A malformed request never reaches it.
casesRouter.post('/', requireAuth, validate(createCaseSchema), create)
casesRouter.get('/', requireAuth, validateQuery(listCasesQuery), list)

casesRouter.get(
  '/:id',
  requireAuth,
  validateParams(caseParams),
  loadOwnedCase,
  read,
)
casesRouter.patch(
  '/:id',
  requireAuth,
  validateParams(caseParams),
  validate(updateCaseSchema),
  loadOwnedCase,
  update,
)
casesRouter.delete(
  '/:id',
  requireAuth,
  validateParams(caseParams),
  loadOwnedCase,
  remove,
)
