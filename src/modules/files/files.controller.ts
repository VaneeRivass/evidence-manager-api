import type { Request } from 'express'
import type { OwnedCaseResponse } from '../../shared/middleware/require-owned-case.js'
import { toPublicCase } from '../cases/cases.mapper.js'
import type { CompleteUploadInput, RequestUploadInput } from './files.schema.js'
import type { FilesService } from './files.service.js'

// RF-10 · requireOwnedCase already found the case and checked the owner.
export const requestUploadUrl =
  (files: FilesService) =>
  async (
    req: Request<never, unknown, RequestUploadInput>,
    res: OwnedCaseResponse,
  ): Promise<void> => {
    const uploadUrl = await files.requestUploadUrl(res.locals.case, req.body)
    res.status(200).json(uploadUrl)
  }

// RF-11
export const completeUpload =
  (files: FilesService) =>
  async (
    req: Request<never, unknown, CompleteUploadInput>,
    res: OwnedCaseResponse,
  ): Promise<void> => {
    const storedCase = await files.completeUpload(res.locals.case, req.body.key)
    res.status(200).json(toPublicCase(storedCase))
  }

// RF-12
export const requestDownloadUrl =
  (files: FilesService) =>
  async (_req: Request, res: OwnedCaseResponse): Promise<void> => {
    const downloadUrl = await files.requestDownloadUrl(res.locals.case)
    res.status(200).json(downloadUrl)
  }
