import * as z from 'zod'
import { CaseStatus } from '../../generated/prisma/enums.js'
import { FieldCode } from '../../shared/errors/error-codes.js'

// RF-05 · required, so spaces alone do not count: trimmed first, then between
// 1 and the column's size, and without a null character, which PostgreSQL
// cannot store.
const requiredText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .regex(/^[^\0]*$/)

// RF-05 · the column sizes, each written once for creating and editing.
const title = requiredText(120)
const description = requiredText(2000)

// RF-06 · RF-08 · in any case, stored in uppercase.
const statusInAnyCase = z.string().toUpperCase().pipe(z.enum(CaseStatus))

// RF-07a
export const caseParams = z.object({ id: z.uuid() })

// RF-05 · unknown fields such as userId are dropped: the owner is the session.
export const createCaseSchema = z.object({ title, description })

export type CreateCaseInput = z.infer<typeof createCaseSchema>

// RF-08 · the rules of creation, each field optional. RF-08a · once unknown
// fields are dropped, one must be left: an empty edit would still move the
// case to the top of the list.
export const updateCaseSchema = z
  .object({
    title: title.optional(),
    description: description.optional(),
    status: statusInAnyCase.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    params: { code: FieldCode.NOTHING_TO_CHANGE },
  })

export type UpdateCaseInput = z.infer<typeof updateCaseSchema>

// RF-06 · strict, unlike the body: here an unknown parameter is a typo, and
// ignoring it would skip the filter.
export const listCasesQuery = z.strictObject({
  status: statusInAnyCase.optional(),
  sort: z.enum(['updatedAt', 'createdAt']).default('updatedAt'),
})

export type ListCasesQuery = z.infer<typeof listCasesQuery>
