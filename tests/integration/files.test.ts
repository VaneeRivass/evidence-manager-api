import request from 'supertest'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../../src/app.js'
import { prisma } from '../../src/shared/database/prisma.js'
import { createFilesService } from '../../src/modules/files/files.service.js'
import { createInMemoryStorage } from '../../src/shared/storage/in-memory-storage.adapter.js'
import { resolveUploadKey } from '../../src/modules/files/file-path.js'
import { type Signed, signIn } from '../integration-setup.js'
import { listen } from '../helpers.js'

// The real app with the in-memory double in place of R2 (ADR-0006): the
// browser's PUT is simulated with storage.simulateUpload.
const storage = createInMemoryStorage()
const server = await listen(createApp(storage))
afterAll(() => server.close())

const createCase = async ({ cookie }: Signed): Promise<string> => {
  const res = await request(server)
    .post('/cases')
    .set('Cookie', cookie)
    .send({ title: 'Phishing campaign', description: 'Card details.' })
  return (res.body as { id: string }).id
}

const requestUploadUrl = ({ cookie }: Signed, caseId: string, body: object) =>
  request(server)
    .post(`/cases/${caseId}/file/upload-url`)
    .set('Cookie', cookie)
    .send(body)

const confirmUpload = ({ cookie }: Signed, caseId: string, body: object) =>
  request(server)
    .post(`/cases/${caseId}/file/complete`)
    .set('Cookie', cookie)
    .send(body)

const PDF = { size: 2000, contentType: 'application/pdf' }

// A body upload-url accepts; each test changes only the field it is about.
const VALID_UPLOAD = { fileName: 'report.pdf', ...PDF }

// Asks for a link and plays the browser's PUT: the object lands at the signed
// key with what was really uploaded, by default what was declared.
async function uploadFile(
  user: Signed,
  caseId: string,
  uploaded = PDF,
): Promise<string> {
  const res = await requestUploadUrl(user, caseId, {
    fileName: 'Informe Final.pdf',
    ...PDF,
  })
  const { key } = res.body as { key: string }
  storage.simulateUpload(key, uploaded)
  return key
}

