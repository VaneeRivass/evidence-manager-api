import type { Case } from '../../generated/prisma/client.js'
import type { CaseStatus } from '../../generated/prisma/enums.js'

// What leaves the API for a case — docs/requirements.md section 1.2.
export type PublicCase = {
  id: string
  title: string
  description: string
  status: CaseStatus
  fileKey: string | null
  fileName: string | null
  fileSize: number | null
  fileType: string | null
  userId: string
  createdAt: string
  updatedAt: string
}

// Lists what goes out, so deletedAt, or a column added later, stays in.
export const toPublicCase = (item: Case): PublicCase => ({
  id: item.id,
  title: item.title,
  description: item.description,
  status: item.status,
  fileKey: item.fileKey,
  fileName: item.fileName,
  fileSize: item.fileSize,
  fileType: item.fileType,
  userId: item.userId,
  createdAt: item.createdAt.toISOString(),
  updatedAt: item.updatedAt.toISOString(),
})
