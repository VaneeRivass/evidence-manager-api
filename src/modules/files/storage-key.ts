// The key of an evidence file in storage: built for an upload, checked on
// confirmation, read back for its final place and its name.
import { randomUUID } from 'node:crypto'
import { MAX_FILE_NAME_BYTES } from './files.constants.js'

// pending/{userId}/{caseId}/{uuid}-{name}: the one description of the
// layout, which buildPendingKey writes and every other function reads. The
// name is a single segment, with no separator whatever it says.
const PENDING_KEY =
  /^pending\/(?<userId>[^/]+)\/(?<caseId>[^/]+)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-(?<name>[^/\\]+)$/

interface PendingKeyParts {
  userId: string
  caseId: string
  name: string
}

const partsOf = (key: string): PendingKeyParts | undefined =>
  PENDING_KEY.exec(key)?.groups as PendingKeyParts | undefined

// docs/modelo-de-datos.md §5 · without separators a name cannot leave its
// folder, so `..` is harmless and kept (`report..pdf` is a valid name).
// Control and format characters go: U+202E can make an .exe read as a .pdf.
export function sanitiseFileName(fileName: string): string {
  return fileName.replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/[/\\]/g, '')
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

// RF-11 · the exact shape buildPendingKey gives, for this user and case. A
// prefix check alone would pass `pending/{user}/{case}/../../other/…`, which
// a client normalising the path would send to another folder. The name must
// be one upload-url could have produced: anything else — overlong, or with a
// control character — would make storage answer an error the API has no code
// for, and the client would get a 500.
export function isPendingKeyOf(
  key: string,
  userId: string,
  caseId: string,
): boolean {
  const parts = partsOf(key)
  if (!parts) return false

  const { userId: keyUserId, caseId: keyCaseId, name } = parts
  return (
    keyUserId === userId &&
    keyCaseId === caseId &&
    sanitiseFileName(name) === name &&
    fitsNameLimit(name)
  )
}

// RF-11b · where a confirmed upload lives: the same user, case, uuid and
// name, out of pending/ so the 24-hour rule never reaches it. Only for a key
// isPendingKeyOf accepted.
export function finalKeyOf(pendingKey: string): string {
  return pendingKey.replace(
    /^pending\/([^/]+)\/([^/]+)\//,
    'users/$1/cases/$2/',
  )
}

// RF-11 · the sanitised name the key carries after its uuid and dash. Only
// for a key isPendingKeyOf accepted: any other is our bug, not the client's.
export function fileNameOf(pendingKey: string): string {
  const parts = partsOf(pendingKey)
  if (!parts) throw new Error(`Not a pending key: ${pendingKey}`)
  return parts.name
}
