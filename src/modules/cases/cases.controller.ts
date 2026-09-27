import type { Request, Response } from 'express'
import { sessionOf } from '../auth/require-auth.js'
import { toPublicCase } from './cases.mapper.js'
import { createCase, listCases } from './cases.service.js'
import type { CreateCaseInput, ListCasesQuery } from './cases.schema.js'

// RF-05
export async function create(
  req: Request<never, unknown, CreateCaseInput>,
  res: Response,
): Promise<void> {
  const item = await createCase(sessionOf(req).id, req.body)
  res.status(201).json(toPublicCase(item))
}

// RF-06
export async function list(
  req: Request,
  res: Response<unknown, { query: ListCasesQuery }>,
): Promise<void> {
  const { items, total } = await listCases(sessionOf(req).id, res.locals.query)

  res.status(200).json({ items: items.map(toPublicCase), total })
}
