// Where an evidence file sits in storage — its path, what S3 and R2 call the
// object's key: built for an upload, then resolved on confirmation into where
// the file goes and what it is called.
import { randomUUID } from 'node:crypto'
import { MAX_FILE_NAME_BYTES } from './files.constants.js'

// pending/{userId}/{caseId}/{uuid}-{name}: the one description of the
// layout, which buildPendingKey writes and parseUploadKey reads. The name is
// a single segment, with no separator whatever it says.
const PENDING_KEY =
  /^pending\/(?<userId>[^/]+)\/(?<caseId>[^/]+)\/(?<uuid>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(?<name>[^/\\]+)$/

interface UploadKeyParts {
  userId: string
  caseId: string
  uuid: string
  name: string
}

// What confirmation needs from a key signed for this case: where the file
// is now, where it goes, and what it is called.
export interface ResolvedUpload {
  pendingKey: string
  finalKey: string
  fileName: string
}

// docs/modelo-de-datos.md §5 · without separators a name cannot leave its
// folder, so `..` is harmless and kept (`report..pdf` is a valid name).
// Control and format characters go: U+202E can make an .exe read as a .pdf.
// So does half of a character pair (a lone surrogate): the storage library
// cannot encode it and would fail with a 500. A whole pair, an emoji, stays.
export function sanitiseFileName(fileName: string): string {
  return fileName.replace(/[\p{Cc}\p{Cf}\p{Cs}]/gu, '').replace(/[/\\]/g, '')
}

// RF-10 · bytes, not characters: `é` takes two.
export function fitsNameLimit(fileName: string): boolean {
  return Buffer.byteLength(fileName, 'utf8') <= MAX_FILE_NAME_BYTES
}

// docs/modelo-de-datos.md §5 · the uuid makes the key unguessable; the user and
// the case let confirmation check the key belongs to both (RF-11).
export function buildPendingKey(
  userId: string,
  caseId: string,
  fileName: string,
): string {
  return `pending/${userId}/${caseId}/${randomUUID()}-${sanitiseFileName(fileName)}`
}

// Splits the text of a key into its pieces, or undefined if it has another
// shape: "pending/ana/7/7d2e…-Informe.pdf" → { userId: "ana", caseId: "7", … }.
const parseUploadKey = (pendingKey: string): UploadKeyParts | undefined =>
  PENDING_KEY.exec(pendingKey)?.groups as UploadKeyParts | undefined

// RF-11 · RF-11b · the key a client confirms, resolved into where the file
// goes and what it is called — or null if it was not signed for this user and
// case. Where the file goes is only ever worked out from a key that passed
// the check.
//
// The whole shape is checked, not a prefix: `pending/{user}/{case}/../../x`
// starts right but could reach another folder once a client normalises the
// path. The name must be one upload-url could have produced: overlong, or
// with a control character, storage would answer an error the API has no code
// for, and the client would get a 500.
export function resolveUploadKey(
  pendingKey: string,
  userId: string,
  caseId: string,
): ResolvedUpload | null {
  const parts = parseUploadKey(pendingKey)
  if (!parts) return null

  const { name } = parts
  const signedForThisCase =
    parts.userId === userId &&
    parts.caseId === caseId &&
    sanitiseFileName(name) === name &&
    fitsNameLimit(name)
  if (!signedForThisCase) return null

  return {
    pendingKey,
    // Out of pending/, so the 24-hour rule never reaches it.
    finalKey: `users/${userId}/cases/${caseId}/${parts.uuid}-${name}`,
    fileName: name,
  }
}
