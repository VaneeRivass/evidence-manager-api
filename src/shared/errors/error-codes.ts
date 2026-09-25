// The contract with the client, which composes the Spanish text from these
// codes. AppError only accepts a code listed here, so a typo does not compile.
// See docs/requirements.md RF-23.
export const ErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNREADABLE_BODY: 'UNREADABLE_BODY',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  ROUTE_NOT_FOUND: 'ROUTE_NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]

// The per-field codes inside a VALIDATION_ERROR's `errors` list.
export const FieldCode = {
  TOO_SHORT: 'TOO_SHORT',
  TOO_LONG: 'TOO_LONG',
  INVALID_FORMAT: 'INVALID_FORMAT',
  INVALID_TYPE: 'INVALID_TYPE',
} as const

export type FieldCode = (typeof FieldCode)[keyof typeof FieldCode]