// pending/{user}/{case}/{uuid}-{name} → users/{user}/cases/{case}/{uuid}-{name}. Written
// here on purpose rather than imported: if the service's own resolveUploadKey is
// wrong, the tests catch it instead of repeating the mistake.
const expectedFinalKey = (pendingKey: string) =>
  pendingKey.replace(/^pending\/([^/]+)\/([^/]+)\//, 'users/$1/cases/$2/')

// Straight into the database: a case that already holds a file, as a
// confirmation would have left it.
const attachFile = (caseId: string, fileKey: string) =>
  prisma.case.update({
    where: { id: caseId },
    data: {
      fileKey,
      fileName: 'Informe Final.pdf',
      fileSize: 2000,
      fileType: 'application/pdf',
    },
  })

// What another confirmation of the same upload would have stored.
const storeOn = (caseId: string, key: string) =>
  attachFile(caseId, expectedFinalKey(key))

// A deletion that lands while a confirmation is under way.
const markDeleted = (caseId: string) =>
  prisma.case.update({ where: { id: caseId }, data: { deletedAt: new Date() } })

// A confirmable upload, and the case as requireOwnedCase read it before any change.
async function uploadedAndStale() {
  const user = await signIn(server)
  const caseId = await createCase(user)
  const key = await uploadFile(user, caseId)
  const stale = await prisma.case.findUniqueOrThrow({ where: { id: caseId } })
  // What checkUploadKey hands the service for this key.
  const upload = resolveUploadKey(key, user.userId, caseId)
  if (!upload)
    throw new Error(`upload-url signed a key it cannot resolve: ${key}`)
  return { caseId, key, stale, upload }
}

describe('POST /cases/:id/file/upload-url', () => {
  // RF-10 · RNF-02 · signed for the temporary area, under this user and case
  it('signs an upload under pending/ for this user and case', async () => {
    const user = await signIn(server)
    const caseId = await createCase(user)

    const res = await requestUploadUrl(user, caseId, VALID_UPLOAD)

    expect(res.status).toBe(200)
    const { uploadUrl, key, expiresIn } = res.body as {
      uploadUrl: string
      key: string
      expiresIn: number
    }
    expect(key).toMatch(
      new RegExp(
        `^pending/${user.userId}/${caseId}/[0-9a-f-]{36}-report\\.pdf$`,
      ),
    )
    expect(uploadUrl).toContain(key)
    expect(expiresIn).toBe(300)
  })

  // RF-10 · MIME types ignore case, so it is compared in lowercase; but the
  // PUT repeats the header the client already has, so it is signed as sent
  it('accepts a type in any case and signs it as sent', async () => {
    const user = await signIn(server)
    const caseId = await createCase(user)

    const res = await requestUploadUrl(user, caseId, {
      ...VALID_UPLOAD,
      contentType: 'Application/PDF',
    })

    expect(res.status).toBe(200)
    expect((res.body as { uploadUrl: string }).uploadUrl).toContain(
      'contentType=Application/PDF',
    )
  })

  // RF-10
  it('rejects a declared size over the limit, naming the limit', async () => {
    const user = await signIn(server)
    const caseId = await createCase(user)

    const res = await requestUploadUrl(user, caseId, {
      ...VALID_UPLOAD,
      size: 5 * 1024 * 1024 + 1,
    })

    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({
      code: 'FILE_TOO_LARGE',
      params: { max: 5 * 1024 * 1024 },
    })
  })

  // RF-10 · an empty file is no evidence
  it('rejects a declared size of zero bytes', async () => {
    const user = await signIn(server)
    const caseId = await createCase(user)

    const res = await requestUploadUrl(user, caseId, {
      ...VALID_UPLOAD,
      size: 0,
    })

    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      errors: [{ field: 'size', code: 'TOO_SHORT', params: { min: 1 } }],
    })
  })

  // RF-10 · a byte count has no fractions
  it('rejects a declared size that is not a whole number', async () => {
    const user = await signIn(server)
    const caseId = await createCase(user)

    const res = await requestUploadUrl(user, caseId, {
      ...VALID_UPLOAD,
      size: 1.5,
    })

    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      errors: [{ field: 'size', code: 'INVALID_TYPE' }],
    })
  })

  // RF-10 · bytes, not characters: 130 characters, 256 bytes
  it('rejects a file name over 255 bytes', async () => {
    const user = await signIn(server)
    const caseId = await createCase(user)

    const res = await requestUploadUrl(user, caseId, {
      ...VALID_UPLOAD,
      fileName: `${'é'.repeat(126)}.pdf`,
    })

    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      errors: [{ field: 'fileName', code: 'TOO_LONG', params: { max: 255 } }],
    })
  })

  // RF-10 · nothing would be left to name the file after the key's uuid
  it('rejects a file name that is empty once sanitised', async () => {
    const user = await signIn(server)
    const caseId = await createCase(user)

    const res = await requestUploadUrl(user, caseId, {
      ...VALID_UPLOAD,
      fileName: '/‮/',
    })

    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      errors: [{ field: 'fileName', code: 'TOO_SHORT', params: { min: 1 } }],
    })
  })

  // RF-10 · RNF-02 · the key stays pending/{user}/{case}/{uuid-name}: four
  // segments, whatever the name tried
  it('keeps a name carrying ../../ inside its folder', async () => {
    const user = await signIn(server)
    const caseId = await createCase(user)

    const res = await requestUploadUrl(user, caseId, {
      ...VALID_UPLOAD,
      fileName: '../../other-case/report.pdf',
    })

    expect(res.status).toBe(200)
    const { key } = res.body as { key: string }
    expect(key.startsWith(`pending/${user.userId}/${caseId}/`)).toBe(true)
    expect(key.split('/')).toHaveLength(4)
  })

  // RF-10 · RNF-01
  it("refuses to sign an upload for someone else's case", async () => {
    const owner = await signIn(server)
    const caseId = await createCase(owner)
    const intruder = await signIn(server)

    const res = await requestUploadUrl(intruder, caseId, VALID_UPLOAD)

    expect(res.status).toBe(403)
    expect(res.body).toMatchObject({ code: 'CASE_FORBIDDEN' })
  })

  // Middleware order · the type is checked before the case is queried, so a
  // bad request answers 400 even against someone else's case
  it('refuses a disallowed type before looking the case up', async () => {
    const owner = await signIn(server)
    const caseId = await createCase(owner)
    const intruder = await signIn(server)

    const res = await requestUploadUrl(intruder, caseId, {
      ...VALID_UPLOAD,
      contentType: 'application/x-msdownload',
    })

    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ code: 'FILE_TYPE_NOT_ALLOWED' })
  })

  // RF-10 · a MIME type is ASCII. Lowercasing a non-ASCII one can turn it into
  // an allowed type (the Kelvin sign K becomes k), which then fails to sign
  it('refuses a type with a non-ASCII character', async () => {
    const user = await signIn(server)
    const caseId = await createCase(user)

    const res = await requestUploadUrl(user, caseId, {
      ...VALID_UPLOAD,
      contentType: 'application/pd\u212Af',
    })

    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      errors: [{ field: 'contentType', code: 'INVALID_FORMAT' }],
    })
  })

  // RF-10 · a broken character (half of a pair) would make the storage
  // library throw while signing; sanitising drops it like a control character
  it('drops a lone surrogate from the name instead of failing', async () => {
    const user = await signIn(server)
    const caseId = await createCase(user)

    const res = await requestUploadUrl(user, caseId, {
      ...VALID_UPLOAD,
      fileName: 'a\ud800.pdf',
    })

    expect(res.status).toBe(200)
    expect((res.body as { key: string }).key).toMatch(/-a\.pdf$/)
  })

  // RF-10 · evidence is attached once and never replaced
  it('refuses a second upload to a case that already has a file', async () => {
    const user = await signIn(server)
    const caseId = await createCase(user)
    await attachFile(
      caseId,
      `users/${user.userId}/cases/${caseId}/abc-first.pdf`,
    )

    const res = await requestUploadUrl(user, caseId, {
      ...VALID_UPLOAD,
      fileName: 'second.pdf',
    })

    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({ code: 'FILE_ALREADY_ATTACHED' })
  })

  // RF-10
  it('rejects a type outside the allowlist, naming the allowed ones', async () => {
    const user = await signIn(server)
    const caseId = await createCase(user)

    const res = await requestUploadUrl(user, caseId, {
      fileName: 'setup.exe',
      contentType: 'application/x-msdownload',
      size: 2000,
    })

    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({
      code: 'FILE_TYPE_NOT_ALLOWED',
      params: { allowed: 'image/jpeg, image/png, application/pdf' },
    })
  })
})

