import { env } from '../../shared/config/env.js'
import { type AppError, Conflict } from '../../shared/errors/app-error.js'
import { ErrorCode } from '../../shared/errors/error-codes.js'

// Which files are accepted: rules that come from the environment and from the
// evidence itself, not from the shape of a request, so they live apart from
// files.schema.ts. Asking for a link checks them on what the client declares;
// confirming checks them again on what storage really holds.

// RF-10 · RF-11 · MIME types ignore case.
export const isAllowedContentType = (contentType: string): boolean =>
  env.ALLOWED_MIME_TYPES.includes(contentType.toLowerCase())

// RF-10 · RF-11 · in bytes, from 1: an empty file is no evidence.
export const isAllowedSize = (size: number): boolean =>
  size >= 1 && size <= env.MAX_FILE_SIZE_BYTES

// RF-10 · RF-11 · a case holds one file, attached once and never replaced.
export const alreadyAttached = (caseId: string): AppError =>
  Conflict(ErrorCode.FILE_ALREADY_ATTACHED, `Case ${caseId} already has a file`)
