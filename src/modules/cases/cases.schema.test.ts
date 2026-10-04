import { describe, expect, it } from 'vitest'
import {
  caseParams,
  createCaseSchema,
  listCasesQuery,
  updateCaseSchema,
} from './cases.schema.js'

describe('createCaseSchema', () => {
  // RF-05 · trimmed before being validated
  it('trims the title and the description', () => {
    const parsed = createCaseSchema.parse({
      title: '  Phishing  ',
      description: '\tEmails from the bank\n',
    })

    expect(parsed).toEqual({
      title: 'Phishing',
      description: 'Emails from the bank',
    })
  })

  // RF-05 · a title made only of spaces counts as empty
  it('rejects a title made only of spaces', () => {
    const result = createCaseSchema.safeParse({
      title: '   ',
      description: 'Emails from the bank',
    })

    expect(result.success).toBe(false)
  })

  // RF-05 · the same limits as the VarChar(120) and VarChar(2000) columns
  it('accepts a title of 120 characters and rejects one of 121', () => {
    const description = 'Emails from the bank'

    expect(
      createCaseSchema.safeParse({ title: 'a'.repeat(120), description })
        .success,
    ).toBe(true)
    expect(
      createCaseSchema.safeParse({ title: 'a'.repeat(121), description })
        .success,
    ).toBe(false)
  })

  // RF-05
  it('accepts a description of 2000 characters and rejects one of 2001', () => {
    const title = 'Phishing'

    expect(
      createCaseSchema.safeParse({ title, description: 'a'.repeat(2000) })
        .success,
    ).toBe(true)
    expect(
      createCaseSchema.safeParse({ title, description: 'a'.repeat(2001) })
        .success,
    ).toBe(false)
  })

  // RF-05 · a title nobody can see is no title
  it.each([
    ['a zero-width space', '\u200B'],
    ['several invisible characters', '\u200B\u2060\uFEFF'],
    ['spaces and invisible characters', ' \u200B\t'],
    ['control characters', '\u0001\u007F'],
  ])('rejects a title made only of %s', (_, title) => {
    const result = createCaseSchema.safeParse({
      title,
      description: 'Emails from the bank',
    })

    expect(result.success).toBe(false)
  })

  // RF-05 · the invisible characters are only left out to ask the question:
  // 🚶‍♂️ is joined by one of them and must come back whole
  it('keeps the invisible characters of a title that has visible text', () => {
    const parsed = createCaseSchema.parse({
      title: 'Caminata 🚶‍♂️',
      description: 'Emails from the bank',
    })

    expect(parsed.title).toBe('Caminata 🚶‍♂️')
  })

  // RF-05 · code points, as VarChar counts them: 🚶‍♂️ is 4, 🇪🇸 is 2, and an
  // accent typed apart from its letter is one more
  it.each([
    ['🚶‍♂️', 30, 31],
    ['🇪🇸', 60, 61],
    ['😀', 120, 121],
    ['a\u0301', 60, 61],
  ])('fits %s %i times in a title, not %i', (piece, fits, overflows) => {
    const description = 'Emails from the bank'

    expect(
      createCaseSchema.safeParse({ title: piece.repeat(fits), description })
        .success,
    ).toBe(true)
    expect(
      createCaseSchema.safeParse({
        title: piece.repeat(overflows),
        description,
      }).success,
    ).toBe(false)
  })

  // RF-05 · nothing visible is too short, whatever its length: one error,
  // not "too short" and "too long" at once
  it('reports one error for invisible text over the maximum', () => {
    const result = createCaseSchema.safeParse({
      title: '\u200B'.repeat(121),
      description: 'Emails from the bank',
    })

    expect(result.error?.issues).toHaveLength(1)
    expect(result.error?.issues[0]?.code).toBe('too_small')
  })

  // RF-05 · the description follows the same rule
  it('rejects a description made only of invisible characters', () => {
    const result = createCaseSchema.safeParse({
      title: 'Phishing',
      description: '\u200B\u0001',
    })

    expect(result.success).toBe(false)
  })

  // RF-05 · PostgreSQL cannot store a null character: a 400, not a 500
  it.each(['title', 'description'])(
    'rejects a null character in the %s',
    (field) => {
      const result = createCaseSchema.safeParse({
        title: 'Phishing',
        description: 'Emails from the bank',
        [field]: 'a\u0000b',
      })

      expect(result.error?.issues[0]?.code).toBe('custom')
      expect(result.error?.issues[0]).toHaveProperty(
        'params.code',
        'INVALID_FORMAT',
      )
    },
  )

  // RF-05 · a null character is its own error even alone: it is a control one,
  // so without checking it first it would read as "nothing visible" (too short)
  it('reports a title of only a null character as invalid format', () => {
    const result = createCaseSchema.safeParse({
      title: '\u0000',
      description: 'Emails from the bank',
    })

    expect(result.error?.issues).toHaveLength(1)
    expect(result.error?.issues[0]?.code).toBe('custom')
    expect(result.error?.issues[0]).toHaveProperty(
      'params.code',
      'INVALID_FORMAT',
    )
  })

  // RF-05 · the owner, the status and the file never come from the body
  it('drops every field other than title and description', () => {
    const parsed = createCaseSchema.parse({
      title: 'Phishing',
      description: 'Emails from the bank',
      userId: 'someone-else',
      status: 'CLOSED',
      fileKey: 'users/someone-else/evidence.pdf',
    })

    expect(Object.keys(parsed).sort()).toEqual(['description', 'title'])
  })
})

