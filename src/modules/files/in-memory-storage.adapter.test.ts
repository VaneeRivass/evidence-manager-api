import { describe, expect, it } from 'vitest'
import { createInMemoryStorage } from './in-memory-storage.adapter.js'

describe('createInMemoryStorage', () => {
  // RF-11 · nothing was ever uploaded to that key
  it('headObject returns null for a key nothing was uploaded to', async () => {
    const storage = createInMemoryStorage()
    await expect(storage.headObject('pending/u1/x.pdf')).resolves.toBeNull()
  })

  // RF-11 · HeadObject reports what actually landed, from the test's own upload helper
  it('headObject reports the size and type simulateUpload recorded', async () => {
    const storage = createInMemoryStorage()
    storage.simulateUpload('pending/u1/x.pdf', {
      size: 1024,
      contentType: 'application/pdf',
    })

    await expect(storage.headObject('pending/u1/x.pdf')).resolves.toEqual({
      size: 1024,
      contentType: 'application/pdf',
    })
  })

  // RF-11b · confirmation copies the object to its final key without touching the source
  it('copyObject makes the destination readable while the source stays', async () => {
    const storage = createInMemoryStorage()
    const photo = { size: 2048, contentType: 'image/png' }
    storage.simulateUpload('pending/u1/photo.png', photo)

    await storage.copyObject({
      from: 'pending/u1/photo.png',
      to: 'users/u1/photo.png',
    })

    await expect(storage.headObject('users/u1/photo.png')).resolves.toEqual(
      photo,
    )
    await expect(storage.headObject('pending/u1/photo.png')).resolves.toEqual(
      photo,
    )
  })

  // copyObject on a key nobody uploaded to has nothing to copy
  it('copyObject rejects when the source does not exist', async () => {
    const storage = createInMemoryStorage()
    await expect(
      storage.copyObject({
        from: 'pending/u1/ghost.pdf',
        to: 'users/u1/ghost.pdf',
      }),
    ).rejects.toThrow()
  })

  // RF-09 · after deleting, the object is gone
  it('deleteObject removes the object', async () => {
    const storage = createInMemoryStorage()
    storage.simulateUpload('pending/u1/x.pdf', {
      size: 1024,
      contentType: 'application/pdf',
    })

    await storage.deleteObject('pending/u1/x.pdf')

    await expect(storage.headObject('pending/u1/x.pdf')).resolves.toBeNull()
  })

  // ADR-0005 · destroying an object that no longer exists does not fail — that is what makes retrying safe
  it('deleteObject on a key that was never uploaded does not throw', async () => {
    const storage = createInMemoryStorage()
    await expect(
      storage.deleteObject('pending/u1/never-uploaded.pdf'),
    ).resolves.toBeUndefined()
  })

  // RF-10 · a link the caller uses to PUT the file directly against storage
  it('createUploadUrl returns a url naming the key', async () => {
    const storage = createInMemoryStorage()
    const { url } = await storage.createUploadUrl({
      key: 'pending/u1/x.pdf',
      contentType: 'application/pdf',
    })

    expect(url).toContain('pending/u1/x.pdf')
  })

  // RF-12 · a link the caller uses to GET the file directly from storage
  it('createDownloadUrl returns a url naming the key', async () => {
    const storage = createInMemoryStorage()
    const { url, expiresIn } = await storage.createDownloadUrl({
      key: 'users/u1/x.pdf',
    })

    expect(url).toContain('users/u1/x.pdf')
    expect(expiresIn).toBe(60)
  })
})
