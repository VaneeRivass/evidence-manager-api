import type { NextFunction, Request, Response } from 'express'
import type { Case } from '../../generated/prisma/client.js'
import { sessionOf } from '../../modules/auth/require-auth.js'
import { prisma } from '../database/prisma.js'
import { Forbidden, NotFound } from '../errors/app-error.js'
import { ErrorCode } from '../errors/error-codes.js'

// What the guard leaves for the handler after it: the case, found and checked.
export type OwnedCaseResponse = Response<unknown, { case: Case }>

// RF-07 · RF-09b · the one place a /cases/:id route finds its case, so the
// check cannot be forgotten in one of them. Missing or deleted is a 404;
// someone else's, a 403.
export async function loadOwnedCase(
  req: Request<{ id: string }>,
  res: OwnedCaseResponse,
  next: NextFunction,
): Promise<void> {
  const item = await prisma.case.findFirst({
    where: { id: req.params.id, deletedAt: null },
  })

  if (!item) throw NotFound(ErrorCode.CASE_NOT_FOUND, 'Case not found')

  if (item.userId !== sessionOf(req).id) {
    throw Forbidden(ErrorCode.CASE_FORBIDDEN, 'Case of another user')
  }

  res.locals.case = item
  next()
}
