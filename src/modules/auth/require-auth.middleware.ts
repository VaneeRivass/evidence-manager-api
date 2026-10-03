import type { Request, RequestHandler } from 'express'
import {
  endSession,
  noSession,
  type Session,
  sessionTokenOf,
  verifySessionToken,
} from './session.js'

// RF-03 · the first link of every protected route: a signature check, no
// query — so an unauthenticated request never reaches the database.
export const requireAuth: RequestHandler = async (req, res, next) => {
  const token = sessionTokenOf(req)
  if (!token) throw noSession()

  try {
    req.user = await verifySessionToken(token)
  } catch (error) {
    // RF-03 · the browser cannot delete an httpOnly cookie: the 401 takes it
    endSession(res)
    throw error
  }
  next()
}

// The session requireAuth left on the request. If it is missing, the route
// lacks requireAuth: our bug, so a 500 and not a 401.
export function sessionOf(req: Request): Session {
  if (!req.user) {
    throw new Error(`${req.method} ${req.path} is missing requireAuth`)
  }

  return req.user
}
