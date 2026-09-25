import type { Session } from '../../modules/auth/auth.service.js'

// Every request may carry the session requireAuth verified. Applies to the
// whole project as soon as this file is compiled — no import needed.
declare global {
  namespace Express {
    interface Request {
      user?: Session
    }
  }
}

export {}
