// A failure the code expects and knows how to name. Services throw it without
// knowing anything about HTTP; error-handler.ts turns it into a response.
//
// The `code` travels to the client, which composes the Spanish text from it.
// The `message` is for whoever debugs: it goes to the log, never to the response.
// See docs/requirements.md RF-21 to RF-23.
type Params = Record<string, string | number>

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly params?: Params,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

const withStatus =
  (status: number) =>
  (code: string, message: string, params?: Params): AppError =>
    new AppError(status, code, message, params)

export const NotFound = withStatus(404)
export const Forbidden = withStatus(403)
export const Conflict = withStatus(409)
