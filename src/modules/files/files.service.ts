import type { Case } from '../../generated/prisma/client.js'
import { env } from '../../shared/config/env.js'
import {
  BadRequest,
  caseNotFound,
  Conflict,
  NotFound,
} from '../../shared/errors/app-error.js'
import { ErrorCode } from '../../shared/errors/error-codes.js'
import { isMissingRow, prisma } from '../../shared/database/prisma.js'
import { logger } from '../../shared/logging/logger.js'
import { buildPendingKey, type ResolvedUpload } from './storage-key.js'
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

// The type and declared size (checkDeclaredFile) and the key's shape
// (checkUploadKey) are checked before the case is queried; what reaches here
// already passed them.
export interface FilesService {
  // RF-10
  requestUploadUrl(
    ownedCase: Case,
    input: RequestUploadInput,
  ): Promise<UploadUrl>
  // RF-11
  completeUpload(ownedCase: Case, upload: ResolvedUpload): Promise<Case>
  // RF-12
  requestDownloadUrl(ownedCase: Case): Promise<DownloadUrl>
}

// RF-10 · MIME types ignore case.
export const isAllowedContentType = (contentType: string): boolean =>
  env.ALLOWED_MIME_TYPES.includes(contentType.toLowerCase())

const alreadyAttached = (caseId: string) =>
  Conflict(ErrorCode.FILE_ALREADY_ATTACHED, `Case ${caseId} already has a file`)

// RF-11 · the case, live and already holding this file — or null. A double
// click may have stored the file while this request was on its way: every
// path that fails after the guard asks this before answering.
const findCaseWithThisFile = (
  caseId: string,
  finalKey: string,
): Promise<Case | null> =>
  prisma.case.findFirst({
    where: { id: caseId, deletedAt: null, fileKey: finalKey },
  })

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
    { pendingKey, finalKey, fileName }: ResolvedUpload,
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
    const storedCase = await findCaseWithThisFile(caseId, finalKey)
    if (storedCase) return storedCase

    await deleteFromStorage(finalKey, pendingKey)
    const latestCase = await prisma.case.findFirst({
      where: { id: caseId, deletedAt: null },
    })
    if (!latestCase) throw caseNotFound()
    throw alreadyAttached(caseId)
  }

  // RF-11 · the write failed for another reason (a timeout), and may have
  // landed before the answer was lost. Holding the file, the case is the
  // answer. Not holding it, the copy would be an orphan outside pending/, so
  // it goes. If the case cannot even be read, the copy stays: deleting a file
  // the case holds would be worse than leaving an orphan.
  async function recoverIfWriteFailed(
    caseId: string,
    finalKey: string,
    failure: unknown,
  ): Promise<Case> {
    let storedCase: Case | null
    try {
      storedCase = await findCaseWithThisFile(caseId, finalKey)
    } catch (readError) {
      logger.warn(
        { err: readError, key: finalKey },
        'Copy kept: case unreadable',
      )
      throw failure
    }

    if (storedCase) return storedCase
    await deleteFromStorage(finalKey)
    throw failure
  }

  return {
    async requestUploadUrl(ownedCase, { fileName, contentType }) {
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
    async completeUpload(ownedCase, upload) {
      const { pendingKey, finalKey } = upload

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
        const storedCase = await findCaseWithThisFile(ownedCase.id, finalKey)
        if (storedCase) return storedCase
        throw BadRequest(
          ErrorCode.FILE_NOT_UPLOADED,
          `No object at ${pendingKey}`,
        )
      }
      await rejectUnlessSizeAndTypeAllowed(pendingKey, uploaded)

      // RF-11b · out of pending/.
      try {
        await storage.copyObject({ from: pendingKey, to: finalKey })
      } catch (error) {
        const storedCase = await findCaseWithThisFile(ownedCase.id, finalKey)
        if (storedCase) return storedCase
        throw error
      }

      const storedCase = await saveFileReference(ownedCase.id, upload, uploaded)
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
