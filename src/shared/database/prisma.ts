import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../generated/prisma/client.js'
import { env } from '../config/env.js'

// Pooled string: every runtime query goes through Neon's pooler. See docs/adr/0002.
// pg waits forever for a connection unless told otherwise: a database that
// never answers would hold the request until the platform killed it. 5 s was
// Prisma 6's own default, and leaves room for Neon to wake up. See the
// response contract in docs/requirements.md.
const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
  connectionTimeoutMillis: 5_000,
})

export const prisma = new PrismaClient({ adapter })
