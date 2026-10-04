import * as z from 'zod'
import { FieldCode } from '../../shared/errors/error-codes.js'
import { tooLong, tooShort } from '../../shared/validation/field-issue.js'

const PASSWORD_MIN = 8
const PASSWORD_MAX = 64

// RF-01a · trimmed, capped at 254 characters and normalised to lowercase before
// it is stored or queried: Ana@x.com and ana@x.com must collide.
const email = z.string().trim().max(254).toLowerCase().pipe(z.email())

// The form a password is counted, hashed and compared on: composed, so the same
// password typed with an accent built from a base and a mark is one text.
const nfc = (value: string) => value.normalize('NFC')
const characters = (value: string) => [...nfc(value)].length

// RF-01b · a passphrase keeps its spaces, so it is not trimmed; one made only of
// whitespace is its own code. 8 to 64 characters, and the first check that fails
// stops the rest: one value is never too short and too long at once.
const password = z
  .string()
  .superRefine((value, ctx) => {
    if (value.trim() === '') {
      ctx.addIssue({
        code: 'custom',
        params: { code: FieldCode.PASSWORD_BLANK },
      })
      return
    }

    const size = characters(value)
    if (size < PASSWORD_MIN) return tooShort(ctx, value, PASSWORD_MIN)
    if (size > PASSWORD_MAX) tooLong(ctx, value, PASSWORD_MAX)
  })
  .transform(nfc)

export const registerSchema = z.object({ email, password })

export type RegisterInput = z.infer<typeof registerSchema>

// RF-02 · the same email normalisation as registration, or Ana@x.com would not
// find the account stored as ana@x.com. The password needs no minimum here — the
// policy is enforced when it is set — but it is capped at the same maximum, so an
// over-long text never reaches argon2.
export const loginSchema = z.object({
  email,
  password: z
    .string()
    .superRefine((value, ctx) => {
      const size = characters(value)
      if (size < 1) return tooShort(ctx, value, 1)
      if (size > PASSWORD_MAX) tooLong(ctx, value, PASSWORD_MAX)
    })
    .transform(nfc),
})

export type LoginInput = z.infer<typeof loginSchema>
