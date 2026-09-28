import { type Case, Prisma } from '../../generated/prisma/client.js'
import { isMissingRow, prisma } from '../../shared/database/prisma.js'
import { caseNotFound } from '../../shared/middleware/require-owned-case.js'
import type { StoragePort } from '../files/storage.port.js'
import type {
  CreateCaseInput,
  ListCasesQuery,
  UpdateCaseInput,
} from './cases.schema.js'

type SortOption = ListCasesQuery['sort']
type CaseOrder = Prisma.CaseOrderByWithRelationInput

// RNF-06
const LIST_LIMIT = 100

// RF-06 · one row per sort option the query accepts — a missing one does not
// compile. Newest first; the direction is fixed, not a parameter.
const ORDER: Record<SortOption, CaseOrder> = {
  updatedAt: { updatedAt: 'desc' },
  createdAt: { createdAt: 'desc' },
}

// RF-06 · equal dates still come back in the same order.
const BREAKS_TIES: CaseOrder = { id: 'asc' }

// RF-05 · status and file keep the column defaults: open, nothing attached.
export const createCase = (
  userId: string,
  input: CreateCaseInput,
): Promise<Case> => prisma.case.create({ data: { ...input, userId } })

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

// RF-09b · requireOwnedCase read the case a moment earlier, so another request
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
  ownedCase: Case,
  input: UpdateCaseInput,
): Promise<Case> {
  const fieldsToUpdate: Prisma.CaseUpdateInput = {}

  if (input.title !== undefined && input.title !== ownedCase.title) {
    fieldsToUpdate.title = input.title
  }

  if (
    input.description !== undefined &&
    input.description !== ownedCase.description
  ) {
    fieldsToUpdate.description = input.description
  }

  if (input.status !== undefined && input.status !== ownedCase.status) {
    fieldsToUpdate.status = input.status
  }

  if (Object.keys(fieldsToUpdate).length === 0) return ownedCase

  return updateLiveCase(ownedCase.id, fieldsToUpdate)
}

// RF-09 · marks the case deleted, only while it still holds the file that
// was just deleted from storage; null if it changed since it was read.
// fileKey is unique, so inside AND to be read as a filter, not a lookup.
async function markCaseDeleted(ownedCase: Case): Promise<Case | null> {
  try {
    return await prisma.case.update({
      where: {
        id: ownedCase.id,
        deletedAt: null,
        AND: { fileKey: ownedCase.fileKey },
      },
      data: { deletedAt: new Date(), fileKey: null },
    })
  } catch (error) {
    if (isMissingRow(error)) return null
    throw error
  }
}

// RF-09 · RNF-05 · the row stays as the trail; only the key is cleared. The
// file is deleted from storage FIRST (ADR-0005): if storage fails, the error
// reaches the client and the case is untouched, so deleting again is safe.
// Storage cannot run locally, so it is received, not imported (ADR-0006).
export async function deleteCase(
  ownedCase: Case,
  storage: StoragePort,
): Promise<Case> {
  if (ownedCase.fileKey !== null) await storage.deleteObject(ownedCase.fileKey)

  const deleted = await markCaseDeleted(ownedCase)
  if (deleted) return deleted

  // The case changed after the guard read it: deleted by another request, or
  // given a file by a confirmation. Deleted again with what it holds now. A
  // file is never replaced, so this happens at most once.
  const latestCase = await prisma.case.findFirst({
    where: { id: ownedCase.id, deletedAt: null },
  })
  if (!latestCase) throw caseNotFound()
  return deleteCase(latestCase, storage)
}
