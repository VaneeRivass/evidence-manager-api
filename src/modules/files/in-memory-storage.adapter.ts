import {
  DOWNLOAD_URL_TTL_SECONDS,
  UPLOAD_URL_TTL_SECONDS,
} from './files.constants.js'
import type { ObjectMetadata, StoragePort } from './storage.port.js'

export interface InMemoryStorage extends StoragePort {
  // The browser's PUT never passes through the API, so tests write the object
  // straight into the map instead.
  simulateUpload(key: string, metadata: ObjectMetadata): void
}

// ADR-0006 · stands in for R2 in tests: a map instead of a network call.
export function createInMemoryStorage(): InMemoryStorage {
  const objects = new Map<string, ObjectMetadata>()

  return {
    simulateUpload: (key, metadata) => {
      objects.set(key, metadata)
    },

    signUploadUrl: ({ key, contentType }) =>
      Promise.resolve({
        url: `memory://upload/${key}?contentType=${contentType}`,
        expiresIn: UPLOAD_URL_TTL_SECONDS,
      }),

    signDownloadUrl: ({ key, fileName }) =>
      Promise.resolve({
        url: `memory://download/${key}?fileName=${fileName}`,
        expiresIn: DOWNLOAD_URL_TTL_SECONDS,
      }),

    headObject: (key) => Promise.resolve(objects.get(key) ?? null),

    copyObject: ({ from, to }) => {
      const source = objects.get(from)
      if (!source) {
        return Promise.reject(new Error(`no object at key: ${from}`))
      }
      objects.set(to, source)
      return Promise.resolve()
    },

    // Like S3's DeleteObject, a missing key is not an error (ADR-0005).
    deleteObject: (key) => {
      objects.delete(key)
      return Promise.resolve()
    },
  }
}