describe('POST /cases/:id/file/complete', () => {
  // RF-11 · the reference stored is the real object: final key, real size
  // and type, and the name read from the key
  it('stores the file on the case once storage confirms it', async () => {
    const user = await signIn(server)
    const caseId = await createCase(user)
    const key = await uploadFile(user, caseId)

    const res = await confirmUpload(user, caseId, { key })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      id: caseId,
      fileKey: expectedFinalKey(key),
      fileName: 'Informe Final.pdf',
      fileSize: 2000,
      fileType: 'application/pdf',
    })
  })

  // RF-11b · out of pending/, so the 24-hour rule never reaches it
  it('moves the object out of pending/ to its final key', async () => {
    const user = await signIn(server)
    const caseId = await createCase(user)
    const key = await uploadFile(user, caseId)

    await confirmUpload(user, caseId, { key })

    expect(await storage.headObject(expectedFinalKey(key))).toEqual(PDF)
    expect(await storage.headObject(key)).toBeNull()
  })

  // RF-11 · the key must be shaped pending/{user}/{this case}/{uuid}-{name}.
  // The object exists in each case, so only the key's shape can refuse it.
  describe('refuses a key that is not this case’s', () => {
    it('an invented key', async () => {
      const user = await signIn(server)
      const caseId = await createCase(user)
      storage.simulateUpload('invented.pdf', PDF)

      const res = await confirmUpload(user, caseId, { key: 'invented.pdf' })

      expect(res.status).toBe(400)
      expect(res.body).toMatchObject({ code: 'FILE_KEY_MISMATCH' })
    })

    it('a key signed for another of my cases', async () => {
      const user = await signIn(server)
      const caseId = await createCase(user)
      const otherCaseId = await createCase(user)
      const key = await uploadFile(user, otherCaseId)

      const res = await confirmUpload(user, caseId, { key })

      expect(res.status).toBe(400)
      expect(res.body).toMatchObject({ code: 'FILE_KEY_MISMATCH' })
    })

    it('a key signed for someone else’s case', async () => {
      const user = await signIn(server)
      const caseId = await createCase(user)
      const other = await signIn(server)
      const key = await uploadFile(other, await createCase(other))

      const res = await confirmUpload(user, caseId, { key })

      expect(res.status).toBe(400)
      expect(res.body).toMatchObject({ code: 'FILE_KEY_MISMATCH' })
    })

    // Starts right, but a client that normalises the path would land in
    // someone else's folder
    it('a key that starts right and climbs out with ../', async () => {
      const user = await signIn(server)
      const caseId = await createCase(user)
      const other = await signIn(server)
      const otherKey = await uploadFile(other, await createCase(other))
      const key = `pending/${user.userId}/${caseId}/../../../${otherKey}`
      storage.simulateUpload(key, PDF)

      const res = await confirmUpload(user, caseId, { key })

      expect(res.status).toBe(400)
      expect(res.body).toMatchObject({ code: 'FILE_KEY_MISMATCH' })
    })
  })

  // Middleware order · the key is checked before the case is queried
  it('refuses a key not signed for the case before looking the case up', async () => {
    const owner = await signIn(server)
    const caseId = await createCase(owner)
    const intruder = await signIn(server)

    const res = await confirmUpload(intruder, caseId, { key: 'invented.pdf' })

    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ code: 'FILE_KEY_MISMATCH' })
  })

  // RF-11 · the client said it uploaded; storage says otherwise
  it('refuses a key nothing was uploaded to', async () => {
    const user = await signIn(server)
    const caseId = await createCase(user)
    const signed = await requestUploadUrl(user, caseId, VALID_UPLOAD)
    const { key } = signed.body as { key: string }

    const res = await confirmUpload(user, caseId, { key })

    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ code: 'FILE_NOT_UPLOADED' })
  })

  // RF-11 · the signature fixes the type but not the size, so the declared
  // 2 000 bytes can arrive as 6 MB; the type is checked too, as a second net
  it.each([
    {
      what: 'a real size over the limit',
      uploaded: { ...PDF, size: 6 * 1024 * 1024 },
    },
    { what: 'a real size of 0 bytes', uploaded: { ...PDF, size: 0 } },
    {
      what: 'a real type not allowed',
      uploaded: { ...PDF, contentType: 'application/x-msdownload' },
    },
  ])(
    'deletes the object from storage and refuses it for $what',
    async ({ uploaded }) => {
      const user = await signIn(server)
      const caseId = await createCase(user)
      const key = await uploadFile(user, caseId, uploaded)

      const res = await confirmUpload(user, caseId, { key })

      expect(res.status).toBe(400)
      expect(res.body).toMatchObject({ code: 'FILE_REJECTED' })
      expect(await storage.headObject(key)).toBeNull()
      expect(await storage.headObject(expectedFinalKey(key))).toBeNull()
    },
  )

  // RF-11 · the type storage reports is the one signed, as the client sent it
  it('accepts a real type in any case and stores it in lowercase', async () => {
    const user = await signIn(server)
    const caseId = await createCase(user)
    const signed = await requestUploadUrl(user, caseId, {
      ...VALID_UPLOAD,
      contentType: 'Application/PDF',
    })
    const { key } = signed.body as { key: string }
    storage.simulateUpload(key, { size: 2000, contentType: 'Application/PDF' })

    const res = await confirmUpload(user, caseId, { key })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ fileType: 'application/pdf' })
  })

  // RF-11 · a double click: the first confirmation already moved the object
  it('answers 200 again for the key the case already holds', async () => {
    const user = await signIn(server)
    const caseId = await createCase(user)
    const key = await uploadFile(user, caseId)
    await confirmUpload(user, caseId, { key })

    const res = await confirmUpload(user, caseId, { key })

    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ fileKey: expectedFinalKey(key) })
    expect(await storage.headObject(expectedFinalKey(key))).toEqual(PDF)
  })

  // RF-11 · two links asked before either was confirmed: the first wins, the
  // second is not left behind
  it('refuses a second file once one is stored, and deletes it from storage', async () => {
    const user = await signIn(server)
    const caseId = await createCase(user)
    const first = await uploadFile(user, caseId)
    const second = await uploadFile(user, caseId)
    await confirmUpload(user, caseId, { key: first })

    const res = await confirmUpload(user, caseId, { key: second })

    expect(res.status).toBe(409)
    expect(res.body).toMatchObject({ code: 'FILE_ALREADY_ATTACHED' })
    expect(await storage.headObject(second)).toBeNull()
    expect(await storage.headObject(expectedFinalKey(first))).toEqual(PDF)
  })

  // RF-11 · RNF-01 · a key shaped for the intruder and this case passes the
  // key check, so only the guard can refuse it
  it("refuses to confirm on someone else's case", async () => {
    const owner = await signIn(server)
    const caseId = await createCase(owner)
    const intruder = await signIn(server)
    const key = `pending/${intruder.userId}/${caseId}/${crypto.randomUUID()}-x.pdf`

    const res = await confirmUpload(intruder, caseId, { key })

    expect(res.status).toBe(403)
    expect(res.body).toMatchObject({ code: 'CASE_FORBIDDEN' })
  })

  // Middleware order · the owner's own key, sent by someone else: refused by
  // the key check, before the case is queried
  it("refuses someone else's key before looking the case up", async () => {
    const owner = await signIn(server)
    const caseId = await createCase(owner)
    const key = await uploadFile(owner, caseId)
    const intruder = await signIn(server)

    const res = await confirmUpload(intruder, caseId, { key })

    expect(res.status).toBe(400)
    expect(res.body).toMatchObject({ code: 'FILE_KEY_MISMATCH' })
  })
})

