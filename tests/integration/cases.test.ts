import request from 'supertest'
import { afterAll, describe, expect, it } from 'vitest'
import { createApp } from '../../src/app.js'
import { createInMemoryStorage } from '../../src/modules/files/in-memory-storage.adapter.js'
import { prisma } from '../../src/shared/database/prisma.js'
import type {
  Case as CaseRow,
  Prisma,
} from '../../src/generated/prisma/client.js'
import type { PublicCase } from '../../src/modules/cases/cases.mapper.js'
import {
  deleteCase as deleteCaseRow,
  updateCase as updateCaseRow,
} from '../../src/modules/cases/cases.service.js'
import { AppError } from '../../src/shared/errors/app-error.js'
import { type Signed, signIn } from '../integration-setup.js'
import { listen } from '../helpers.js'

// Exercises the real app: the cases routes, requireAuth, the validators and
// Prisma against PostgreSQL. It signs in through /auth because the session is
// what decides whose cases these are. Storage is the in-memory double
// (ADR-0006): deleting a case destroys its file there.
const storage = createInMemoryStorage()
const server = await listen(createApp(storage))
afterAll(() => server.close())

// The same app over the same database, with a storage that fails every delete.
const failingServer = await listen(
  createApp({
    ...storage,
    deleteObject: () => Promise.reject(new Error('R2 unavailable')),
  }),
)
afterAll(() => failingServer.close())

// Straight into the database, so a test can set what the API never accepts:
// another owner, a status, a deletion mark, a fixed timestamp.
const seed = (userId: string, data: Partial<Prisma.CaseUncheckedCreateInput>) =>
  prisma.case.create({
    data: {
      title: 'Phishing campaign',
      description: 'Emails asking to confirm card details.',
      userId,
      ...data,
    },
  })

const createCase = ({ cookie }: Signed, body: object) =>
  request(server).post('/cases').set('Cookie', cookie).send(body)

const listCases = ({ cookie }: Signed, query = '') =>
  request(server).get(`/cases${query}`).set('Cookie', cookie)

const readCase = ({ cookie }: Signed, id: string) =>
  request(server).get(`/cases/${id}`).set('Cookie', cookie)

const updateCase = ({ cookie }: Signed, id: string, body: object) =>
  request(server).patch(`/cases/${id}`).set('Cookie', cookie).send(body)

const deleteCase = ({ cookie }: Signed, id: string) =>
  request(server).delete(`/cases/${id}`).set('Cookie', cookie)

const titlesOf = (body: unknown) =>
  (body as { items: PublicCase[] }).items.map(({ title }) => title)

