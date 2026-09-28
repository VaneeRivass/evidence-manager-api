// ADR-0006 · a service receives a StoragePort instead of importing one, so
// tests hand it the in-memory double and the app hands it R2.

export interface ObjectMetadata {
  size: number
  contentType: string
}

export interface SignedUrl {
  url: string
  expiresIn: number
}

export interface StoragePort {
  // The content type is part of the signature: a PUT with another type fails.
  createUploadUrl(params: {
    key: string
    contentType: string
  }): Promise<SignedUrl>

  // Served as an attachment under fileName, so the file is saved, never
  // opened in the browser, and not named after its key.
  createDownloadUrl(params: {
    key: string
    fileName: string
  }): Promise<SignedUrl>

  // Null when nothing was uploaded, so "missing" is not confused with 0 bytes.
  headObject(key: string): Promise<ObjectMetadata | null>

  // Only copies: moving out of `pending/` is copy, then delete the source.
  copyObject(params: { from: string; to: string }): Promise<void>

  // A missing key is not an error, which is what makes retrying a delete safe.
  deleteObject(key: string): Promise<void>
}
