import * as argon2 from 'argon2'
import { randomBytes } from 'node:crypto'
import { jwtVerify, SignJWT } from 'jose'
import { env } from '../../shared/config/env.js'
import {
  type AppError,
  Conflict,
  Unauthorized,
} from '../../shared/errors/app-error.js'
import { ErrorCode } from '../../shared/errors/error-codes.js'
import { Prisma } from '../../generated/prisma/client.js'
import type { User } from '../../generated/prisma/client.js'
import { prisma } from '../../shared/prisma.js'
import type { LoginInput, RegisterInput } from './auth.schema.js'

// `email` is the User model's only unique column besides `id`, which is
// server-generated — so a P2002 out of this insert can only be that email.
// Not sniffed from `error.meta`: its shape differs between Prisma's classic
// engine and the @prisma/adapter-pg driver adapter this project uses (see
// docs/adr/0002), and the code alone is already enough to tell them apart.
const isUniqueEmailViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002'

// No address in the message: it goes to the log, and the requestId already
// identifies the request.
const emailTaken = () =>
  Conflict(ErrorCode.EMAIL_TAKEN, 'Email already registered')

// RF-01 · the lookup answers the usual duplicate without paying for a hash.
// It does not guarantee uniqueness: two registrations racing for the same
// address both pass it. The unique index does, atomically, on insert — and
// the loser of that race is caught below, so it gets a 409 too, never a 500.
export async function registerUser({
  email,
  password,
}: RegisterInput): Promise<User> {
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  })
  if (existing) throw emailTaken()

  const passwordHash = await argon2.hash(password)

  try {
    return await prisma.user.create({ data: { email, passwordHash } })
  } catch (error) {
    if (isUniqueEmailViolation(error)) throw emailTaken()
    throw error
  }
}

// A hash of 32 random bytes nobody keeps, made when the module loads, so it
// is a real argon2 hash with the same parameters registration uses and
// verifying against it costs the same. On serverless that is once per cold
// start, whatever the first request is — so its cost gives no email away.
const placeholderHash = argon2.hash(randomBytes(32))

// RF-02 · an unknown email still pays for a verification, against the
// placeholder. Answering it straight away would be quicker than a wrong
// password, and that difference alone would give the email away. One error
// for both failures: telling them apart would reveal which emails exist.
export async function loginUser({
  email,
  password,
}: LoginInput): Promise<User> {
  const user = await prisma.user.findUnique({ where: { email } })
  const matches = await argon2.verify(
    user?.passwordHash ?? (await placeholderHash),
    password,
  )

  if (!user || !matches) {
    throw Unauthorized(ErrorCode.INVALID_CREDENTIALS, 'Invalid credentials')
  }

  return user
}

// Who is signed in, as the client sees it: what login and register answer, and
// what a verified token says. One type, so /auth/me cannot drift from /login.
export type Session = { id: string; email: string }

// RNF-01 / RF-01 · the explicit mapper: passwordHash never leaves this file.
export const toPublicUser = (user: User): Session => ({
  id: user.id,
  email: user.email,
})

// RF-02a · read from the environment, 8 hours by default. The cookie's Max-Age
// reads the same value, so the two cannot drift apart.
export const SESSION_TTL_SECONDS = env.SESSION_TTL_SECONDS

// Written by login and logout, read by requireAuth: one name for all three.
export const SESSION_COOKIE = 'session'

// HS256: one secret both signs and verifies, and this API is the only party
// that does either. A key pair would only pay off if another service verified.
const sessionKey = new TextEncoder().encode(env.JWT_SECRET)

// RF-02a · only the id (as `sub`) and the email: anyone holding the token can
// read its payload, so nothing private goes in. See docs/adr/0003.
// The clock is read once: two reads can straddle a second and stretch the TTL.
export const signSessionToken = (user: User): Promise<string> => {
  const now = Math.floor(Date.now() / 1000)

  return new SignJWT({ email: user.email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt(now)
    .setExpirationTime(now + SESSION_TTL_SECONDS)
    .sign(sessionKey)
}

// `reason` never reaches the client: error-handler.ts sends `code` and
// `params`, never `message`. It only makes the server log say why —
// expired, forged, wrong algorithm — instead of the same line every time.
export const noSession = (reason?: string): AppError =>
  Unauthorized(
    ErrorCode.UNAUTHENTICATED,
    reason ? `No valid session: ${reason}` : 'No valid session',
  )

// RF-03 · the signature, the expiry and the shape, in that order. Only HS256 is
// accepted, so a token cannot choose a weaker algorithm for itself. One error
// for every failure: the client only needs to know there is no valid session.
export async function verifySessionToken(token: string): Promise<Session> {
  const { payload } = await jwtVerify(token, sessionKey, {
    algorithms: ['HS256'],
  }).catch((error: unknown) => {
    const code =
      error instanceof Error && 'code' in error ? error.code : undefined
    throw noSession(typeof code === 'string' ? code : undefined)
  })

  if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') {
    throw noSession('missing sub or email in payload')
  }

  return { id: payload.sub, email: payload.email }
}