describe('POST /cases', () => {
  // RF-05
  it('answers 201 with the case, open and with no file', async () => {
    const owner = await signIn(server)

    const res = await createCase(owner, {
      title: 'Phishing',
      description: 'Emails from the bank',
    })

    expect(res.status).toBe(201)
    expect(res.body as PublicCase).toMatchObject({
      title: 'Phishing',
      description: 'Emails from the bank',
      status: 'OPEN',
      fileKey: null,
      fileName: null,
      fileSize: null,
      fileType: null,
      userId: owner.userId,
    })
  })

  // RF-05 · the shape documented in docs/requirements.md section 1.2
  it('returns the documented fields and never the deletion mark', async () => {
    const owner = await signIn(server)

    const res = await createCase(owner, {
      title: 'Phishing',
      description: 'Emails from the bank',
    })

    expect(Object.keys(res.body as PublicCase).sort()).toEqual([
      'createdAt',
      'description',
      'fileKey',
      'fileName',
      'fileSize',
      'fileType',
      'id',
      'status',
      'title',
      'updatedAt',
      'userId',
    ])
  })

  // RF-05 · the owner comes from the session: nobody creates a case in
  // someone else's name, closed, or pointing at someone else's file
  it('ignores an owner, a status and a file sent in the body', async () => {
    const owner = await signIn(server)
    const intruder = await signIn(server)

    const res = await createCase(owner, {
      title: 'Phishing',
      description: 'Emails from the bank',
      userId: intruder.userId,
      status: 'CLOSED',
      fileKey: 'users/someone-else/evidence.pdf',
    })

    expect(res.status).toBe(201)
    expect(res.body as PublicCase).toMatchObject({
      userId: owner.userId,
      status: 'OPEN',
      fileKey: null,
    })
  })

  // RF-05 · trimmed before being validated, so spaces alone are not a title
  it('answers 400 for a title made only of spaces', async () => {
    const owner = await signIn(server)

    const res = await createCase(owner, {
      title: '   ',
      description: 'Emails from the bank',
    })

    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(await prisma.case.count()).toBe(0)
  })

  // RF-05 · the same limit as the column, so it never reaches the database
  it('answers 400 for a title over 120 characters', async () => {
    const owner = await signIn(server)

    const res = await createCase(owner, {
      title: 'a'.repeat(121),
      description: 'Emails from the bank',
    })

    expect(res.status).toBe(400)
    expect(await prisma.case.count()).toBe(0)
  })

  // RF-05 · PostgreSQL cannot store a null character: stopped before it
  it('answers 400 for a null character in the title', async () => {
    const owner = await signIn(server)

    const res = await createCase(owner, {
      title: 'a\u0000b',
      description: 'Emails from the bank',
    })

    expect(res.status).toBe(400)
    expect(await prisma.case.count()).toBe(0)
  })

  // RNF-01 · without a session nothing is created
  it('answers 401 without a session', async () => {
    const res = await request(server)
      .post('/cases')
      .send({ title: 'Phishing', description: 'Emails from the bank' })

    expect(res.status).toBe(401)
    expect(await prisma.case.count()).toBe(0)
  })
})

describe('GET /cases', () => {
  // RF-06
  it('answers 200 with the user’s cases and how many there are', async () => {
    const owner = await signIn(server)
    await seed(owner.userId, { title: 'Phishing' })

    const res = await listCases(owner)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ total: 1 })
    expect(titlesOf(res.body)).toEqual(['Phishing'])
  })

  // RF-06 · RNF-01 · only the authenticated user's cases
  it('leaves out another user’s cases', async () => {
    const owner = await signIn(server)
    const stranger = await signIn(server)
    await seed(owner.userId, { title: 'Mine' })
    await seed(stranger.userId, { title: 'Not mine' })

    const res = await listCases(owner)

    expect(res.body).toMatchObject({ total: 1 })
    expect(titlesOf(res.body)).toEqual(['Mine'])
  })

  // RF-09b · a deleted case does not exist for the API
  it('leaves out deleted cases, and does not count them', async () => {
    const owner = await signIn(server)
    await seed(owner.userId, { title: 'Live' })
    await seed(owner.userId, { title: 'Deleted', deletedAt: new Date() })

    const res = await listCases(owner)

    expect(res.body).toMatchObject({ total: 1 })
    expect(titlesOf(res.body)).toEqual(['Live'])
  })

  // RF-06 · the filter is accepted in any case
  it.each(['CLOSED', 'closed'])('filters by status=%s', async (status) => {
    const owner = await signIn(server)
    await seed(owner.userId, { title: 'Open one' })
    await seed(owner.userId, { title: 'Closed one', status: 'CLOSED' })

    const res = await listCases(owner, `?status=${status}`)

    expect(res.body).toMatchObject({ total: 1 })
    expect(titlesOf(res.body)).toEqual(['Closed one'])
  })

  // RF-06 · without the filter, both states
  it('returns both states when no status is given', async () => {
    const owner = await signIn(server)
    await seed(owner.userId, { title: 'Open one' })
    await seed(owner.userId, { title: 'Closed one', status: 'CLOSED' })

    const res = await listCases(owner)

    expect(res.body).toMatchObject({ total: 2 })
  })

  // RF-06 · most recently updated first, by default
  it('sorts by update time, newest first', async () => {
    const owner = await signIn(server)
    await seed(owner.userId, {
      title: 'Older',
      updatedAt: new Date('2026-09-20T10:00:00.000Z'),
    })
    await seed(owner.userId, {
      title: 'Newer',
      updatedAt: new Date('2026-09-25T10:00:00.000Z'),
    })

    expect(titlesOf((await listCases(owner)).body)).toEqual(['Newer', 'Older'])
  })

  // RF-06 · newest first here too
  it('sorts by creation time when asked', async () => {
    const owner = await signIn(server)
    await seed(owner.userId, {
      title: 'Older',
      createdAt: new Date('2026-09-20T10:00:00.000Z'),
    })
    await seed(owner.userId, {
      title: 'Newer',
      createdAt: new Date('2026-09-25T10:00:00.000Z'),
    })

    const res = await listCases(owner, '?sort=createdAt')

    expect(titlesOf(res.body)).toEqual(['Newer', 'Older'])
  })

  // RNF-06 · never more than 100 rows, and total says how many were left out
  it('returns at most 100 cases, counting every one of them', async () => {
    const owner = await signIn(server)
    await prisma.case.createMany({
      data: Array.from({ length: 101 }, (_, index) => ({
        title: `Case ${index}`,
        description: 'Emails asking to confirm card details.',
        userId: owner.userId,
      })),
    })

    const res = await listCases(owner)

    expect((res.body as { items: PublicCase[] }).items).toHaveLength(100)
    expect(res.body).toMatchObject({ total: 101 })
  })

  // RF-06 · RNF-04 · a value outside the enum is rejected before any query
  it.each([
    '?status=PENDING',
    '?sort=deletedAt',
    '?sort=title',
    '?stauts=CLOSED',
  ])('answers 400 for %s', async (query) => {
    const owner = await signIn(server)

    const res = await listCases(owner, query)

    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  // RNF-01 · no session, no data
  it('answers 401 without a session', async () => {
    const res = await request(server).get('/cases')

    expect(res.status).toBe(401)
  })
})

