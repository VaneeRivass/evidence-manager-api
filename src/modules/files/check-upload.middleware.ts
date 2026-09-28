import type { NextFunction, Request, Response } from 'express'
import type { Case } from '../../generated/prisma/client.js'
import { env } from '../../shared/config/env.js'
import { BadRequest } from '../../shared/errors/app-error.js'
import { ErrorCode } from '../../shared/errors/error-codes.js'
import { sessionOf } from '../auth/require-auth.middleware.js'
import {
  type CompleteUploadInput,
  isAllowedContentType,
  type RequestUploadInput,
} from './files.schema.js'
import { type ResolvedUpload, resolveUploadKey } from './file-path.js'

// What checkUploadKey adds to res.locals: the key, resolved.
type UploadLocals = { upload: ResolvedUpload }

// What the handler finds after both steps: the resolved key from
// checkUploadKey, and the case requireOwnedCase adds after it.
export type ResolvedUploadResponse = Response<
  unknown,
  UploadLocals & { case: Case }
>

// Two checks that need no database, so they run before requireOwnedCase
// queries the case (docs/requirements.md, "Middleware order, and why"). They
// are not in the body schema because they depend on the environment or on
// the session, and answer with codes of their own.

// RF-10 · the type is in the allowlist and the declared size within the
// limit. The real size is checked again on confirmation.
export function checkDeclaredFile(
  req: Request<Record<string, string>, unknown, RequestUploadInput>,
  _res: Response,
  next: NextFunction,
): void {
  const { contentType, size: declaredSize } = req.body

  if (!isAllowedContentType(contentType)) {
    throw BadRequest(
      ErrorCode.FILE_TYPE_NOT_ALLOWED,
      `Type ${contentType} is not in the allowlist`,
      { allowed: env.ALLOWED_MIME_TYPES.join(', ') },
    )
  }

  if (declaredSize > env.MAX_FILE_SIZE_BYTES) {
    throw BadRequest(
      ErrorCode.FILE_TOO_LARGE,
      `Declared size ${declaredSize} is over the limit`,
      { max: env.MAX_FILE_SIZE_BYTES },
    )
  }

  next()
}

// RF-11 · the key was signed for the session's user and the case in the URL,
// both known before any query. Resolved here once, and left for the service.
export function checkUploadKey(
  req: Request<{ id: string }, unknown, CompleteUploadInput>,
  res: Response<unknown, UploadLocals>,
  next: NextFunction,
): void {
  const { key } = req.body
  const upload = resolveUploadKey(key, sessionOf(req).id, req.params.id)

  if (!upload) {
    throw BadRequest(
      ErrorCode.FILE_KEY_MISMATCH,
      `Key ${key} was not signed for case ${req.params.id}`,
    )
  }

  res.locals.upload = upload
  next()
}