describe('listCasesQuery', () => {
  // RF-06 · no filter, most recently updated first
  it('defaults to every status, sorted by update time', () => {
    expect(listCasesQuery.parse({})).toEqual({ sort: 'updatedAt' })
  })

  // RF-06
  it('accepts each status and each sort field', () => {
    expect(listCasesQuery.parse({ status: 'OPEN', sort: 'updatedAt' })).toEqual(
      {
        status: 'OPEN',
        sort: 'updatedAt',
      },
    )
    expect(
      listCasesQuery.parse({ status: 'CLOSED', sort: 'createdAt' }),
    ).toEqual({ status: 'CLOSED', sort: 'createdAt' })
  })

  // RF-06 · the filter is accepted in any case, and normalised to the form
  // the database stores
  it.each(['closed', 'CLOSED', 'Closed'])('reads %s as CLOSED', (status) => {
    expect(listCasesQuery.parse({ status })).toEqual({
      status: 'CLOSED',
      sort: 'updatedAt',
    })
  })

  // RF-06 · RNF-04 · a value outside the enum, in any case, is still rejected
  it.each([
    { status: 'PENDING' },
    { status: 'deleted' },
    { sort: 'deletedAt' },
    { sort: '-updatedAt' },
    { sort: 'title' },
  ])('rejects %o', (query) => {
    expect(listCasesQuery.safeParse(query).success).toBe(false)
  })

  // RF-06 · a misspelled filter is rejected instead of listing every case
  it('rejects a parameter it does not know', () => {
    expect(listCasesQuery.safeParse({ stauts: 'CLOSED' }).success).toBe(false)
  })

  // RF-06 · a repeated parameter arrives as an array: ?status=OPEN&status=CLOSED
  it('rejects a parameter sent twice', () => {
    expect(
      listCasesQuery.safeParse({ status: ['OPEN', 'CLOSED'] }).success,
    ).toBe(false)
  })
})

describe('caseParams', () => {
  // RF-07a
  it('accepts a uuid and rejects anything else', () => {
    expect(caseParams.safeParse({ id: crypto.randomUUID() }).success).toBe(true)
    expect(caseParams.safeParse({ id: 'not-a-uuid' }).success).toBe(false)
  })
})

describe('updateCaseSchema', () => {
  // RF-08 · any one field on its own is a valid edit
  it('accepts a single field', () => {
    expect(updateCaseSchema.parse({ description: 'Updated' })).toEqual({
      description: 'Updated',
    })
  })

  // RF-08 · the rules of creation: trimmed, status in any case
  it('trims the text and reads the status in any case', () => {
    expect(
      updateCaseSchema.parse({ title: '  Phishing  ', status: 'closed' }),
    ).toEqual({ title: 'Phishing', status: 'CLOSED' })
  })

  // RF-08 · the same limits and characters as creation
  it.each([
    { title: '   ' },
    { title: '\u200B' }, // a zero-width space alone
    { title: 'a'.repeat(121) },
    { description: 'a\u0000b' },
    { status: 'PENDING' },
  ])('rejects %o', (body) => {
    expect(updateCaseSchema.safeParse(body).success).toBe(false)
  })

  // RF-08 · the owner and the file never come from the body
  it('drops every field it does not know', () => {
    expect(
      updateCaseSchema.parse({ title: 'Phishing', userId: 'someone-else' }),
    ).toEqual({ title: 'Phishing' })
  })

  // RF-08a · nothing to change would still move the update timestamp
  it.each([{}, { userId: 'someone-else' }])(
    'rejects %o, which has nothing to change',
    (body) => {
      expect(updateCaseSchema.safeParse(body).success).toBe(false)
    },
  )
})
