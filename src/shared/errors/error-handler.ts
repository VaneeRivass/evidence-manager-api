import type { ErrorRequestHandler, RequestHandler } from 'express'
import { STATUS_CODES } from 'node:http'
import { AppError, NotFound, ValidationError } from './app-error.js'
import { ErrorCode } from './error-codes.js'

// Reached when no route matched. It throws like any other failure, so the
// unknown route answers with the same problem document.
export const notFoundHandler: RequestHandler = (req) => {
  throw NotFound(
    ErrorCode.ROUTE_NOT_FOUND,
    `No route for ${req.method} ${req.path}`,
  )
}

// express.json() rejects a body it cannot read with an error of its own that
// carries a 4xx status and a `type` (entity.parse.failed, entity.too.large,
// charset.unsupported…). Without this it would pass for a bug and answer 500.
// Its message is not kept: JSON.parse quotes the body, and the body may carry
// a password. See docs/requirements.md section 1.4.
const fromBodyParser = (error: Error): AppError | undefined => {
  const { type, status, limit } = error as {
    type?: unknown
    status?: unknown
    limit?: unknown
  }

  if (
    typeof type !== 'string' ||
    typeof status !== 'number' ||
    status < 400 ||
    status >= 500
  ) {
    return undefined
  }

  return type === 'entity.too.large'
    ? new AppError(
        413,
        ErrorCode.PAYLOAD_TOO_LARGE,
        'Request body over the size limit',
        {
          max: Number(limit),
        },
      )
    : new AppError(
        400,
        ErrorCode.UNREADABLE_BODY,
        `Request body could not be read (${type})`,
      )
}

// The last middleware of the chain. Every error ends here and leaves twice:
// explained, to the log (see logger.ts); reduced to a code, to the client.
// An error that is not an AppError is a bug, and nothing about it is revealed.
// No `type`: RFC 9457 reads it as about:blank, and `code` narrows it.
// See docs/requirements.md RF-21 to RF-23 and RNF-07.
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const error = err instanceof Error ? err : new Error(String(err))
  const known = error instanceof AppError ? error : fromBodyParser(error)

  // pino-http writes it on the request's completion line, next to its reqId.
  res.err = known ?? error

  const { status, code, params } = known ?? {
    status: 500,
    code: ErrorCode.INTERNAL_ERROR,
    params: undefined,
  }

  // Only a ValidationError carries a per-field breakdown instead of params.
  const errors = known instanceof ValidationError ? known.errors : undefined

  res.status(status).type('application/problem+json').json({
    title: STATUS_CODES[status],
    status,
    code,
    params,
    errors,
    requestId: req.id,
  })
}
