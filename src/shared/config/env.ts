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
  // Cloudflare R2, spoken over the S3 protocol. No default: each account has
  // its own. See docs/adr/0004.
  S3_ENDPOINT: z.url(),
  S3_BUCKET: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  // RF-10 · checked here on the declared size, and again for real with
  // HeadObject on confirmation (RF-11) — the same value, read once.
  MAX_FILE_SIZE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(5 * 1024 * 1024),
  // RF-10 · a comma-separated list in the environment, an array once parsed —
  // the allowlist itself, not a string every caller has to split. Lowercase,
  // because MIME types ignore case.
  ALLOWED_MIME_TYPES: z
    .string()
    .default('image/jpeg,image/png,application/pdf')
    .transform((value) =>
      value
        .split(',')
        .map((type) => type.trim().toLowerCase())
        .filter(Boolean),
    )
    .pipe(z.array(z.string()).min(1)),
})

type Env = z.infer<typeof schema>

// A function over any source, so the check can be tested without starting a
// process; the app only ever calls it once, below, on process.env.
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = schema.safeParse(source)

  if (!result.success) {
    throw new Error(
      `Invalid environment configuration:\n${z.prettifyError(result.error)}`,
    )
  }

  return result.data
}

export const env = parseEnv(process.env)
