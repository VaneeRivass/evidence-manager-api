import type { RequestHandler } from 'express'
import { endSession, startSession } from './session.js'
import type { LoginInput, RegisterInput } from './auth.schema.js'
import { loginUser, registerUser, toPublicUser } from './auth.service.js'

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

// RF-02 · the body is how the client learns who signed in, since it cannot
// read the cookie.
export const login: RequestHandler<never, unknown, LoginInput> = async (
  req,
  res,
) => {
  const session = toPublicUser(await loginUser(req.body))

  await startSession(res, session)
  res.status(200).json(session)
}

// RF-03 · requireAuth runs first and has already verified the token; this
// only answers with who it says is asking.
export const me: RequestHandler = (req, res) => {
  res.status(200).json(req.user)
}

// RF-04 · see endSession for what signing out does and does not do.
export const logout: RequestHandler = (_req, res) => {
  endSession(res)
  res.status(204).end()
}