const requestDownloadUrl = ({ cookie }: Signed, caseId: string) =>
  request(server)
    .get(`/cases/${caseId}/file/download-url`)
    .set('Cookie', cookie)

describe('GET /cases/:id/file/download-url', () => {
  // RF-12 · a link to the stored key, saved under the file's name
  it('signs a 60-second link to the stored file', async () => {
    const user = await signIn(server)
    const caseId = await createCase(user)
    const key = await uploadFile(user, caseId)
    await confirmUpload(user, caseId, { key })

    const res = await requestDownloadUrl(user, caseId)

    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      downloadUrl: `memory://download/${expectedFinalKey(key)}?fileName=Informe Final.pdf`,
      expiresIn: 60,
    })
  })

  // RF-12
  it('answers 404 for a case with no file', async () => {
    const user = await signIn(server)
    const caseId = await createCase(user)

    const res = await requestDownloadUrl(user, caseId)

    expect(res.status).toBe(404)
    expect(res.body).toMatchObject({ code: 'FILE_NOT_FOUND' })
  })

  // RF-12 · RNF-01 · RNF-02
  it("refuses a link to someone else's file", async () => {
    const owner = await signIn(server)
    const caseId = await createCase(owner)
    const key = await uploadFile(owner, caseId)
    await confirmUpload(owner, caseId, { key })
    const intruder = await signIn(server)

    const res = await requestDownloadUrl(intruder, caseId)

    expect(res.status).toBe(403)
    expect(res.body).toMatchObject({ code: 'CASE_FORBIDDEN' })
  })
})

