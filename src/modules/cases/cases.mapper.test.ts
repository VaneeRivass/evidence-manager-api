import { describe, expect, it } from 'vitest'
import type { Case } from '../../generated/prisma/client.js'
import { toPublicCase } from './cases.mapper.js'

// A row as Prisma hands it over: Date objects, deletedAt included.
const row = (overrides: Partial<Case> = {}): Case => ({
  id: '3f9c2a1e-8b4d-4c7a-9e21-5d6f7a8b9c0d',
  title: 'Phishing campaign impersonating the bank',
  description: 'Emails received on 24 Sep asking to confirm card details.',
  status: 'OPEN',
  fileKey: 'users/8d2e/cases/3f9c/5b7a-phishing-email-headers.pdf',
  fileName: 'phishing-email-headers.pdf',
  fileSize: 5120,
  fileType: 'application/pdf',
  userId: '8d2e4b1a-6c3f-4e9d-a7b2-1f0e9d8c7b6a',
  deletedAt: null,
  createdAt: new Date('2026-09-24T09:15:00.000Z'),
  updatedAt: new Date('2026-09-26T11:02:33.000Z'),
  ...overrides,
})

describe('toPublicCase', () => {
  // RF-05 · RF-06 · the shape documented in docs/requirements.md section 1.2
  it('returns the documented fields', () => {
    expect(toPublicCase(row())).toEqual({
      id: '3f9c2a1e-8b4d-4c7a-9e21-5d6f7a8b9c0d',
      title: 'Phishing campaign impersonating the bank',
      description: 'Emails received on 24 Sep asking to confirm card details.',
      status: 'OPEN',
      fileKey: 'users/8d2e/cases/3f9c/5b7a-phishing-email-headers.pdf',
      fileName: 'phishing-email-headers.pdf',
      fileSize: 5120,
      fileType: 'application/pdf',
      userId: '8d2e4b1a-6c3f-4e9d-a7b2-1f0e9d8c7b6a',
      createdAt: '2026-09-24T09:15:00.000Z',
      updatedAt: '2026-09-26T11:02:33.000Z',
    })
  })

  // RF-09b · the deletion mark stays inside: a deleted case does not exist
  // for the API, so the field would always be null
  it('leaves the deletion mark out', () => {
    expect(toPublicCase(row())).not.toHaveProperty('deletedAt')
  })

  // A column added to the schema tomorrow does not leak on its own — the
  // mapper names what goes out. See the rule in CLAUDE.md.
  it('ignores a column the mapper does not name', () => {
    const withExtra = { ...row(), internalNote: 'not for the client' } as Case

    expect(toPublicCase(withExtra)).not.toHaveProperty('internalNote')
  })

  // RF-10 · the file fields are null until an upload is confirmed
  it('carries the file fields as null before an upload', () => {
    expect(
      toPublicCase(
        row({ fileKey: null, fileName: null, fileSize: null, fileType: null }),
      ),
    ).toMatchObject({
      fileKey: null,
      fileName: null,
      fileSize: null,
      fileType: null,
    })
  })
})
