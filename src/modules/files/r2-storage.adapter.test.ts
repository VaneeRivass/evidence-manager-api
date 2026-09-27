import { S3ServiceException } from '@aws-sdk/client-s3'
import { describe, expect, it } from 'vitest'
import {
  copySource,
  createR2Storage,
  isNotFound,
} from './r2-storage.adapter.js'

// Signing is local arithmetic with the secret: these tests never reach R2.
const storage = createR2Storage({
  endpoint: 'https://account.r2.cloudflarestorage.com',
  bucket: 'evidence-manager',
  accessKeyId: 'test-key-id',
  secretAccessKey: 'test-secret',
})

describe('createUploadUrl', () => {
  // RF-10 · the PUT must send the same Content-Type that was allowed
  it('puts the content type inside the signature', async () => {
    const { url } = await storage.createUploadUrl({
      key: 'pending/u1/c1/abc-report.pdf',
      contentType: 'application/pdf',
    })
    expect(new URL(url).searchParams.get('X-Amz-SignedHeaders')).toBe(
      'content-type;host',
    )
  })

  // RF-10 · the API never holds the body, so a checksum would be of nothing
  it('carries no checksum of the body', async () => {
    const { url } = await storage.createUploadUrl({
      key: 'pending/u1/c1/abc-report.pdf',
      contentType: 'application/pdf',
    })
    expect(url).not.toContain('checksum')
  })

  // RF-10 · the lifetime the client is told is the one inside the signature
  it('reports the same lifetime it signs', async () => {
    const { url, expiresIn } = await storage.createUploadUrl({
      key: 'pending/u1/c1/abc-report.pdf',
      contentType: 'application/pdf',
    })
    expect(new URL(url).searchParams.get('X-Amz-Expires')).toBe(
      String(expiresIn),
    )
  })
})

describe('createDownloadUrl', () => {
  // RF-12 · the link lives 60 seconds
  it('signs a link that lives 60 seconds', async () => {
    const { url, expiresIn } = await storage.createDownloadUrl({
      key: 'users/u1/cases/c1/abc-report.pdf',
    })
    expect(expiresIn).toBe(60)
    expect(new URL(url).searchParams.get('X-Amz-Expires')).toBe('60')
  })

  // ADR-0004 · delivered as a download, so the file never opens in the browser
  it('asks storage to serve the file as an attachment', async () => {
    const { url } = await storage.createDownloadUrl({
      key: 'users/u1/cases/c1/abc-report.pdf',
    })
    expect(new URL(url).searchParams.get('response-content-disposition')).toBe(
      'attachment',
    )
  })
})

function s3Error(httpStatusCode: number): S3ServiceException {
  return new S3ServiceException({
    name: 'TestError',
    $fault: 'client',
    $metadata: { httpStatusCode },
  })
}

describe('isNotFound', () => {
  // RF-11 · HeadObject on a key nothing was uploaded to answers 404
  it('recognises a 404 from storage', () => {
    expect(isNotFound(s3Error(404))).toBe(true)
  })

  // A refused request is a real failure, not a missing object
  it('does not treat a 403 as missing', () => {
    expect(isNotFound(s3Error(403))).toBe(false)
  })

  it('does not treat an error from outside the SDK as missing', () => {
    expect(isNotFound(new Error('socket hang up'))).toBe(false)
  })
})

describe('copySource', () => {
  // RF-11b · CopyObject reads bucket/key with each segment URL-encoded
  it('prefixes the bucket and keeps the folders', () => {
    expect(copySource('evidence', 'pending/u1/abc-report.pdf')).toBe(
      'evidence/pending/u1/abc-report.pdf',
    )
  })

  // A Spanish file name must survive the move out of pending/
  it('encodes spaces, accents and ñ inside each segment', () => {
    expect(
      copySource('evidence', 'pending/u1/abc-Informe técnico año.pdf'),
    ).toBe('evidence/pending/u1/abc-Informe%20t%C3%A9cnico%20a%C3%B1o.pdf')
  })
})
