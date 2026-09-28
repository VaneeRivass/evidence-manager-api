import type { Request, Response } from 'express'
import type { OwnedCaseResponse } from '../../shared/middleware/load-owned-case.js'
import { sessionOf } from '../auth/require-auth.js'
import type { StoragePort } from '../files/storage.port.js'
import { toPublicCase } from './cases.mapper.js'
import {
  createCase,
  deleteCase,
  listCases,
  updateCase,
} from './cases.service.js'
import type {
  CreateCaseInput,
  ListCasesQuery,
  UpdateCaseInput,
} from './cases.schema.js'

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

// RF-07 · loadOwnedCase already found it and checked the owner.
export function read(_req: Request, res: OwnedCaseResponse): void {
  res.status(200).json(toPublicCase(res.locals.case))
}

// RF-08
export async function update(
  req: Request<never, unknown, UpdateCaseInput>,
  res: OwnedCaseResponse,
): Promise<void> {
  const item = await updateCase(res.locals.case, req.body)
  res.status(200).json(toPublicCase(item))
}

// RF-09 · the only cases handler that needs the storage, so the only one
// built by a factory, the way the files handlers are.
export const remove =
  (storage: StoragePort) =>
  async (_req: Request, res: OwnedCaseResponse): Promise<void> => {
    await deleteCase(res.locals.case, storage)
    res.status(204).end()
  }
