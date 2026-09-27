import express, {
  type NextFunction,
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
    // A rule about the body as a whole, such as RF-08a's empty edit: the
    // schema names the code, since no length or format describes it.
    case 'custom':
      return { field, code: issue.params?.code as FieldCode }
    default:
      return { field, code: FieldCode.INVALID_TYPE }
  }
}

// One entry per unknown key, so the client knows which one to fix.
const toFieldErrors = (issue: z.core.$ZodIssue): FieldError[] =>
  issue.code === 'unrecognized_keys'
    ? issue.keys.map((key) => ({
        field: [...issue.path, key].join('.'),
        code: FieldCode.UNKNOWN_FIELD,
      }))
    : [toFieldError(issue)]

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

// The step every validator shares: the parsed value, or a 400 naming each
// invalid field. The message only tells the log which part of the request
// failed.
const parseOrThrow = <S extends z.ZodType>(
  schema: S,
  data: unknown,
  message: string,
): z.output<S> => {
  const result = schema.safeParse(data)

  if (!result.success) {
    throw new ValidationError(
      result.error.issues.flatMap(toFieldErrors),
      message,
    )
  }

  return result.data
}

// Reads the body and validates it against `schema`, replacing it with the
// parsed (and possibly transformed, e.g. lower-cased) value on success. See
// docs/requirements.md RNF-04 and RNF-08, and the middleware order note
// in section 3: this runs before any query touches the database. Typed with
// the schema's output: a handler expecting fields the schema does not
// guarantee does not compile.
export const validate =
  <S extends z.ZodType>(schema: S) =>
  async (
    req: Request<Record<string, string>, unknown, z.output<S>>,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    await readJsonBody(req, res)

    // The parser leaves no body when there is none, or when the Content-Type
    // is not JSON: a form or a file never reaches the schema.
    if (req.body === undefined) {
      throw BadRequest(ErrorCode.UNREADABLE_BODY, 'Request body is not JSON')
    }

    req.body = parseOrThrow(schema, req.body, 'Invalid request body')
    next()
  }

// Like validate, for the query string. Express 5 will not let req.query be
// replaced, so the result goes to res.locals.query, typed the same way.
export const validateQuery =
  <S extends z.ZodType>(schema: S) =>
  (
    req: Request,
    res: Response<unknown, { query: z.output<S> }>,
    next: NextFunction,
  ): void => {
    res.locals.query = parseOrThrow(schema, req.query, 'Invalid query string')
    next()
  }

// RF-07a · the route parameters, checked before any query: a malformed id is
// a bad request, not a missing case. A valid id is used as it came.
export const validateParams =
  (schema: z.ZodType): RequestHandler =>
  (req, _res, next) => {
    parseOrThrow(schema, req.params, 'Invalid path parameter')
    next()
  }
