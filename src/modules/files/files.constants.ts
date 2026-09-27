// How long a signed link works. The adapters sign with these and report the
// same value, so the lifetime the client is told is the one in the signature.

// docs/modelo-de-datos.md §6 · long enough for the browser to finish the PUT.
export const UPLOAD_URL_TTL_SECONDS = 300

// RF-12
export const DOWNLOAD_URL_TTL_SECONDS = 60
