import { parseSetCookie } from 'cookie'
import { once } from 'node:events'
import { createServer, type RequestListener, type Server } from 'node:http'
import { type JWTPayload, SignJWT } from 'jose'
import type { Response } from 'supertest'
import type { User } from '../src/generated/prisma/client.js'
import { env } from '../src/shared/config/env.js'
import {
  SESSION_COOKIE,
  signSessionToken,
} from '../src/modules/auth/session.js'

// No database here, so unit tests can use them. The ones that need it are in
// integration-setup.ts.

// The app on a free port of 127.0.0.1. Pass the result to request() and close
// it in afterAll. Given the bare app, Supertest listens on every interface and
// then calls 127.0.0.1: on macOS another program can hold that same port on
// 127.0.0.1 alone, and the request reaches it instead.
export async function listen(app: RequestListener): Promise<Server> {
  const server = createServer(app).listen(0, '127.0.0.1')
  await once(server, 'listening')
  return server
}

// A user as the database returns it, never inserted: for tests that only sign
// or verify a token and never query.
export const sampleUser: User = {
  id: 'c1a2b3c4-0000-4000-8000-000000000001',
  email: 'ana@example.com',
  passwordHash: 'argon2-hash',
  createdAt: new Date(),
  updatedAt: new Date(),
}

// The Cookie header a browser would send with this token.
export const withSession = (token: string): string =>
  `${SESSION_COOKIE}=${token}`

// The key the API signs with, rebuilt from the secret itself, so a test
// checks against the secret and not against the code under test.
export const sessionKey = new TextEncoder().encode(env.JWT_SECRET)

// A token for sampleUser with every part overridable, so a test names only
// the one thing it gets wrong. Valid for an hour by default.
export function signToken({
  alg = 'HS256',
  key = sessionKey,
  payload = { email: sampleUser.email },
  issuedAt = Math.floor(Date.now() / 1000),
  expiresAt = issuedAt + 60 * 60,
}: {
  alg?: string
  key?: Uint8Array
  payload?: JWTPayload
  issuedAt?: number
  expiresAt?: number
} = {}): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg })
    .setSubject(sampleUser.id)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(key)
}

// Correctly signed, issued nine hours ago and expired one hour ago.
export function expiredToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  return signToken({ issuedAt: now - 9 * 60 * 60, expiresAt: now - 60 * 60 })
}

// A real token whose payload was swapped after signing: the signature no
// longer matches what it claims.
export async function tamperedToken(): Promise<string> {
  const [header, , signature] = (await signSessionToken(sampleUser)).split('.')
  const forged = Buffer.from(
    JSON.stringify({ sub: 'someone-else', email: 'eve@example.com' }),
  ).toString('base64url')

  return `${header}.${forged}.${signature}`
}

// The session cookie a response sets, parsed into its value and attributes.
export function sessionCookieOf(
  res: Response,
): ReturnType<typeof parseSetCookie> | undefined {
  const headers = res.headers['set-cookie'] as string[] | undefined
  return headers
    ?.map((header) => parseSetCookie(header))
    .find(({ name }) => name === SESSION_COOKIE)
}

// Splits the id, which changes on every request, from the rest of an error
// response, so two responses can be compared field by field.
export function problemOf(res: Response): {
  requestId: unknown
  problem: Record<string, unknown>
} {
  const { requestId, ...problem } = res.body as Record<string, unknown>
  return { requestId, problem }
}