// RF-09b · the three file routes pass the same guard as /cases/:id, with a
// valid body so only the guard can refuse: a route mounted without one of
// its links fails here.
describe.each([
  {
    route: 'POST upload-url',
    send: (user: Signed, id: string) =>
      requestUploadUrl(user, id, VALID_UPLOAD),
  },
  {
    route: 'POST complete',
    send: (user: Signed, id: string) =>
      confirmUpload(user, id, {
        key: `pending/${user.userId}/${id}/${crypto.randomUUID()}-x.pdf`,
      }),
  },
  { route: 'GET download-url', send: requestDownloadUrl },
])('$route', ({ send }) => {
  // RNF-01
  it('answers 401 without a session', async () => {
    const owner = await signIn(server)
    const caseId = await createCase(owner)

    const res = await send({ cookie: '', userId: '' }, caseId)

    expect(res.status).toBe(401)
  })

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
    const caseId = await createCase(owner)
    await markDeleted(caseId)

    const res = await send(owner, caseId)

    expect(res.status).toBe(404)
    expect(res.body).toMatchObject({ code: 'CASE_NOT_FOUND' })
  })
})

// RF-11 · requireOwnedCase read the case, then storage is asked and the copy
// made: in between, another request can change the case. The service gets
// the case as the guard saw it, before that change.
describe('a case that changes between the check and the write', () => {
  const files = createFilesService(storage)

  it('answers 404 and deletes the copy from storage when the case was deleted', async () => {
    const { caseId, key, stale, upload } = await uploadedAndStale()
    await markDeleted(caseId)

    await expect(files.completeUpload(stale, upload)).rejects.toMatchObject({
      status: 404,
      code: 'CASE_NOT_FOUND',
    })
    expect(await storage.headObject(expectedFinalKey(key))).toBeNull()
  })

  it('answers 409 and deletes the copy from storage when another file was stored', async () => {
    const { caseId, key, stale, upload } = await uploadedAndStale()
    await attachFile(caseId, 'users/u/cases/c/other.pdf')

    await expect(files.completeUpload(stale, upload)).rejects.toMatchObject({
      status: 409,
      code: 'FILE_ALREADY_ATTACHED',
    })
    expect(await storage.headObject(expectedFinalKey(key))).toBeNull()
  })

  // Two confirmations of the same key in flight: the other one stored it
  it('keeps the file when the same key was stored meanwhile', async () => {
    const { caseId, key, stale, upload } = await uploadedAndStale()
    await storeOn(caseId, key)

    await expect(files.completeUpload(stale, upload)).resolves.toMatchObject({
      fileKey: expectedFinalKey(key),
    })
    expect(await storage.headObject(expectedFinalKey(key))).toEqual(PDF)
  })

  // A double click whose second request arrives after the first moved the
  // object: nothing left in pending/, and the case already holds the key
  it('answers 200 when the object was already moved by the first click', async () => {
    const { caseId, key, stale, upload } = await uploadedAndStale()
    await storeOn(caseId, key)
    await storage.deleteObject(key)

    await expect(files.completeUpload(stale, upload)).resolves.toMatchObject({
      fileKey: expectedFinalKey(key),
    })
  })

  // The same double click, with the object gone between HeadObject and the copy
  it('answers 200 when the object vanishes before the copy', async () => {
    const { caseId, key, stale, upload } = await uploadedAndStale()
    await storeOn(caseId, key)
    const copyFails = createFilesService({
      ...storage,
      copyObject: () => Promise.reject(new Error('NoSuchKey')),
    })

    await expect(
      copyFails.completeUpload(stale, upload),
    ).resolves.toMatchObject({
      fileKey: expectedFinalKey(key),
    })
  })

  // Two failures at once: the storage error is the real cause, and a database
  // hiccup while checking for a double click must not replace it
  it('reports the storage error when the double-click check also fails', async () => {
    const { stale, upload } = await uploadedAndStale()
    const copyFails = createFilesService({
      ...storage,
      copyObject: () => Promise.reject(new Error('R2 copy failed')),
    })
    const read = vi
      .spyOn(prisma.case, 'findFirst')
      .mockRejectedValueOnce(new Error('database unreachable'))

    await expect(copyFails.completeUpload(stale, upload)).rejects.toThrow(
      'R2 copy failed',
    )
    read.mockRestore()
  })

  // Storage failing to delete must not hide what happened to the case
  it('still answers 404 when deleting the copy fails', async () => {
    const { caseId, stale, upload } = await uploadedAndStale()
    await markDeleted(caseId)
    const deleteFails = createFilesService({
      ...storage,
      deleteObject: () => Promise.reject(new Error('R2 unavailable')),
    })

    await expect(
      deleteFails.completeUpload(stale, upload),
    ).rejects.toMatchObject({
      status: 404,
      code: 'CASE_NOT_FOUND',
    })
  })
})

