import 'dotenv/config'
import * as z from 'zod'

// Validated on import, so a missing variable stops the process at boot rather
// than in the middle of a request. Each variable joins the schema in the issue
// that first reads it. See docs/requirements.md RNF-11.
const schema = z.object({
  DATABASE_URL: z.string().min(1),
  // Signs the session token. At least 32 characters: a short secret can be
  // brute-forced offline from a single token. See docs/adr/0003.
  JWT_SECRET: z.string().min(32),
  // RF-02a · one working day unless an environment says otherwise, so expiry
  // can be watched locally without waiting 8 hours.
  SESSION_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(8 * 60 * 60),
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
})

const result = schema.safeParse(process.env)

if (!result.success) {
  throw new Error(
    `Invalid environment configuration:\n${z.prettifyError(result.error)}`,
  )
}

export const env = result.data