// RF-09b · the three ways into one case: every guard test runs against each,
// so a route mounted without loadOwnedCase fails here.
describe.each([
  { route: 'GET', send: readCase },
  {
    route: 'PATCH',
    send: (user: Signed, id: string) => updateCase(user, id, { title: 'New' }),
  },
  { route: 'DELETE', send: deleteCase },
])('$route /cases/:id', ({ send }) => {
  // RF-07a · a bad request, not a missing case
  it('answers 400 for a malformed id', async () => {
    const owner = await signIn(server)

    const res = await send(owner, 'not-a-uuid')

    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ errors: [{ field: 'id' }] })
  })

  // RF-07
  it('answers 404 for a case that does not exist', async () => {
    const owner = await signIn(server)

    const res = await send(owner, crypto.randomUUID())

    expect(res.status).toBe(404)
    expect(res.body).toMatchObject({ code: 'CASE_NOT_FOUND' })
  })

  // RF-09b · even knowing its id
  it('answers 404 for a deleted case', async () => {
    const owner = await signIn(server)
    const { id } = await seed(owner.userId, { deletedAt: new Date() })

    const res = await send(owner, id)

    expect(res.status).toBe(404)
    expect(res.body).toMatchObject({ code: 'CASE_NOT_FOUND' })
  })

  // RF-07 · RNF-01
  it('answers 403 for someone else\u2019s case, and leaves it as it was', async () => {
    const owner = await signIn(server)
    const stranger = await signIn(server)
    const before = await seed(owner.userId, {})

    const res = await send(stranger, before.id)

    expect(res.status).toBe(403)
    expect(res.body).toMatchObject({ code: 'CASE_FORBIDDEN' })
    expect(
      await prisma.case.findUniqueOrThrow({ where: { id: before.id } }),
    ).toEqual(before)
  })

  // RNF-01
  it('answers 401 without a session', async () => {
    const owner = await signIn(server)
    const { id } = await seed(owner.userId, {})

    const res = await send({ cookie: '', userId: '' }, id)

    expect(res.status).toBe(401)
  })
})

