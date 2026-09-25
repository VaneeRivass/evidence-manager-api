# ADR-0003 · Session in an httpOnly cookie, resolved with a proxy

**Status:** accepted · **Date:** 2026-09-22 · **Revised:** 2026-09-25, why a JWT and not a server-side session

## Context

The brief asks for authentication with a JWT or a session, and notes that storing the token
in `localStorage` requires documenting the cross-site scripting risk. An `httpOnly` cookie
is not readable from the page's JavaScript, so such an attack cannot steal the session.

The obstacle is that the front end and the API live on different domains, being in separate
repositories and deployments. To the browser that makes the cookie third-party: it requires
`SameSite=None; Secure`, and **Safari blocks it by default**. The demo would work or not
depending on the reviewer's browser.

## Decision

The session is a JWT signed by the API; what it carries and how long it lasts is
`docs/requirements.md` RF-02a. It travels in a cookie named `session`,
`httpOnly; Secure; SameSite=Lax`, and the front end declares a rewrite in its configuration:

```js
// next.config.js
async rewrites() {
  return [{ source: '/api/:path*', destination: `${process.env.API_URL}/:path*` }]
}
```

The browser only ever talks to its own domain: `fetch('/api/cases')`. The hop to the API's
domain happens server to server.

The variable is `API_URL`, never `NEXT_PUBLIC_API_URL`: anything with that prefix is
inlined into the bundle the browser downloads, and the rewrite runs on the server.

## Alternatives considered

**A server-side session.** The cookie carries a random identifier and the server keeps a
row per session. It is the only option that allows real revocation: signing out deletes the
row, and a copied cookie stops working everywhere. Rejected because the API runs as a
serverless function: every protected request would query the database before doing
anything, and it adds a table and a migration. A JWT is verified with a signature check, no
query. The price is that it cannot be revoked before it expires, recorded as a known
limitation in `docs/requirements.md`.

**Token in `localStorage` with an `Authorization` header.** Works in every browser and is
simpler, but it is the option the brief itself marks as less preferable: a cross-site
scripting flaw reads the token and takes the session with it.

**A third-party cookie with `SameSite=None`.** That is what would be needed without a
proxy. Rejected because of Safari: the risk of the demo not working for whoever reviews it
is unacceptable.

**A custom domain with subdomains** (`app.` and `api.` of the same domain). It would solve
the problem at the root and without a proxy, but it requires buying a domain.

## Consequences

**In favour.** The front-end code never sees or handles the token: there is no function
that stores or reads it. On top of that **CORS disappears entirely**, because the
same-origin policy is a browser rule and here the browser knows only one origin.

**Against.** One extra network hop of roughly fifty to a hundred milliseconds on each API
call, and one more piece to explain in the documentation. The file upload does not go
through it: it goes straight from the browser to storage, and that is where CORS does have
to be configured on the bucket.
