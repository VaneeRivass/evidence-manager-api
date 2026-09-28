import type { User } from '../../generated/prisma/client.js'
import type { Session } from './session.js'

// RNF-01 / RF-01 · the explicit mapper: it names the fields that leave, so
// passwordHash — or a column added tomorrow — never does.
export const toPublicUser = (user: User): Session => ({
  id: user.id,
  email: user.email,
})
