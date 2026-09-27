import { randomUUID } from 'node:crypto'

// docs/modelo-de-datos.md §5 · without separators a name cannot leave its
// folder, so `..` is harmless and kept (`report..pdf` is a valid name).
// Control and format characters go: U+202E can make an .exe read as a .pdf.
function sanitiseFileName(fileName: string): string {
  return fileName.replace(/[\p{Cc}\p{Cf}]/gu, '').replace(/[/\\]/g, '')
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
