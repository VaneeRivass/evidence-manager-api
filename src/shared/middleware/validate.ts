import express, {
  type Request,
  type RequestHandler,
  type Response,
} from 'express'
import type * as z from 'zod'
import {
  BadRequest,
  type FieldError,
  PayloadTooLarge,
  ValidationError,
} from '../errors/app-error.js'
import { ErrorCode, FieldCode } from '../errors/error-codes.js'

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

const BODY_LIMIT_BYTES = 100 * 1024

const parseJson = express.json({ limit: BODY_LIMIT_BYTES })

// The body is read here and nowhere else, so only routes that take one pay
// for it, and only after requireAuth. Any error at this point comes from the
// parser, so it is translated right here. Its own message is dropped:
// JSON.parse quotes the body, and the body may carry a password.
// See docs/requirements.md section 1.4.
const readJsonBody = (req: Request, res: Response): Promise<void> =>
  new Promise((resolve, reject) => {
    parseJson(req, res, (error?: unknown) => {
      if (!error) return resolve()

      const { type } = error as { type?: unknown }
      reject(
        type === 'entity.too.large'
          ? PayloadTooLarge(
              ErrorCode.PAYLOAD_TOO_LARGE,
              'Request body over the size limit',
              { max: BODY_LIMIT_BYTES },
            )
          : BadRequest(
              ErrorCode.UNREADABLE_BODY,
              `Request body could not be read (${String(type)})`,
            ),
      )
    })
  })

// Reads the body and validates it against `schema`, replacing it with the
// parsed (and possibly transformed, e.g. lower-cased) value on success. See
// docs/requirements.md RNF-04 and RNF-08, and the middleware order note
// in section 3: this runs before any query touches the database.
export const validate =
  (schema: z.ZodType): RequestHandler =>
  async (req, res, next) => {
    await readJsonBody(req, res)

    // The parser leaves no body when there is none, or when the Content-Type
    // is not JSON: a form or a file never reaches the schema.
    if (req.body === undefined) {
      throw BadRequest(ErrorCode.UNREADABLE_BODY, 'Request body is not JSON')
    }

    const result = schema.safeParse(req.body)

    if (!result.success) {
      throw new ValidationError(result.error.issues.map(toFieldError))
    }

    req.body = result.data
    next()
  }
