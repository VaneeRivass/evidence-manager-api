import { parseCookie } from 'cookie'
import type { CookieOptions, Request, Response } from 'express'
import { jwtVerify, SignJWT } from 'jose'
import { env } from '../../shared/config/env.js'
import { type AppError, Unauthorized } from '../../shared/errors/app-error.js'
import { ErrorCode } from '../../shared/errors/error-codes.js'

// Everything the session is made of lives here: the cookie that carries it and
// the token inside. Login starts it, logout ends it, requireAuth reads it —
// none of them knows the cookie's attributes or lifetime. See docs/adr/0003.

// Who is signed in, as the client sees it: what login and register answer, and
// what a verified token says. One type, so /auth/me cannot drift from /login.
export type Session = { id: string; email: string }

export const SESSION_COOKIE = 'session'

// RNF-03 · httpOnly: the page's JavaScript cannot read the token.
// Secure: HTTPS only. SameSite=Lax: another site's form does not carry it.
// Shared by start and end: a browser only deletes a cookie when it is
// cleared with the same attributes it was set with.
const cookieOptions: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
}

// HS256: one secret both signs and verifies, and this API is the only party
// that does either. A key pair would only pay off if another service verified.
const sessionKey = new TextEncoder().encode(env.JWT_SECRET)

// RF-02a · only the id (as `sub`) and the email: anyone holding the token can
// read its payload, so nothing private goes in. The lifetime comes from the
// environment, the same value the cookie's Max-Age reads.
// The clock is read once: two reads can straddle a second and stretch the TTL.
export const signSessionToken = ({ id, email }: Session): Promise<string> => {
  const now = Math.floor(Date.now() / 1000)

  return new SignJWT({ email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(id)
    .setIssuedAt(now)
    .setExpirationTime(now + env.SESSION_TTL_SECONDS)
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
// accepted, so a token cannot choose another algorithm for itself. One error
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

// RF-02 · RF-02a · a signed token, in a cookie that lives exactly as long as
// the token inside it.
export async function startSession(
  res: Response,
  session: Session,
): Promise<void> {
  res.cookie(SESSION_COOKIE, await signSessionToken(session), {
    ...cookieOptions,
    maxAge: env.SESSION_TTL_SECONDS * 1000,
  })
}

// RF-04 · deletes the cookie from the browser. The token itself stays valid
// until it expires: see the known limitation "The token cannot be revoked".
export function endSession(res: Response): void {
  res.clearCookie(SESSION_COOKIE, cookieOptions)
}

// RF-03 · the token the browser sent back, if it sent one.
export function sessionTokenOf(req: Request): string | undefined {
  return parseCookie(req.headers.cookie ?? '')[SESSION_COOKIE]
}