describe('GET /cases/:id', () => {
  // RF-07 · the same shape as every other case response
  it('answers 200 with the case', async () => {
    const owner = await signIn(server)
    const { id } = await seed(owner.userId, { title: 'Phishing' })

    const res = await readCase(owner, id)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      id,
      title: 'Phishing',
      userId: owner.userId,
    })
    expect(res.body).not.toHaveProperty('deletedAt')
  })
})

describe('PATCH /cases/:id', () => {
  // RF-08 · what is not sent stays as it was
  it('changes only the fields sent', async () => {
    const owner = await signIn(server)
    const { id } = await seed(owner.userId, {
      title: 'Old title',
      description: 'Kept',
    })

    const res = await updateCase(owner, id, { title: 'New title' })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ title: 'New title', description: 'Kept' })
  })

  // RF-08 · no transition rules, and the status in any case
  it('reopens a closed case', async () => {
    const owner = await signIn(server)
    const { id } = await seed(owner.userId, { status: 'CLOSED' })

    const res = await updateCase(owner, id, { status: 'open' })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ status: 'OPEN' })
  })

  // RF-08 · nobody hands their case to someone else
  it('ignores an owner sent in the body', async () => {
    const owner = await signIn(server)
    const stranger = await signIn(server)
    const { id } = await seed(owner.userId, {})

    const res = await updateCase(owner, id, {
      title: 'New title',
      userId: stranger.userId,
    })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ userId: owner.userId })
  })

  // RF-08b · the same values are not an error, but writing them would move
  // the case to the top of the list for nothing
  it('does not touch the case when the values are the ones stored', async () => {
    const owner = await signIn(server)
    const before = await seed(owner.userId, {
      title: 'Phishing',
      status: 'CLOSED',
    })

    const res = await updateCase(owner, before.id, {
      title: 'Phishing',
      status: 'closed',
    })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ title: 'Phishing', status: 'CLOSED' })
    expect(
      await prisma.case.findUniqueOrThrow({ where: { id: before.id } }),
    ).toEqual(before)
  })

  // RF-08b · one field that does differ is still a real edit
  it('writes when one of the values sent differs', async () => {
    const owner = await signIn(server)
    const before = await seed(owner.userId, { title: 'Phishing' })

    const res = await updateCase(owner, before.id, {
      title: 'Phishing',
      description: 'Another description',
    })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ description: 'Another description' })
    expect(
      (
        await prisma.case.findUniqueOrThrow({ where: { id: before.id } })
      ).updatedAt.getTime(),
    ).toBeGreaterThan(before.updatedAt.getTime())
  })

  // RF-08a · the case is not touched, so it does not jump to the top
  it('answers 400 for an edit with nothing to change', async () => {
    const owner = await signIn(server)
    const before = await seed(owner.userId, {})

    const res = await updateCase(owner, before.id, {})

    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({
      errors: [{ field: '(root)', code: 'NOTHING_TO_CHANGE' }],
    })
    expect(
      await prisma.case.findUniqueOrThrow({ where: { id: before.id } }),
    ).toEqual(before)
  })

  // RF-08 · the rules of creation
  it('answers 400 for a title made only of spaces', async () => {
    const owner = await signIn(server)
    const { id } = await seed(owner.userId, {})

    const res = await updateCase(owner, id, { title: '   ' })

    expect(res.status).toBe(400)
  })
})

