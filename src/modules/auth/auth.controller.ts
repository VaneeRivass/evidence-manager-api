import type { RequestHandler } from 'express'
import type { RegisterInput } from './auth.schema.js'
import { registerUser, toPublicUser } from './auth.service.js'

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
