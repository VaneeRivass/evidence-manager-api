import type * as z from 'zod'

// A hand-written check reports through the same issue shapes as Zod's own
// .min()/.max(), so validate.middleware maps them in one place and never sees
// two shapes. `continue: false` stops the checks that follow, so one value
// reports one error: never "too short" and "too long" at once.
export const tooShort = (
  ctx: z.RefinementCtx,
  value: string,
  min: number,
): void =>
  ctx.addIssue({
    code: 'too_small',
    origin: 'string',
    minimum: min,
    inclusive: true,
    input: value,
    continue: false,
  })

export const tooLong = (
  ctx: z.RefinementCtx,
  value: string,
  max: number,
): void =>
  ctx.addIssue({
    code: 'too_big',
    origin: 'string',
    maximum: max,
    inclusive: true,
    input: value,
    continue: false,
  })
