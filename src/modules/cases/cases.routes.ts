import { Router } from 'express'
import { requireAuth } from '../auth/require-auth.js'
import { validate, validateQuery } from '../../shared/middleware/validate.js'
import { create, list } from './cases.controller.js'
import { createCaseSchema, listCasesQuery } from './cases.schema.js'

export const casesRouter = Router()

// Cheap before expensive: the signature first, no query; then the body or the
// query string. A malformed request never reaches the database.
casesRouter.post('/', requireAuth, validate(createCaseSchema), create)
casesRouter.get('/', requireAuth, validateQuery(listCasesQuery), list)
