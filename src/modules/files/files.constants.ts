// How long a signed link works. The adapters sign with these and report the
// same value, so the lifetime the client is told is the one in the signature.

// docs/modelo-de-datos.md §6 · long enough for the browser to finish the PUT.
export const UPLOAD_URL_TTL_SECONDS = 300

// RF-12
export const DOWNLOAD_URL_TTL_SECONDS = 60

// RF-10 · the name limit of common file systems, so any real file fits, while
// the storage key stays far below its 1024-byte maximum. Bytes, not
// characters: `é` takes two.
export const MAX_FILE_NAME_BYTES = 255
