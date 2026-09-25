import * as z from 'zod'

// RF-01a · trimmed, capped at 254 characters and normalised to lowercase
// before it is stored or queried — Ana@x.com and ana@x.com must collide.
const email = z.string().trim().max(254).toLowerCase().pipe(z.email())

// RF-01b · 8 to 72 bytes, not characters: argon2 has no upper bound of its
// own, but the bound is kept so the algorithm can change without silently
// truncating a password the way bcrypt does past byte 72.
const password = z.string().superRefine((value, ctx) => {
  const bytes = Buffer.byteLength(value, 'utf8')
  if (bytes < 8) {
    ctx.addIssue({
      code: 'too_small',
      origin: 'string',
      minimum: 8,
      inclusive: true,
      input: value,
    })
  } else if (bytes > 72) {
    ctx.addIssue({
      code: 'too_big',
      origin: 'string',
      maximum: 72,
      inclusive: true,
      input: value,
    })
  }
})

export const registerSchema = z.object({ email, password })

export type RegisterInput = z.infer<typeof registerSchema>

// RF-02 · the same email normalisation as registration, or Ana@x.com would not
// find the account stored as ana@x.com. The password is only required: the
// policy is enforced when it is set, and one stored under an older, looser
// policy must still sign in.
export const loginSchema = z.object({ email, password: z.string().min(1) })

export type LoginInput = z.infer<typeof loginSchema>
