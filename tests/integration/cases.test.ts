import request from 'supertest'
import { afterAll, describe, expect, it } from 'vitest'
import { app } from '../../src/app.js'
import { prisma } from '../../src/shared/database/prisma.js'
import type { Prisma } from '../../src/generated/prisma/client.js'
import type { Session } from '../../src/modules/auth/session.js'
import type { PublicCase } from '../../src/modules/cases/cases.mapper.js'
import { createUser } from '../integration-setup.js'
import { listen, sessionCookieOf, withSession } from '../helpers.js'

// Exercises the real app: casesRouter, requireAuth, the validators and Prisma
// against PostgreSQL. It signs in through /auth because the session is what
// decides whose cases these are.
const server = await listen(app)
afterAll(() => server.close())

type Signed = { cookie: string; userId: string }

// A registered account with its session cookie, the way a browser would hold
// it, plus the id every case it owns is stored under.
async function signIn(): Promise<Signed> {
  const { email, password } = await createUser()
  const res = await request(server)
    .post('/auth/login')
    .send({ email, password })
  const token = sessionCookieOf(res)?.value

  if (!token) throw new Error('signing in returned no session cookie')

  return { cookie: withSession(token), userId: (res.body as Session).id }
}

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

const titlesOf = (body: unknown) =>
  (body as { items: PublicCase[] }).items.map(({ title }) => title)

describe('POST /cases', () => {
  // RF-05
  it('answers 201 with the case, open and with no file', async () => {
    const owner = await signIn()

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
    const owner = await signIn()

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
    const owner = await signIn()
    const intruder = await signIn()

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
    const owner = await signIn()

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
    const owner = await signIn()

    const res = await createCase(owner, {
      title: 'a'.repeat(121),
      description: 'Emails from the bank',
    })

    expect(res.status).toBe(400)
    expect(await prisma.case.count()).toBe(0)
  })

  // RF-05 · PostgreSQL cannot store a null character: stopped before it
  it('answers 400 for a null character in the title', async () => {
    const owner = await signIn()

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
    const owner = await signIn()
    await seed(owner.userId, { title: 'Phishing' })

    const res = await listCases(owner)

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ total: 1 })
    expect(titlesOf(res.body)).toEqual(['Phishing'])
  })

  // RF-06 · RNF-01 · only the authenticated user's cases
  it('leaves out another user’s cases', async () => {
    const owner = await signIn()
    const stranger = await signIn()
    await seed(owner.userId, { title: 'Mine' })
    await seed(stranger.userId, { title: 'Not mine' })

    const res = await listCases(owner)

    expect(res.body).toMatchObject({ total: 1 })
    expect(titlesOf(res.body)).toEqual(['Mine'])
  })

  // RF-09b · a deleted case does not exist for the API
  it('leaves out deleted cases, and does not count them', async () => {
    const owner = await signIn()
    await seed(owner.userId, { title: 'Live' })
    await seed(owner.userId, { title: 'Deleted', deletedAt: new Date() })

    const res = await listCases(owner)

    expect(res.body).toMatchObject({ total: 1 })
    expect(titlesOf(res.body)).toEqual(['Live'])
  })

  // RF-06 · the filter is accepted in any case
  it.each(['CLOSED', 'closed'])('filters by status=%s', async (status) => {
    const owner = await signIn()
    await seed(owner.userId, { title: 'Open one' })
    await seed(owner.userId, { title: 'Closed one', status: 'CLOSED' })

    const res = await listCases(owner, `?status=${status}`)

    expect(res.body).toMatchObject({ total: 1 })
    expect(titlesOf(res.body)).toEqual(['Closed one'])
  })

  // RF-06 · without the filter, both states
  it('returns both states when no status is given', async () => {
    const owner = await signIn()
    await seed(owner.userId, { title: 'Open one' })
    await seed(owner.userId, { title: 'Closed one', status: 'CLOSED' })

    const res = await listCases(owner)

    expect(res.body).toMatchObject({ total: 2 })
  })

  // RF-06 · most recently updated first, by default
  it('sorts by update time, newest first', async () => {
    const owner = await signIn()
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
    const owner = await signIn()
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
    const owner = await signIn()
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
    const owner = await signIn()

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
