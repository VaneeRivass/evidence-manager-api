import { describe, expect, it } from 'vitest'
import { buildPendingKey } from './build-object-key.js'

const userId = '8f3a1c2e-0000-0000-0000-000000000000'
const caseId = 'c14b0000-0000-0000-0000-000000000000'

describe('buildPendingKey', () => {
  // RF-11 · the user and the case in the key let confirmation check both
  it('starts with pending/{userId}/{caseId}/', () => {
    const key = buildPendingKey(userId, caseId, 'report.pdf')
    expect(key.startsWith(`pending/${userId}/${caseId}/`)).toBe(true)
  })

  // RNF-02 · unguessable: knowing user and case is not enough to build the URL
  it('puts a uuid before the name', () => {
    const key = buildPendingKey(userId, caseId, 'report.pdf')
    expect(key).toMatch(
      /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-report\.pdf$/,
    )
  })

  // RF-10 · a sanitised name stays legible for an everyday file
  it('keeps a plain file name readable', () => {
    const key = buildPendingKey(userId, caseId, 'captura-login.png')
    expect(key).toContain('captura-login.png')
  })

  // RF-10 · `../../otro-caso/x.pdf` would escape its folder if not sanitised
  it('strips path separators so a name cannot escape its folder', () => {
    const key = buildPendingKey(userId, caseId, '../../otro-caso/x.pdf')
    expect(key).not.toContain('/otro-caso')
    expect(key.split('/')).toHaveLength(4)
  })

  // RF-10 · without separators `..` is harmless, and `report..pdf` is a valid name
  it('keeps dots that are part of the name', () => {
    const key = buildPendingKey(userId, caseId, 'report..pdf')
    expect(key).toMatch(/-report\.\.pdf$/)
  })

  // RF-10 · a control character in the name is not stored verbatim
  it('strips control characters from the name', () => {
    const key = buildPendingKey(userId, caseId, 'evil\x00name.pdf')
    // eslint-disable-next-line no-control-regex
    expect(key).not.toMatch(/[\x00-\x1f\x7f]/)
  })

  // RF-10 · a right-to-left override makes `factura‮fdp.exe` read as a .pdf
  it('strips unicode control and format characters from the name', () => {
    const key = buildPendingKey(userId, caseId, 'factura‮fdp\u0085.exe')
    expect(key).toContain('facturafdp.exe')
  })

  // Two uploads of the same file name must not collide on the same key
  it('gives two uploads of the same name different keys', () => {
    const first = buildPendingKey(userId, caseId, 'report.pdf')
    const second = buildPendingKey(userId, caseId, 'report.pdf')
    expect(first).not.toBe(second)
  })
})