// RF-11 · a write that fails for a reason other than a changed case. The
// database cannot be made to time out on demand, so the failure is injected
// into this one call; everything else runs against PostgreSQL.
describe('a write that fails after the copy', () => {
  const files = createFilesService(storage)
  afterEach(() => vi.restoreAllMocks())

  // The database may still commit the write after the case is read, so the
  // copy is kept: a spare file, never a case pointing at a deleted one
  it('keeps the copy when the case does not hold it yet', async () => {
    const { key, stale, upload } = await uploadedAndStale()
    vi.spyOn(prisma.case, 'update').mockRejectedValueOnce(
      new Error('connection lost'),
    )

    await expect(files.completeUpload(stale, upload)).rejects.toThrow(
      'connection lost',
    )
    expect(await storage.headObject(expectedFinalKey(key))).toEqual(PDF)
  })

  // The original is still in pending/, so a second confirmation copies it to
  // the same path and saves it: the spare copy becomes the case's file
  it('heals when the user confirms again', async () => {
    const { key, stale, upload } = await uploadedAndStale()
    vi.spyOn(prisma.case, 'update').mockRejectedValueOnce(
      new Error('connection lost'),
    )
    await files.completeUpload(stale, upload).catch(() => undefined)

    await expect(files.completeUpload(stale, upload)).resolves.toMatchObject({
      fileKey: expectedFinalKey(key),
    })
    expect(await storage.headObject(expectedFinalKey(key))).toEqual(PDF)
  })

  // The write landed and only the answer was lost: the copy is the case's file
  it('keeps the copy, and answers with the case, when the write landed', async () => {
    const { caseId, key, stale, upload } = await uploadedAndStale()
    vi.spyOn(prisma.case, 'update').mockImplementationOnce((async () => {
      await storeOn(caseId, key)
      throw new Error('connection lost after commit')
    }) as never)

    await expect(files.completeUpload(stale, upload)).resolves.toMatchObject({
      fileKey: expectedFinalKey(key),
    })
    expect(await storage.headObject(expectedFinalKey(key))).toEqual(PDF)
  })
})
