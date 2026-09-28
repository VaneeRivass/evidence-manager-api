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

// The last middleware of the chain. Every error ends here and leaves twice:
// explained, to the log (see logger.ts); reduced to a code, to the client.
// An error that is not an AppError is a bug, and nothing about it is revealed.
// No `type`: RFC 9457 reads it as about:blank, and `code` narrows it.
// See docs/requirements.md RF-21 to RF-23 and RNF-07.
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const error = err instanceof Error ? err : new Error(String(err))

  // pino-http writes it on the request's completion line, next to its reqId.
  res.err = error

  const { status, code, params } =
    error instanceof AppError
      ? error
      : { status: 500, code: ErrorCode.INTERNAL_ERROR, params: undefined }

  // Only a ValidationError carries a per-field breakdown instead of params.
  const errors = error instanceof ValidationError ? error.errors : undefined

  res.status(status).type('application/problem+json').json({
    title: STATUS_CODES[status],
    status,
    code,
    params,
    errors,
    requestId: req.id,
  })
}
