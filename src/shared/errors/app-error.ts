import { ErrorCode, type FieldCode } from './error-codes.js'

// A failure the code expects and knows how to name. Services throw it without
// knowing anything about HTTP; error-handler.ts turns it into a response.
//
// The `code` travels to the client, which composes the Spanish text from it.
// The `message` is for whoever debugs: it goes to the log, never to the response.
// See docs/requirements.md RF-21 to RF-23.
type Params = Record<string, string | number>

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly params?: Params,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

const withStatus =
  (status: number) =>
  (code: ErrorCode, message: string, params?: Params): AppError =>
    new AppError(status, code, message, params)

export const BadRequest = withStatus(400)
export const Unauthorized = withStatus(401)
export const Forbidden = withStatus(403)
export const NotFound = withStatus(404)
export const Conflict = withStatus(409)
export const PayloadTooLarge = withStatus(413)

// One entry per invalid field. See docs/requirements.md RF-23 for the shape.
export type FieldError = { field: string; code: FieldCode; params?: Params }

// 400 with a per-field breakdown, instead of the single top-level `params`
// every other AppError carries. error-handler.ts reads `.errors` off it.
export class ValidationError extends AppError {
  constructor(readonly errors: FieldError[]) {
    super(400, ErrorCode.VALIDATION_ERROR, 'Invalid request body')
    this.name = 'ValidationError'
  }
}