describe('DELETE /cases/:id', () => {
  // RF-09 · RNF-05 · the row stays as a trail; only the file key is cleared
  it('answers 204 and marks the case, keeping the row', async () => {
    const owner = await signIn(server)
    const { id } = await seed(owner.userId, {
      fileKey: `users/${owner.userId}/evidence.pdf`,
      fileName: 'evidence.pdf',
      fileSize: 5120,
      fileType: 'application/pdf',
    })

    const res = await deleteCase(owner, id)

    expect(res.status).toBe(204)
    expect(
      await prisma.case.findUniqueOrThrow({ where: { id } }),
    ).toMatchObject({
      deletedAt: expect.any(Date) as Date,
      fileKey: null,
      fileName: 'evidence.pdf',
    })
  })

  // RF-09b · through the API, not a seeded mark
  it('makes the case answer 404 and leave the list', async () => {
    const owner = await signIn(server)
    const { id } = await seed(owner.userId, {})

    await deleteCase(owner, id)

    expect((await readCase(owner, id)).status).toBe(404)
    expect((await listCases(owner)).body).toMatchObject({ total: 0 })
  })

  // RF-09 · nothing is left behind in storage
  it('destroys the case’s file in storage', async () => {
    const owner = await signIn(server)
    const fileKey = `users/${owner.userId}/cases/c1/abc-evidence.pdf`
    storage.simulateUpload(fileKey, {
      size: 5120,
      contentType: 'application/pdf',
    })
    const { id } = await seed(owner.userId, { fileKey })

    const res = await deleteCase(owner, id)

    expect(res.status).toBe(204)
    expect(await storage.headObject(fileKey)).toBeNull()
  })
})

// RF-09 · storage refusing to destroy the file, through failingServer.
describe('DELETE /cases/:id when storage cannot destroy the file', () => {
  const deleteThrough = ({ cookie }: Signed, id: string) =>
    request(failingServer).delete(`/cases/${id}`).set('Cookie', cookie)

  // Storage first: if it fails, the case is still there, with its file, and
  // deleting again is safe
  it('answers 500 and leaves the case untouched', async () => {
    const owner = await signIn(server)
    const before = await seed(owner.userId, {
      fileKey: `users/${owner.userId}/cases/c1/abc-evidence.pdf`,
    })

    const res = await deleteThrough(owner, before.id)

    expect(res.status).toBe(500)
    expect(
      await prisma.case.findUniqueOrThrow({ where: { id: before.id } }),
    ).toEqual(before)
  })

  // A case with no file never asks storage, so its failure cannot matter
  it('still deletes a case with no file', async () => {
    const owner = await signIn(server)
    const { id } = await seed(owner.userId, {})

    const res = await deleteThrough(owner, id)

    expect(res.status).toBe(204)
  })
})

// RF-09b · the guard reads the case, then the write happens: in between, another
// request can delete it. A double-clicked Delete button reaches this.
describe('a case deleted between the check and the write', () => {
  it.each([
    {
      action: 'update',
      run: (item: CaseRow) => updateCaseRow(item, { title: 'New' }),
    },
    {
      action: 'delete',
      run: (item: CaseRow) => deleteCaseRow(item, storage),
    },
  ])('answers 404 instead of failing on $action', async ({ run }) => {
    const owner = await signIn(server)
    const item = await seed(owner.userId, { deletedAt: new Date() })

    await expect(run(item)).rejects.toMatchObject({
      status: 404,
      code: 'CASE_NOT_FOUND',
    })
    await expect(run(item)).rejects.toBeInstanceOf(AppError)
  })
})

// RF-09 · the guard read the case with no file; a confirmation stored one
// before the delete landed. Cleared without destroying it, that file would be
// an orphan outside pending/, where nothing removes it.
describe('a file confirmed between the check and the delete', () => {
  it('destroys that file too', async () => {
    const owner = await signIn(server)
    const stale = await seed(owner.userId, {})
    const fileKey = `users/${owner.userId}/cases/${stale.id}/abc-evidence.pdf`
    storage.simulateUpload(fileKey, {
      size: 5120,
      contentType: 'application/pdf',
    })
    await prisma.case.update({ where: { id: stale.id }, data: { fileKey } })

    await deleteCaseRow(stale, storage)

    expect(await storage.headObject(fileKey)).toBeNull()
    expect(
      await prisma.case.findUniqueOrThrow({ where: { id: stale.id } }),
    ).toMatchObject({ deletedAt: expect.any(Date) as Date, fileKey: null })
  })
})
