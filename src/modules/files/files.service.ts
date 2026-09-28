import type { Case } from '../../generated/prisma/client.js'
import { env } from '../../shared/config/env.js'
import {
  BadRequest,
  Conflict,
  NotFound,
} from '../../shared/errors/app-error.js'
import { ErrorCode } from '../../shared/errors/error-codes.js'
import { isMissingRow, prisma } from '../../shared/database/prisma.js'
import { logger } from '../../shared/logging/logger.js'
import {
  buildPendingKey,
  fileNameOf,
  finalKeyOf,
  isPendingKeyOf,
} from './storage-key.js'
import type { RequestUploadInput } from './files.schema.js'
import type { ObjectMetadata, StoragePort } from './storage.port.js'

interface UploadUrl {
  uploadUrl: string
  key: string
  expiresIn: number
}

interface DownloadUrl {
  downloadUrl: string
  expiresIn: number
}

export interface FilesService {
  // RF-10
  requestUploadUrl(item: Case, input: RequestUploadInput): Promise<UploadUrl>
  // RF-11
  completeUpload(item: Case, key: string): Promise<Case>
  // RF-12
  requestDownloadUrl(item: Case): Promise<DownloadUrl>
}

// RF-10 · MIME types ignore case.
const isAllowedType = (contentType: string): boolean =>
  env.ALLOWED_MIME_TYPES.includes(contentType.toLowerCase())

const alreadyAttached = (caseId: string) =>
  Conflict(ErrorCode.FILE_ALREADY_ATTACHED, `Case ${caseId} already has a file`)

