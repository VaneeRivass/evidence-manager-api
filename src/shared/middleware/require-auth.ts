import { parseCookie } from 'cookie'
import type { RequestHandler } from 'express'
import {
  noSession,
  SESSION_COOKIE,
  verifySessionToken,
} from '../../modules/auth/auth.service.js'

// RF-03 · the first link of every protected route: a signature check, no
// query — so an unauthenticated request never reaches the database.
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const token = parseCookie(req.headers.cookie ?? '')[SESSION_COOKIE]
  if (!token) throw noSession()

  req.user = await verifySessionToken(token)
  next()
}
