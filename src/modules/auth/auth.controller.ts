import type { CookieOptions, RequestHandler } from 'express'
import type { LoginInput, RegisterInput } from './auth.schema.js'
import {
  loginUser,
  registerUser,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  signSessionToken,
  toPublicUser,
} from './auth.service.js'

// The body type here is the validate(registerSchema) middleware's contract:
// it runs first and replaces req.body with the parsed RegisterInput.
// RF-01 · Express 5 forwards this rejection to the error handler on its own.
export const register: RequestHandler<never, unknown, RegisterInput> = async (
  req,
  res,
) => {
  const user = await registerUser(req.body)
  res.status(201).json(toPublicUser(user))
}

// RNF-03 · httpOnly: the page's JavaScript cannot read the token.
// Secure: HTTPS only. SameSite=Lax: another site's form does not carry it.
// Shared by login and logout: a browser only deletes a cookie when it is
// cleared with the same attributes it was set with. See docs/adr/0003.
const sessionCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
}

// RF-02 · the body is how the client learns who signed in, since it cannot
// read the cookie.
export const login: RequestHandler<never, unknown, LoginInput> = async (
  req,
  res,
) => {
  const user = await loginUser(req.body)

  res.cookie(SESSION_COOKIE, await signSessionToken(user), {
    ...sessionCookieOptions,
    maxAge: SESSION_TTL_SECONDS * 1000,
  })
  res.status(200).json(toPublicUser(user))
}

// RF-03 · requireAuth runs first and has already verified the token; this
// only answers with who it says is asking.
export const me: RequestHandler = (req, res) => {
  res.status(200).json(req.user)
}

// RF-04 · deletes the cookie from the browser. The token itself stays valid
// until it expires: see the known limitation "The token cannot be revoked".
export const logout: RequestHandler = (_req, res) => {
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions)
  res.status(204).end()
}
