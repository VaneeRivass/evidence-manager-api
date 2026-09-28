import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import {
  DOWNLOAD_URL_TTL_SECONDS,
  UPLOAD_URL_TTL_SECONDS,
} from './files.constants.js'
import type { StoragePort } from './storage.port.js'

export function isNotFound(error: unknown): boolean {
  return (
    error instanceof S3ServiceException &&
    error.$metadata.httpStatusCode === 404
  )
}

// A sanitised name can still carry spaces, and CopyObject signs the literal
// header value, so each segment of the key is URL-encoded.
export function copySource(bucket: string, key: string): string {
  return `${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`
}

// RF-12 · RFC 6266. The plain form is for old clients: ASCII only, no quote
// or backslash to break out of it, and no % a client might decode. The u flag
// counts an emoji as one character, not two. The encoded form (RFC 8187) carries
// the real name, accents included; encodeURIComponent leaves ' ( ) * as they
// are, and RFC 8187 wants them encoded too.
function attachmentNamed(fileName: string): string {
  const plain = fileName.replace(/[^\x20-\x7e]|["\\%]/gu, '_')
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )
  return `attachment; filename="${plain}"; filename*=UTF-8''${encoded}`
}

// ADR-0006 · Signing is tested offline; head, copy and delete reach R2 and
// would need live credentials in CI, so they are checked by hand.
export function createR2Storage(config: {
  endpoint: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
}): StoragePort {
  const { bucket } = config
  const client = new S3Client({
    region: 'auto',
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    // The SDK checksums every request by default. At signing time there is no
    // body — the browser holds the file — so the presigned PUT would carry the
    // checksum of an empty body and storage would reject the real upload.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  })

  return {
    async signUploadUrl({ key, contentType }) {
      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: contentType,
      })
      const url = await getSignedUrl(client, command, {
        expiresIn: UPLOAD_URL_TTL_SECONDS,
        // Without this only `host` is signed, and a PUT could send any type.
        // Lowercase on purpose: the signer compares lowercase header names,
        // so 'Content-Type' would be silently left out of the signature.
        signableHeaders: new Set(['content-type']),
      })
      return { url, expiresIn: UPLOAD_URL_TTL_SECONDS }
    },

    async signDownloadUrl({ key, fileName }) {
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
        // ADR-0004 · an executable renamed to .pdf passes every check, so the
        // file is always saved, never opened in the browser.
        ResponseContentDisposition: attachmentNamed(fileName),
      })
      const url = await getSignedUrl(client, command, {
        expiresIn: DOWNLOAD_URL_TTL_SECONDS,
      })
      return { url, expiresIn: DOWNLOAD_URL_TTL_SECONDS }
    },

    async headObject(key) {
      let result
      try {
        result = await client.send(
          new HeadObjectCommand({ Bucket: bucket, Key: key }),
        )
      } catch (error) {
        if (isNotFound(error)) return null
        throw error
      }

      // The SDK types both as optional. Reading a missing size as 0 would let
      // an object of any size through the limit.
      if (result.ContentLength === undefined || !result.ContentType) {
        throw new Error(`HeadObject returned no size or type for key: ${key}`)
      }
      return { size: result.ContentLength, contentType: result.ContentType }
    },

    async copyObject({ from, to }) {
      await client.send(
        new CopyObjectCommand({
          Bucket: bucket,
          CopySource: copySource(bucket, from),
          Key: to,
        }),
      )
    },

    async deleteObject(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
    },
  }
}
