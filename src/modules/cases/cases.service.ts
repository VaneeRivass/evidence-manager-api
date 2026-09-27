import type { Case, Prisma } from '../../generated/prisma/client.js'
import { prisma } from '../../shared/database/prisma.js'
import type { CreateCaseInput, ListCasesQuery } from './cases.schema.js'

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
  const where = { userId, deletedAt: null, ...(status && { status }) }

  const [items, total] = await Promise.all([
    prisma.case.findMany({
      where,
      orderBy: [ORDER[sort], BREAKS_TIES],
      take: LIST_LIMIT,
    }),
    prisma.case.count({ where }),
  ])

  return { items, total }
}
