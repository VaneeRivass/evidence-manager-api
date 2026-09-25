import type { RequestHandler } from 'express'
import type { LoginInput, RegisterInput } from './auth.schema.js'
import {
  loginUser,
  registerUser,
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

// RF-02 · RNF-03 · httpOnly: the page's JavaScript cannot read the token.
// Secure: HTTPS only. SameSite=Lax: another site's form does not carry it.
// The body is how the client learns who signed in, since it cannot read the
// cookie. See docs/adr/0003.
export const login: RequestHandler<never, unknown, LoginInput> = async (
  req,
  res,
) => {
  const user = await loginUser(req.body)

  res.cookie('session', await signSessionToken(user), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS * 1000,
  })
  res.status(200).json(toPublicUser(user))
}
