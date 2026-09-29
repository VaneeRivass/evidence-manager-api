import type { Case } from '../../generated/prisma/client.js'
import { NotFound } from '../../shared/errors/app-error.js'
import { ErrorCode } from '../../shared/errors/error-codes.js'
import {
  type ConfirmUpload,
  createConfirmUploadService,
} from './confirm-upload.service.js'
import {
  DOWNLOAD_URL_TTL_SECONDS,
  UPLOAD_URL_TTL_SECONDS,
} from './files.constants.js'
import { alreadyAttached } from './files.policy.js'
import type { RequestUploadInput } from './files.schema.js'
import { buildPendingKey } from './file-path.js'
import type { StoragePort } from '../../shared/storage/storage.port.js'

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
  // RF-11 · in confirm-upload.service.ts, where everything that can go wrong
  // while confirming lives.
  completeUpload: ConfirmUpload
  // RF-12
  requestDownloadUrl(ownedCase: Case): Promise<DownloadUrl>
}

// ADR-0006 · the storage is handed in, never imported.
export function createFilesService(storage: StoragePort): FilesService {
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
        expiresIn: UPLOAD_URL_TTL_SECONDS,
      })

      return { uploadUrl: url, key: pendingKey, expiresIn }
    },

    completeUpload: createConfirmUploadService(storage),

    async requestDownloadUrl({ id, fileKey, fileName }) {
      if (fileKey === null || fileName === null) {
        throw NotFound(ErrorCode.FILE_NOT_FOUND, `Case ${id} has no file`)
      }

      const { url, expiresIn } = await storage.signDownloadUrl({
        key: fileKey,
        fileName,
        expiresIn: DOWNLOAD_URL_TTL_SECONDS,
      })

      return { downloadUrl: url, expiresIn }
    },
  }
}
