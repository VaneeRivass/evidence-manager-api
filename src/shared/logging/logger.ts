import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import {
  pino,
  stdSerializers,
  type DestinationStream,
  type LevelWithSilent,
  type Logger,
} from 'pino'
import { pinoHttp, type HttpLogger } from 'pino-http'
import { env } from '../config/env.js'
import { AppError, ValidationError } from '../errors/app-error.js'

// One place assembles both loggers. The app calls it with the defaults; the
// tests call it with an array as destination and read what would be logged,
// so they check the very code the app runs.
export function createLoggers(
  destination?: DestinationStream,
  level: LevelWithSilent = env.LOG_LEVEL,
): { logger: Logger; httpLogger: HttpLogger } {
  const logger = pino(
    {
      level,
      // No pid or hostname: on a serverless platform they say nothing.
      base: undefined,
      // Backup for logs written by hand: the request line below already
      // leaves headers out. set-cookie is the header that delivers the JWT.
      // Wildcards match exactly one level of nesting: 'password' catches
      // logger.info(user), '*.password' catches logger.info({ user }). A
      // field buried two levels deep or more is a known gap — chasing every
      // depth is not worth it, so the rule stays "never log a raw record".
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        'password',
        'passwordHash',
        '*.password',
        '*.passwordHash',
      ],
    },
    destination,
  )

  // One line per request. It must be enough to diagnose a failure without
  // reproducing it, and nothing more. See docs/requirements.md RF-22.
  const httpLogger = pinoHttp({
    logger,
    // Always generated here; one sent by the client is ignored, so nobody can
    // plant ids in the logs.
    genReqId: () => randomUUID(),
    // req.log carries only the reqId, so anything a handler logs along the way
    // is joined to its request without repeating the whole request.
    quietReqLogger: true,
    // Our serializers receive the raw objects, not pino-http's own serialized
    // copies: otherwise an AppError arrives as a plain object and loses its type.
    wrapSerializers: false,
    serializers: {
      // No headers: they add nothing to a diagnosis and carry cookies and tokens.
      req: (req: IncomingMessage) => ({
        method: req.method,
        url: req.url,
        userAgent: req.headers['user-agent'],
      }),
      res: (res: ServerResponse) => ({ statusCode: res.statusCode }),
      // An AppError is expected: its code and message explain it, a stack would
      // only add noise. Anything else is a bug and is logged whole. A
      // ValidationError adds which fields failed and why — names and codes
      // only, never the values sent, so no password can reach the log.
      err: (err: Error) =>
        err instanceof AppError
          ? {
              code: err.code,
              message: err.message,
              params: err.params,
              errors: err instanceof ValidationError ? err.errors : undefined,
            }
          : stdSerializers.err(err),
    },
    // By status, not by the presence of an error: a 404 carries an AppError too,
    // and it is the caller's mistake, not ours.
    // Typed on purpose: pino-http would otherwise accept a typo as a custom level.
    customLogLevel: (_req, res): LevelWithSilent => {
      if (res.statusCode >= 500) return 'error'
      if (res.statusCode >= 400) return 'warn'
      return 'info'
    },
  })

  return { logger, httpLogger }
}

export const { logger, httpLogger } = createLoggers()