// ADR-0006 · the storage is handed in, never imported.
export function createFilesService(storage: StoragePort): FilesService {
  // Deletes each object on its own. A failure is logged and the object left
  // behind: the caller still gets the answer it was going to give (a 400, a
  // 404, a 409), not a 500 about storage.
  async function destroy(...keys: string[]): Promise<void> {
    const results = await Promise.allSettled(
      keys.map((key) => storage.deleteObject(key)),
    )
    results.forEach((result, i) => {
      if (result.status === 'rejected') {
        logger.warn(
          { err: result.reason, key: keys[i] },
          'Object not destroyed',
        )
      }
    })
  }

  // RF-11 · a double click may have stored this file while this request was
  // on its way: if the case already holds the key, that is success; if not,
  // the failure stands.
  async function storedOr(
    caseId: string,
    fileKey: string,
    failure: unknown,
  ): Promise<Case> {
    const stored = await prisma.case.findFirst({
      where: { id: caseId, deletedAt: null, fileKey },
    })
    if (stored) return stored
    throw failure
  }

  // RF-11 · the signature fixed the type but not the size, so both are
  // checked on what storage really holds.
  async function rejectUnlessSizeAndTypeAllowed(
    key: string,
    { size, contentType }: ObjectMetadata,
  ): Promise<void> {
    const allowed =
      size >= 1 && size <= env.MAX_FILE_SIZE_BYTES && isAllowedType(contentType)
    if (allowed) return

    await destroy(key)
    throw BadRequest(
      ErrorCode.FILE_REJECTED,
      `Object at ${key} is ${size} bytes of ${contentType}`,
    )
  }

  // RF-11 · writes the reference only onto a case still live and still
  // without a file: the guard read it before storage was asked, and it may
  // have changed since.
  async function writeReference(
    caseId: string,
    key: string,
    fileKey: string,
    { size, contentType }: ObjectMetadata,
  ): Promise<Case> {
    try {
      return await prisma.case.update({
        // fileKey is unique, so Prisma reads it here as a lookup, not a
        // filter; inside AND it is a filter and accepts null.
        where: { id: caseId, deletedAt: null, AND: { fileKey: null } },
        data: {
          fileKey,
          fileName: fileNameOf(key),
          fileSize: size,
          fileType: contentType.toLowerCase(),
        },
      })
    } catch (error) {
      if (isMissingRow(error)) return settleLostWrite(caseId, key, fileKey)
      return settleFailedWrite(caseId, fileKey, error)
    }
  }

  // RF-11 · the write matched no row: after the guard read the case, it was
  // deleted, or a file was stored. The same key stored meanwhile is this
  // upload, confirmed by another click: kept, and answered as success.
  async function settleLostWrite(
    caseId: string,
    key: string,
    fileKey: string,
  ): Promise<Case> {
    const current = await prisma.case.findFirst({
      where: { id: caseId, deletedAt: null },
    })
    if (current?.fileKey === fileKey) return current

    await destroy(fileKey, key)
    if (!current) throw NotFound(ErrorCode.CASE_NOT_FOUND, 'Case not found')
    throw alreadyAttached(caseId)
  }

  // RF-11 · the write failed for another reason (a timeout), and may have
  // landed before the answer was lost. If the case cannot even be read, the
  // copy stays: deleting a file the case holds would be worse than leaving an
  // orphan. Read and not holding it, the copy would be an orphan outside
  // pending/, so it goes.
  async function settleFailedWrite(
    caseId: string,
    fileKey: string,
    failure: unknown,
  ): Promise<Case> {
    try {
      return await storedOr(caseId, fileKey, failure)
    } catch (error) {
      if (error !== failure) {
        logger.warn({ err: error, key: fileKey }, 'Copy kept: case unreadable')
      } else {
        await destroy(fileKey)
      }
      throw failure
    }
  }

  return {
    async requestUploadUrl(item, { fileName, contentType, size }) {
      if (!isAllowedType(contentType)) {
        throw BadRequest(
          ErrorCode.FILE_TYPE_NOT_ALLOWED,
          `Type ${contentType} is not in the allowlist`,
          { allowed: env.ALLOWED_MIME_TYPES.join(', ') },
        )
      }

      if (size > env.MAX_FILE_SIZE_BYTES) {
        throw BadRequest(
          ErrorCode.FILE_TOO_LARGE,
          `Declared size ${size} is over the limit`,
          { max: env.MAX_FILE_SIZE_BYTES },
        )
      }

      // RF-10 · evidence is attached once and never replaced.
      if (item.fileKey !== null) throw alreadyAttached(item.id)

      const key = buildPendingKey(item.userId, item.id, fileName)
      const { url, expiresIn } = await storage.createUploadUrl({
        key,
        contentType,
      })

      return { uploadUrl: url, key, expiresIn }
    },

    // RF-11 · in the order of the flow in docs/requirements.md.
    async completeUpload(item, key) {
      if (!isPendingKeyOf(key, item.userId, item.id)) {
        throw BadRequest(
          ErrorCode.FILE_KEY_MISMATCH,
          `Key ${key} was not signed for case ${item.id}`,
        )
      }

      const fileKey = finalKeyOf(key)
      // A double click: the first confirmation already moved the object out
      // of pending/, so storage is not asked.
      if (item.fileKey === fileKey) return item

      // Evidence is never replaced: the second upload is thrown away.
      if (item.fileKey !== null) {
        await destroy(key)
        throw alreadyAttached(item.id)
      }

      const object = await storage.headObject(key)
      if (!object) {
        const notUploaded = BadRequest(
          ErrorCode.FILE_NOT_UPLOADED,
          `No object at ${key}`,
        )
        return storedOr(item.id, fileKey, notUploaded)
      }
      await rejectUnlessSizeAndTypeAllowed(key, object)

      // RF-11b · out of pending/.
      try {
        await storage.copyObject({ from: key, to: fileKey })
      } catch (error) {
        return storedOr(item.id, fileKey, error)
      }

      const stored = await writeReference(item.id, key, fileKey, object)
      // Left behind, the 24-hour rule removes it: not worth failing a
      // confirmation that is already stored.
      await destroy(key)
      return stored
    },

    async requestDownloadUrl({ id, fileKey, fileName }) {
      if (fileKey === null || fileName === null) {
        throw NotFound(ErrorCode.FILE_NOT_FOUND, `Case ${id} has no file`)
      }

      const { url, expiresIn } = await storage.createDownloadUrl({
        key: fileKey,
        fileName,
      })

      return { downloadUrl: url, expiresIn }
    },
  }
}
