import * as z from 'zod'
import { MAX_FILE_NAME_BYTES } from './files.constants.js'
import { fitsNameLimit, sanitiseFileName } from './storage-key.js'

// RF-10 · within MAX_FILE_NAME_BYTES. Something must survive sanitising, or
// the key would end in the uuid alone.
const fileName = z.string().superRefine((value, ctx) => {
  if (!fitsNameLimit(value)) {
    ctx.addIssue({
      code: 'too_big',
      origin: 'string',
      maximum: MAX_FILE_NAME_BYTES,
      inclusive: true,
      input: value,
    })
  } else if (sanitiseFileName(value).length === 0) {
    ctx.addIssue({
      code: 'too_small',
      origin: 'string',
      minimum: 1,
      inclusive: true,
      input: value,
    })
  }
})

// RF-10 · what the browser declares about the file before uploading it.
export const requestUploadSchema = z.object({
  fileName,
  // Signed as sent, so the PUT repeats the header the client already has;
  // compared with the allowlist in lowercase by the service.
  contentType: z.string(),
  // In bytes. An empty file is no evidence.
  size: z.number().int().min(1),
})

export type RequestUploadInput = z.infer<typeof requestUploadSchema>

// RF-11 · the key upload-url returned.
export const completeUploadSchema = z.object({ key: z.string() })

export type CompleteUploadInput = z.infer<typeof completeUploadSchema>
