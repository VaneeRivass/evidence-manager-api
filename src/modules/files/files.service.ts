import type { Case } from '../../generated/prisma/client.js'
import { env } from '../../shared/config/env.js'
import {
  BadRequest,
  Conflict,
  NotFound,
} from '../../shared/errors/app-error.js'
import { ErrorCode } from '../../shared/errors/error-codes.js'
import { caseNotFound } from '../../shared/middleware/require-owned-case.js'
import { isMissingRow, prisma } from '../../shared/database/prisma.js'
import { logger } from '../../shared/logging/logger.js'
import {
  buildPendingKey,
  type ResolvedUpload,
  resolveUploadKey,
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
  requestUploadUrl(
    ownedCase: Case,
    input: RequestUploadInput,
  ): Promise<UploadUrl>
  // RF-11
  completeUpload(ownedCase: Case, pendingKey: string): Promise<Case>
  // RF-12
  requestDownloadUrl(ownedCase: Case): Promise<DownloadUrl>
}

// RF-10 · MIME types ignore case.
const isAllowedContentType = (contentType: string): boolean =>
  env.ALLOWED_MIME_TYPES.includes(contentType.toLowerCase())

const alreadyAttached = (caseId: string) =>
  Conflict(ErrorCode.FILE_ALREADY_ATTACHED, `Case ${caseId} already has a file`)

