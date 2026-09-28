import type { Request } from 'express'
import type { OwnedCaseResponse } from '../../shared/middleware/load-owned-case.js'
import { toPublicCase } from '../cases/cases.mapper.js'
import type { CompleteUploadInput, RequestUploadInput } from './files.schema.js'
import type { FilesService } from './files.service.js'

// RF-10 · loadOwnedCase already found the case and checked the owner.
export const requestUploadUrl =
  (files: FilesService) =>
  async (
    req: Request<never, unknown, RequestUploadInput>,
    res: OwnedCaseResponse,
  ): Promise<void> => {
    res
      .status(200)
      .json(await files.requestUploadUrl(res.locals.case, req.body))
  }

// RF-11
export const completeUpload =
  (files: FilesService) =>
  async (
    req: Request<never, unknown, CompleteUploadInput>,
    res: OwnedCaseResponse,
  ): Promise<void> => {
    const item = await files.completeUpload(res.locals.case, req.body.key)
    res.status(200).json(toPublicCase(item))
  }

// RF-12
export const requestDownloadUrl =
  (files: FilesService) =>
  async (_req: Request, res: OwnedCaseResponse): Promise<void> => {
    res.status(200).json(await files.requestDownloadUrl(res.locals.case))
  }
