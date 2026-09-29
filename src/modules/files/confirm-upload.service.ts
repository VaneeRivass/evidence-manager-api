import type { Case } from '../../generated/prisma/client.js'
import { BadRequest, caseNotFound } from '../../shared/errors/app-error.js'
import { ErrorCode } from '../../shared/errors/error-codes.js'
import { isMissingRow, prisma } from '../../shared/database/prisma.js'
import { logger } from '../../shared/logging/logger.js'
import {
  alreadyAttached,
  isAllowedContentType,
  isAllowedSize,
} from './files.policy.js'
import type { ResolvedUpload } from './file-path.js'
import type {
  ObjectMetadata,
  StoragePort,
} from '../../shared/storage/storage.port.js'

// RF-11 · confirming an upload: checked against storage, moved out of
// pending/, and attached to its case — with everything that can go wrong on
// the way: a double click, a case changed meanwhile, a database that fails.
// The key's shape was already checked by checkUploadKey.
export type ConfirmUpload = (
  ownedCase: Case,
  upload: ResolvedUpload,
) => Promise<Case>

// RF-11 · the case, live and already holding this file — or null.
const findCaseWithThisFile = (
  caseId: string,
  finalKey: string,
): Promise<Case | null> =>
  prisma.case.findFirst({
    where: { id: caseId, deletedAt: null, fileKey: finalKey },
  })

// RF-11 · a double click may have stored this file while this request was on
// its way: if the case already holds it, that is success; if not, the failure
// stands. A database error while checking never replaces the failure that
// brought us here, which is the one worth reporting.
async function returnIfAlreadyStored(
  caseId: string,
  finalKey: string,
  failure: unknown,
): Promise<Case> {
  const storedCase = await findCaseWithThisFile(caseId, finalKey).catch(
    (readError: unknown) => {
      logger.warn(
        { err: readError, key: finalKey },
        'Double-click check failed',
      )
      return null
    },
  )
  if (storedCase) return storedCase
  throw failure
}

// ADR-0006 · the storage is handed in, never imported.
export function createConfirmUploadService(
  storage: StoragePort,
): ConfirmUpload {
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
    if (isAllowedSize(size) && isAllowedContentType(contentType)) return

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

  // RF-11 · the write found no row, so the database has answered: it did not
  // save, because after the guard read the case it was deleted or given a
  // file. This same file, stored by another click, is success; anything else
  // leaves the copy with no owner, so it goes.
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
    throw latestCase ? alreadyAttached(caseId) : caseNotFound()
  }

  // RF-11 · the write failed for any other reason — a lost connection, a
  // timeout, a bug. The database may still commit it after we look, so the
  // case not holding the file yet proves nothing: the copy is kept and its
  // path logged. A spare file costs little; a case pointing at a deleted file
  // loses its evidence. Confirming again heals it: the original is still in
  // pending/, so the same copy is made and saved.
  async function recoverIfWriteFailed(
    caseId: string,
    finalKey: string,
    failure: unknown,
  ): Promise<Case> {
    const storedCase = await findCaseWithThisFile(caseId, finalKey).catch(
      () => null,
    )
    if (storedCase) return storedCase

    logger.warn(
      { err: failure, key: finalKey },
      'Copy kept: the write may land',
    )
    throw failure
  }

  // RF-11 · in the order of the flow in docs/requirements.md.
  return async function confirmUpload(ownedCase, upload) {
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

    const storedCase = await saveFileReference(ownedCase.id, upload, uploaded)
    // Left behind, the 24-hour rule removes it: not worth failing a
    // confirmation that is already stored.
    await deleteFromStorage(pendingKey)
    return storedCase
  }
}