// ADR-0006 · the storage is handed in, never imported.
export function createFilesService(storage: StoragePort): FilesService {
  // Deletes objects from storage (never from the database). A failure is
  // logged and the object left behind: the caller still gets the answer it
  // was going to give (a 400, a 404, a 409), not a 500 about storage.
  async function deleteFromStorage(...keys: string[]): Promise<void> {
    await Promise.all(
      keys.map((key) =>
        storage.deleteObject(key).catch((error: unknown) => {
          logger.warn({ err: error, key }, 'Object not deleted from storage')
        }),
      ),
    )
  }

  // RF-11 · a double click may have stored this file while this request was
  // on its way: if the case already holds it, that is success; if not, the
  // failure stands.
  async function returnIfAlreadyStored(
    caseId: string,
    finalKey: string,
    failure: unknown,
  ): Promise<Case> {
    const storedCase = await prisma.case.findFirst({
      where: { id: caseId, deletedAt: null, fileKey: finalKey },
    })
    if (storedCase) return storedCase
    throw failure
  }

  // RF-11 · the signature fixed the type but not the size, so both are
  // checked on what storage really holds. A rejected file is deleted at once
  // rather than left 24 hours in pending/.
  async function rejectUnlessSizeAndTypeAllowed(
    pendingKey: string,
    { size, contentType }: ObjectMetadata,
  ): Promise<void> {
    const allowed =
      size >= 1 &&
      size <= env.MAX_FILE_SIZE_BYTES &&
      isAllowedContentType(contentType)
    if (allowed) return

    await deleteFromStorage(pendingKey)
    throw BadRequest(
      ErrorCode.FILE_REJECTED,
      `Object at ${pendingKey} is ${size} bytes of ${contentType}`,
    )
  }

  // RF-11 · writes the file onto the case, only while the case is still live
  // and still without a file: the guard read it before storage was asked, and
  // it may have changed since.
  async function saveFileReference(
    caseId: string,
    pendingKey: string,
    { finalKey, fileName }: ResolvedUpload,
    { size, contentType }: ObjectMetadata,
  ): Promise<Case> {
    try {
      return await prisma.case.update({
        // fileKey is unique, so Prisma reads it here as a lookup, not a
        // filter; inside AND it is a filter and accepts null.
        where: { id: caseId, deletedAt: null, AND: { fileKey: null } },
        data: {
          fileKey: finalKey,
          fileName,
          fileSize: size,
          fileType: contentType.toLowerCase(),
        },
      })
    } catch (error) {
      if (isMissingRow(error)) {
        return recoverIfCaseChanged(caseId, pendingKey, finalKey)
      }
      return recoverIfWriteFailed(caseId, finalKey, error)
    }
  }

  // RF-11 · the write found no row: after the guard read the case, it was
  // deleted, or a file was stored. This same file, stored by another click,
  // is success; anything else leaves the copy with no owner, so it goes.
  async function recoverIfCaseChanged(
    caseId: string,
    pendingKey: string,
    finalKey: string,
  ): Promise<Case> {
    const latestCase = await prisma.case.findFirst({
      where: { id: caseId, deletedAt: null },
    })
    if (latestCase?.fileKey === finalKey) return latestCase

    await deleteFromStorage(finalKey, pendingKey)
    if (!latestCase) throw caseNotFound()
    throw alreadyAttached(caseId)
  }

  // RF-11 · the write failed for another reason (a timeout), and may have
  // landed before the answer was lost. If the case cannot even be read, the
  // copy stays: deleting a file the case holds would be worse than leaving an
  // orphan. Read and not holding it, the copy would be an orphan outside
  // pending/, so it goes.
  async function recoverIfWriteFailed(
    caseId: string,
    finalKey: string,
    failure: unknown,
  ): Promise<Case> {
    try {
      return await returnIfAlreadyStored(caseId, finalKey, failure)
    } catch (error) {
      if (error === failure) {
        await deleteFromStorage(finalKey)
      } else {
        logger.warn({ err: error, key: finalKey }, 'Copy kept: case unreadable')
      }
      throw failure
    }
  }

  return {
    async requestUploadUrl(ownedCase, input) {
      const { fileName, contentType, size: declaredSize } = input

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

      // RF-10 · evidence is attached once and never replaced.
      if (ownedCase.fileKey !== null) throw alreadyAttached(ownedCase.id)

      const pendingKey = buildPendingKey(
        ownedCase.userId,
        ownedCase.id,
        fileName,
      )
      const { url, expiresIn } = await storage.signUploadUrl({
        key: pendingKey,
        contentType,
      })

      return { uploadUrl: url, key: pendingKey, expiresIn }
    },

    // RF-11 · in the order of the flow in docs/requirements.md.
    async completeUpload(ownedCase, pendingKey) {
      const upload = resolveUploadKey(
        pendingKey,
        ownedCase.userId,
        ownedCase.id,
      )
      if (!upload) {
        throw BadRequest(
          ErrorCode.FILE_KEY_MISMATCH,
          `Key ${pendingKey} was not signed for case ${ownedCase.id}`,
        )
      }
      const { finalKey } = upload

      // A double click: the first confirmation already stored this very file,
      // and moved it out of pending/, so storage is not asked.
      if (ownedCase.fileKey === finalKey) return ownedCase

      // Evidence is never replaced: the second upload is thrown away.
      if (ownedCase.fileKey !== null) {
        await deleteFromStorage(pendingKey)
        throw alreadyAttached(ownedCase.id)
      }

      const uploaded = await storage.headObject(pendingKey)
      if (!uploaded) {
        const notUploaded = BadRequest(
          ErrorCode.FILE_NOT_UPLOADED,
          `No object at ${pendingKey}`,
        )
        return returnIfAlreadyStored(ownedCase.id, finalKey, notUploaded)
      }
      await rejectUnlessSizeAndTypeAllowed(pendingKey, uploaded)

      // RF-11b · out of pending/.
      try {
        await storage.copyObject({ from: pendingKey, to: finalKey })
      } catch (error) {
        return returnIfAlreadyStored(ownedCase.id, finalKey, error)
      }

      const storedCase = await saveFileReference(
        ownedCase.id,
        pendingKey,
        upload,
        uploaded,
      )
      // Left behind, the 24-hour rule removes it: not worth failing a
      // confirmation that is already stored.
      await deleteFromStorage(pendingKey)
      return storedCase
    },

    async requestDownloadUrl({ id, fileKey, fileName }) {
      if (fileKey === null || fileName === null) {
        throw NotFound(ErrorCode.FILE_NOT_FOUND, `Case ${id} has no file`)
      }

      const { url, expiresIn } = await storage.signDownloadUrl({
        key: fileKey,
        fileName,
      })

      return { downloadUrl: url, expiresIn }
    },
  }
}
