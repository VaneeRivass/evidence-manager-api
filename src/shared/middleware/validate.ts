import type { RequestHandler } from 'express'
import type * as z from 'zod'
import { type FieldError, ValidationError } from '../errors/app-error.js'
import { FieldCode } from '../errors/error-codes.js'

// Maps a Zod issue to the stable per-field code the client switches on.
// A hand-written check (e.g. auth.schema.ts's password byte length) reports
// through ctx.addIssue({ code: 'too_small' | 'too_big', ... }) so it lands
// in the same cases below as Zod's own .min()/.max() — one mapping, not two.
const toFieldError = (issue: z.core.$ZodIssue): FieldError => {
  const field = issue.path.join('.') || '(root)'

  switch (issue.code) {
    case 'too_small':
      return {
        field,
        code: FieldCode.TOO_SHORT,
        params: { min: Number(issue.minimum) },
      }
    case 'too_big':
      return {
        field,
        code: FieldCode.TOO_LONG,
        params: { max: Number(issue.maximum) },
      }
    case 'invalid_format':
      return { field, code: FieldCode.INVALID_FORMAT }
    default:
      return { field, code: FieldCode.INVALID_TYPE }
  }
}

// Validates the body against `schema`, replacing it with the parsed
// (and possibly transformed, e.g. lower-cased) value on success. See
// docs/requirements.md RNF-04 and RNF-08, and the middleware order note
// in section 3: this runs before any query touches the database.
export const validate =
  (schema: z.ZodType): RequestHandler =>
  (req, _res, next) => {
    const result = schema.safeParse(req.body)

    if (!result.success) {
      throw new ValidationError(result.error.issues.map(toFieldError))
    }

    req.body = result.data
    next()
  }
