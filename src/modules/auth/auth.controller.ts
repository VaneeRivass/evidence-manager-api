import type { Request, Response } from 'express'
import { sessionOf } from './require-auth.js'
import { endSession, startSession } from './session.js'
import type { LoginInput, RegisterInput } from './auth.schema.js'
import { loginUser, registerUser, toPublicUser } from './auth.service.js'

// RF-01 · Express 5 forwards this rejection to the error handler on its own.
export async function register(
  req: Request<never, unknown, RegisterInput>,
  res: Response,
): Promise<void> {
  const user = await registerUser(req.body)
  res.status(201).json(toPublicUser(user))
}

// RF-02 · the body is how the client learns who signed in, since it cannot
// read the cookie.
export async function login(
  req: Request<never, unknown, LoginInput>,
  res: Response,
): Promise<void> {
  const session = toPublicUser(await loginUser(req.body))

  await startSession(res, session)
  res.status(200).json(session)
}

// RF-03 · requireAuth runs first and has already verified the token; this
// only answers with who it says is asking.
export function me(req: Request, res: Response): void {
  res.status(200).json(sessionOf(req))
}

// RF-04 · see endSession for what signing out does and does not do.
export function logout(_req: Request, res: Response): void {
  endSession(res)
  res.status(204).end()
}
