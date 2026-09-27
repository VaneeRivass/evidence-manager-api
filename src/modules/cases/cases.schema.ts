import * as z from 'zod'
import { CaseStatus } from '../../generated/prisma/enums.js'

// RF-05 · trimmed, within the column's size, and without a null character,
// which PostgreSQL cannot store.
const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[^\0]*$/)

// RF-05 · unknown fields such as userId are dropped: the owner is the session.
export const createCaseSchema = z.object({
  title: text(120),
  description: text(2000),
})

export type CreateCaseInput = z.infer<typeof createCaseSchema>

// RF-06 · status in any case, stored in uppercase. Strict, unlike the body:
// here an unknown parameter is a typo, and ignoring it would skip the filter.
export const listCasesQuery = z.strictObject({
  status: z.string().toUpperCase().pipe(z.enum(CaseStatus)).optional(),
  sort: z.enum(['updatedAt', 'createdAt']).default('updatedAt'),
})

export type ListCasesQuery = z.infer<typeof listCasesQuery>
