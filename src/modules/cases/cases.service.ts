import { type Case, Prisma } from '../../generated/prisma/client.js'
import { isMissingRow, prisma } from '../../shared/database/prisma.js'
import { caseNotFound } from '../../shared/middleware/load-owned-case.js'
import type { StoragePort } from '../files/storage.port.js'
import type {
  CreateCaseInput,
  ListCasesQuery,
  UpdateCaseInput,
} from './cases.schema.js'

// RNF-06
const LIST_LIMIT = 100

// RF-05 · status and file keep the column defaults: open, nothing attached.
export const createCase = (
  userId: string,
  input: CreateCaseInput,
): Promise<Case> => prisma.case.create({ data: { ...input, userId } })

// RF-06 · newest first; the direction is fixed, not a parameter.
const ORDER: Record<
  ListCasesQuery['sort'],
  Prisma.CaseOrderByWithRelationInput
> = {
  updatedAt: { updatedAt: 'desc' },
  createdAt: { createdAt: 'desc' },
}

// RF-06 · equal dates still come back in the same order.
const BREAKS_TIES: Prisma.CaseOrderByWithRelationInput = { id: 'asc' }

// RF-06 · one filter for both, so total counts what items comes from. Not a
// transaction: under the default isolation it would not share a snapshot.
export async function listCases(
  userId: string,
  { status, sort }: ListCasesQuery,
): Promise<{ items: Case[]; total: number }> {
  const filter: Prisma.CaseWhereInput = { userId, deletedAt: null }
  if (status) filter.status = status

  const [items, total] = await Promise.all([
    prisma.case.findMany({
      where: filter,
      orderBy: [ORDER[sort], BREAKS_TIES],
      take: LIST_LIMIT,
    }),
    prisma.case.count({ where: filter }),
  ])

  return { items, total }
}

// RF-09b · loadOwnedCase read the case a moment earlier, so another request
// can delete it before this write lands, and the filter then matches no row.
// A deleted case answers 404 here too, instead of failing as a 500.
async function updateLiveCase(
  id: string,
  data: Prisma.CaseUpdateInput,
): Promise<Case> {
  try {
    return await prisma.case.update({ where: { id, deletedAt: null }, data })
  } catch (error) {
    if (isMissingRow(error)) {
      throw caseNotFound()
    }

    throw error
  }
}

// RF-08 · only what changes is written. RF-08b · if nothing does, the case is
// not touched, so a form saved without typing does not jump to the top.
export async function updateCase(
  current: Case,
  input: UpdateCaseInput,
): Promise<Case> {
  const changes: Prisma.CaseUpdateInput = {}

  if (input.title !== undefined && input.title !== current.title) {
    changes.title = input.title
  }

  if (
    input.description !== undefined &&
    input.description !== current.description
  ) {
    changes.description = input.description
  }

  if (input.status !== undefined && input.status !== current.status) {
    changes.status = input.status
  }

  if (Object.keys(changes).length === 0) return current

  return updateLiveCase(current.id, changes)
}

// RF-09 · RNF-05 · the row stays as the trail; only the key is cleared. The
// file is destroyed FIRST (ADR-0005): if storage fails, the error reaches the
// client and the case is untouched, so deleting again is safe. Storage cannot
// run locally, so it is received, not imported (ADR-0006).
export async function deleteCase(
  item: Case,
  storage: StoragePort,
): Promise<Case> {
  if (item.fileKey !== null) await storage.deleteObject(item.fileKey)

  try {
    return await prisma.case.update({
      // Only while the case still holds the file that was destroyed. fileKey
      // is unique, so inside AND to be read as a filter, not a lookup.
      where: { id: item.id, deletedAt: null, AND: { fileKey: item.fileKey } },
      data: { deletedAt: new Date(), fileKey: null },
    })
  } catch (error) {
    if (!isMissingRow(error)) throw error
  }

  // The case changed after the guard read it: deleted by another request, or
  // given a file by a confirmation. Deleted again with what it holds now. A
  // file is never replaced, so this happens at most once.
  const current = await prisma.case.findFirst({
    where: { id: item.id, deletedAt: null },
  })
  if (!current) throw caseNotFound()
  return deleteCase(current, storage)
}
