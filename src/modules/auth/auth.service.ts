import * as argon2 from 'argon2'
import { Conflict } from '../../shared/errors/app-error.js'
import { ErrorCode } from '../../shared/errors/error-codes.js'
import { Prisma } from '../../generated/prisma/client.js'
import type { User } from '../../generated/prisma/client.js'
import { prisma } from '../../shared/prisma.js'
import type { RegisterInput } from './auth.schema.js'

// `email` is the User model's only unique column besides `id`, which is
// server-generated — so a P2002 out of this insert can only be that email.
// Not sniffed from `error.meta`: its shape differs between Prisma's classic
// engine and the @prisma/adapter-pg driver adapter this project uses (see
// docs/adr/0002), and the code alone is already enough to tell them apart.
const isUniqueEmailViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002'

// No address in the message: it goes to the log, and the requestId already
// identifies the request.
const emailTaken = () =>
  Conflict(ErrorCode.EMAIL_TAKEN, 'Email already registered')

// RF-01 · the lookup answers the usual duplicate without paying for a hash.
// It does not guarantee uniqueness: two registrations racing for the same
// address both pass it. The unique index does, atomically, on insert — and
// the loser of that race is caught below, so it gets a 409 too, never a 500.
export async function registerUser({
  email,
  password,
}: RegisterInput): Promise<User> {
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { id: true },
  })
  if (existing) throw emailTaken()

  const passwordHash = await argon2.hash(password)

  try {
    return await prisma.user.create({ data: { email, passwordHash } })
  } catch (error) {
    if (isUniqueEmailViolation(error)) throw emailTaken()
    throw error
  }
}

// RNF-01 / RF-01 · the explicit mapper: passwordHash never leaves this file.
export const toPublicUser = (user: User): { id: string; email: string } => ({
  id: user.id,
  email: user.email,
})
