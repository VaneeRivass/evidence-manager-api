import { describe, expect, it } from 'vitest'
import { createCaseSchema, listCasesQuery } from './cases.schema.js'

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

  // RF-05 · PostgreSQL cannot store a null character: a 400, not a 500
  it.each(['title', 'description'])(
    'rejects a null character in the %s',
    (field) => {
      const result = createCaseSchema.safeParse({
        title: 'Phishing',
        description: 'Emails from the bank',
        [field]: 'a\u0000b',
      })

      expect(result.success).toBe(false)
    },
  )

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
