import type { RequestHandler } from 'express'
import { noSession, sessionTokenOf, verifySessionToken } from './session.js'

// RF-03 · the first link of every protected route: a signature check, no
// query — so an unauthenticated request never reaches the database.
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const token = sessionTokenOf(req)
  if (!token) throw noSession()

  req.user = await verifySessionToken(token)
  next()
}
