// ADR-0006 · a service receives a StoragePort instead of importing one, so
// tests hand it the in-memory double and the app hands it R2.

export interface ObjectMetadata {
  size: number
  contentType: string
}

// Not exported: only the port's own signatures name it, and nothing outside
// imports it. Exporting it would advertise a type the module does not need to give.
interface SignedUrl {
  url: string
  expiresIn: number
}

export interface StoragePort {
  // The content type is part of the signature: a PUT with another type fails.
  // How long the link lives is the caller's rule, not storage's.
  signUploadUrl(params: {
    key: string
    contentType: string
    expiresIn: number
  }): Promise<SignedUrl>

  // Served as an attachment under fileName, so the file is saved, never
  // opened in the browser, and not named after its key.
  signDownloadUrl(params: {
    key: string
    fileName: string
    expiresIn: number
  }): Promise<SignedUrl>

  // Null when nothing was uploaded, so "missing" is not confused with 0 bytes.
  headObject(key: string): Promise<ObjectMetadata | null>

  // Only copies: moving out of `pending/` is copy, then delete the source.
  copyObject(params: { from: string; to: string }): Promise<void>

  // A missing key is not an error, which is what makes retrying a delete safe.
  deleteObject(key: string): Promise<void>
}
