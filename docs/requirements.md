# Requirements — Evidence Manager API

Functional and non-functional requirements for the REST API. Each requirement has a stable
identifier used across issues, tests and code: searching for `RF-07` in the repository
returns the requirement, the issue that delivers it, the test that proves it and the code
that implements it.

Interface requirements (`RF-13`–`RF-20`) live in the web repository. Nothing is duplicated:
every requirement is defined in exactly one file.

---

## 1. Functional requirements

### 1.1 Authentication

| ID | Requirement |
|---|---|
| **RF-01** | Registration with email and password returns `201`. A duplicate email returns `409`. Invalid data returns `400` naming the offending field. **The password is stored only as a hash.** |
| **RF-01a** | The email is **trimmed** of surrounding spaces, validated up to **254 characters** and **normalised to lowercase** before being stored and before being queried. Without that, `Ana@x.com` and `ana@x.com` would create two accounts and the unique index would not prevent it; and a space left by pasting or autofill would reject a valid address as malformed. |
| **RF-01b** | The password is validated between **8 and 72 bytes**. The upper bound is not arbitrary: bcrypt reads only the first 72 bytes and discards the rest silently, so two different long passwords would open the same account. argon2 has no such limit, but the bound is kept so the algorithm can be changed without opening that hole. |
| **RF-02** | Login with valid credentials returns `200` with `{ id, email }` and an `httpOnly` session cookie — the body is the only way the client learns who signed in, since it cannot read the cookie. Invalid credentials return `401` **with the same message whether or not the email exists**, and **in the same time**: when the email does not exist the password is still checked against a placeholder hash, or the quicker answer would give the email away. The email is normalised before lookup. |
| **RF-02a** | The token expires **8 hours** after issuance — one working day, so it lapses overnight rather than mid-task. The lifetime can be overridden per environment, so expiry can be watched locally in a minute instead of a day; production keeps the default. It carries only the user identifier and the email: an identity card, not a copy of the record. |
| **RF-03** | Current user lookup returns `200` with `{ id, email }`, read from the verified session token — no query, since neither can change while the token is valid. Without a valid session, `401`. **On every protected route, a session cookie that fails verification — expired, forged — is cleared in that same `401`**: the cookie is `httpOnly`, so the browser cannot delete it itself, and kept, it would be sent and rejected on every request. |
| **RF-04** | Logout deletes the session cookie from the browser and returns `204`, **with or without a valid session**: it only clears a cookie, so it needs nobody signed in, and signing out twice is not an error. The token itself stays valid until it expires: a copy taken earlier still works — see the known limitation "The token cannot be revoked". |

### 1.2 Cases

| ID | Requirement |
|---|---|
| **RF-05** | Create a case with title and description, both required, returns `201`. Initial status `OPEN`, no file. Both are **trimmed** of surrounding spaces before being validated, so a title made only of spaces counts as empty: title 1 to 120 characters, description 1 to 2000 — the same limits as the database columns, so an overlong value is a `400` and never reaches the database as a `500`. For the same reason a null character (`\u0000`), which PostgreSQL cannot store, is a `400`. **The owner comes from the session**: any other field in the body — owner, status, file — is ignored, so nobody can create a case in someone else's name or pointing at someone else's file. |
| **RF-06** | List returns `200` with `{ items, total }`: `items` holds **only the authenticated user's cases**, excluding deleted ones, at most 100 per response; `total` counts every case matching the same filter, so the client can tell when some were left out. Optional filter `status` (`OPEN` or `CLOSED`; without it, both), **accepted in any case** — `closed` and `CLOSED` are the same filter, and the response always carries the uppercase form. Optional ordering `sort`: `updatedAt` (default) or `createdAt`, newest first — the direction is fixed, not a parameter. Ties are broken by id, so the same request always returns the same order. **Any other parameter is a `400` that names it**: otherwise a misspelled `?stauts=CLOSED` would return every case, as if the filter had been applied. |
| **RF-07** | Read one returns `200`. Non-existent returns `404`. Belonging to another user returns `403`. |
| **RF-07a** | A malformed identifier returns `400`, **before querying the database**. It differs from `404`: the request is malformed, not the resource missing. |
| **RF-08** | Update title, description or status returns `200`. Invalid returns `400`. Another user's returns `403`. **`CLOSED → OPEN` is allowed.** The fields follow the rules of creation: trimmed, the same limits, no null character, and the status accepted in any case. Any other field in the body is ignored, as in RF-05. |
| **RF-08a** | An empty body, or one with no recognised field, returns `400` with the field code `NOTHING_TO_CHANGE`. Without this rule the request would succeed without changing anything **yet alter the update timestamp**, pushing the case to the top of the list for no reason. |
| **RF-08b** | **A body whose values are the ones already stored does not touch the record**: it returns `200` with the case as it is, and the update timestamp stays where it was. It is not an error — the client asked for a state the case already holds — but writing it would reorder the list for nothing. This is what happens when a form is opened and saved without typing. |
| **RF-09** | Delete returns `204`. The object is deleted from storage **first**, then the record is marked as deleted and its file reference cleared. If deleting the object fails, **the database is not touched** and an error is returned: retrying is safe, because deleting an object that no longer exists does not fail. A case with no file never asks storage. A file confirmed **between the check and the write** is deleted too: the write only lands while the case still holds the file reference that was read; otherwise the case is read again and deleted with what it holds now. |
| **RF-09b** | **A deleted case does not exist for the API.** Reading, updating or deleting it again returns `404`, even knowing its identifier, and it never appears in the list. Also when it is deleted **between the check and the write**, by another request in flight: a double-clicked delete answers `404`, never a `500`. The guarantee lives in the middleware that loads the case, which every `/cases/:id` route passes through — not route by route. |

Every endpoint that returns a case returns it in this shape: the case's fields as the
brief names them, plus the file's name, size and type. Only the deletion mark stays inside —
a deleted case does not exist for the API, so it would always be `null`. The file fields
are `null` until an upload is confirmed. Size is in bytes and type is the MIME type: the
client decides how to display them. Neither `userId` nor `fileKey` grants anything on its
own: every case route checks ownership, and the file is only reachable through a signed
link.

```json
{
  "id": "3f9c2a1e-8b4d-4c7a-9e21-5d6f7a8b9c0d",
  "title": "Phishing campaign impersonating the bank",
  "description": "Emails received on 24 Sep asking to confirm card details.",
  "status": "OPEN",
  "fileKey": "users/8d2e…/cases/3f9c…/5b7a…-phishing-email-headers.pdf",
  "fileName": "phishing-email-headers.pdf",
  "fileSize": 5120,
  "fileType": "application/pdf",
  "userId": "8d2e4b1a-6c3f-4e9d-a7b2-1f0e9d8c7b6a",
  "createdAt": "2026-09-24T09:15:00.000Z",
  "updatedAt": "2026-09-26T11:02:33.000Z"
}
```

### 1.3 Evidence

| ID | Requirement |
|---|---|
| **RF-10** | Request an upload link with file name, type and size, returning `{ uploadUrl, key, expiresIn }`. The type is compared with the allowlist in lowercase — MIME types ignore case — but **signed exactly as sent**, so the client's `PUT` repeats the header it already has; a signature over a value the client never saw would fail with `403` in storage. A type outside the allowlist returns `400` with `FILE_TYPE_NOT_ALLOWED` and `{ allowed }`, the allowlist as one comma-separated string. The declared size is in bytes, a whole number from 1 — an empty file is no evidence — and anything else is a field error on `size`. A declared size above the limit returns `400` with `FILE_TOO_LARGE` and `{ max }` in bytes. Both are rules of the environment, not of the request's shape, so they are top-level codes rather than field errors — the client cannot know the limits in advance and reads them from `params`. A file name longer than **255 bytes** returns `400` — the name limit of common file systems, so any real file fits, while the storage key stays far below its 1024-byte maximum. Another user's case returns `403`. **The allowlist and the size limit are configurable per environment**, not constants in code. The signed key points at a **temporary area** (`pending/`), not at its final location. **A case that already carries a file returns `409` with `FILE_ALREADY_ATTACHED`**: evidence is attached once and never replaced — see *Evidence is never replaced* under Known limitations. |
| **RF-11** | Confirming the upload persists the file reference **only after verifying against storage**, and without storing anything when the link was signed: the key itself says which user and case it was signed for, since only the API can sign a write to `pending/`. **The key must have exactly the shape `pending/{userId}/{caseId}/{uuid}-{name}`** — the session's user, the case in the URL, one segment after it, and a name exactly as `upload-url` leaves it: sanitised and within 255 bytes — or `400` with `FILE_KEY_MISMATCH`. The shape is checked, not a prefix: `pending/{userId}/{caseId}/../../other/…` starts right but could reach another folder once a client normalises the path. One code covers an invented key, one from another of the user's cases and one from someone else's: the API compares text and cannot tell them apart without querying, so it claims nothing about who owns the key. The `403` stays with the case in the URL. If the object is missing, `400` with `FILE_NOT_UPLOADED`. If its **real size is 0 or over the limit, or its real type is not in the allowlist** (compared in lowercase, and stored in lowercase), **the object is deleted** and `400` is returned with `FILE_REJECTED`. The reference stored is the final key, the real size and type, and the file name read from the key — what follows `{uuid}-`, already sanitised and within 255 bytes since the link was requested. The real type is not compared with the signed one, which the API does not keep: storage already refused any `PUT` with another type. Confirming the key the case already holds — a double click — returns `200` with the case as it is and deletes nothing; it is checked before asking storage, since the first confirmation already moved the object out of `pending/`. If, before the reference is written, the case was deleted or another confirmation stored a different file, the copy is deleted and `404` or `409` with `FILE_ALREADY_ATTACHED` is returned: the write only lands on a case still undeleted and without a file; the two objects are deleted independently and a failure there is logged, never turning the `404` or `409` into a `500`. A double click whose second request finds the object already moved by the first — missing, or gone before the copy — returns `200` too: the case is read again before answering. If the write fails for any other reason (a lost connection, a timeout), the case is read again: if it holds the new key, the case is returned. Otherwise **the copy is kept and its path logged**, never deleted: the database may still commit the write after the case was read, and a spare file costs little while a case pointing at a deleted file loses its evidence. Confirming again heals it: the original is still in `pending/`, so the copy is made again to the same path and saved. |
| **RF-11b** | Once verified, the object is moved from the temporary area to its final location. **An upload that is never confirmed stays in the temporary area and storage deletes it after 24 hours**, through a bucket lifecycle rule — no scheduled process, which a serverless deployment could not host anyway. |
| **RF-12** | Request a download link, returning `{ downloadUrl, expiresIn }`, a signed URL valid for 60 seconds. A case with no file returns `404` with `FILE_NOT_FOUND`. The link is signed to be **saved, never opened**, under the file's name rather than its key: `Content-Disposition: attachment; filename="…"; filename*=UTF-8''…` (RFC 6266) — the plain form for old clients, ASCII only and without `"`, `\` or `%` (some decode it), and the encoded one so `Evidencia año 2026.pdf` keeps its `ñ`. Being signed, neither can be changed by whoever holds the link. |

### 1.4 Response contract

| ID | Requirement |
|---|---|
| **RF-21** | Every error follows **RFC 9457** (*Problem Details for HTTP APIs*) with `Content-Type: application/problem+json`, always the same shape, without exception. |
| **RF-22** | Every error response carries the **request identifier**, which also appears on every log line of that request. Whoever reports a failure can quote it and their exact request is recovered. |
| **RF-23** | Every error carries a **stable machine-readable code** and, when the message depends on a value, the **parameters** needed to compose it. The text a person reads is decided by the client, not by the API. |

```json
400 {
  "title":  "Bad Request",
  "status": 400,
  "code":   "VALIDATION_ERROR",
  "errors": [
    { "field": "title", "code": "TOO_SHORT", "params": { "min": 3 } },
    { "field": "email", "code": "INVALID_FORMAT" }
  ],
  "requestId": "9bed7892-..."
}
```

When the problem is the body as a whole rather than one of its fields — an array instead
of an object, or an edit with nothing to change — `field` is `(root)`.

An error that is not tied to a field carries its `params` at the top level:

```json
400 {
  "title":  "Bad Request",
  "status": 400,
  "code":   "FILE_TOO_LARGE",
  "params": { "max": 5242880 },
  "requestId": "3f9c2a1e-..."
}
```

The `params` are what make it work: without them a number cannot be interpolated into
another language without splitting the string. With them, adding a second language is one
more file.

How the fields are filled:

| Field | Value |
|---|---|
| `code` | The stable name the client switches on. The only field it needs. The full list lives in `src/shared/errors/error-codes.ts`: an error cannot be thrown with a code missing from it |
| `type` | Omitted. RFC 9457 then reads it as `about:blank`: the problem is what the status says, and `code` narrows it |
| `title` | The standard reason phrase of the status, as RFC 9457 asks when `type` is `about:blank`: `Not Found`, `Conflict`. Not shown to anyone |
| `requestId` | A UUID generated by the server for every request. One sent by the client is ignored, so nobody can plant ids in the logs |
| — | An unexpected failure answers `500` with `INTERNAL_ERROR`. Its message and stack go to the log only |
| — | A database that does not accept a connection within **5 seconds** is an unexpected failure: `500` with `INTERNAL_ERROR`, and the log names the timeout. Without a limit the request waits until the platform kills it, and the client gets the platform's error instead of this one |
| — | A body that cannot be read is rejected when the route validates it, before any query: `400` with `UNREADABLE_BODY` (malformed JSON, a bare value such as `"text"`, `42` or `null` instead of an object, a `Content-Type` other than JSON, a missing body, an unsupported charset) or `413` with `PAYLOAD_TOO_LARGE` and `{ max }` in bytes (over 100 KB). The body is only read there, so a route that does not exist answers `404` and an unauthenticated request answers `401` without the body ever being read. It applies to every endpoint that takes a body, so the endpoint map does not repeat it |

Every error also carries an English message written for developers. It goes to the log,
**never to the response**.

Each request leaves one log line, and it must be enough to diagnose a failure **without
reproducing it**: in production there is no going back for a missing detail. It carries
the request id, method, URL, user agent, status and response time; for a `4xx`, the error
code and message; for a `500`, the whole error with its stack. Headers and bodies are not
logged: they add nothing to a diagnosis and are where passwords and tokens travel.
`LOG_LEVEL` filters lines, never detail.

**Successful responses are not wrapped**: they return the resource, or `{ items, total }`
for lists. What needs a uniform shape is the error, because it is the only thing the client
handles in a single place.

---

## 2. Non-functional requirements

The requirements above say **what** the system does. These say **how it must behave**: not
features, but qualities. Each one justifies at least one technical decision; no technical
decision in this project exists without a requirement demanding it.

| ID | What must be true | How it is verified |
|---|---|---|
| **RNF-01** | **Nobody reaches anybody else's data.** Checked on the server on every single operation, never by hiding buttons in the interface | Test: user B against A's case → `403` |
| **RNF-02** | **A file cannot be reached without current permission.** There is no URL that works forever: every read is a link that expires | Private bucket · keys carrying a UUID · 60-second links |
| **RNF-03** | **A stolen page cannot steal the session.** The token is not readable by the JavaScript running on the page, so a script injected into it cannot take it | `httpOnly` cookie |
| **RNF-04** | **The server never trusts what the browser checked.** Anyone can skip the interface with `curl`, so every input is validated again on arrival. Client-side checks exist to give fast feedback, not to protect anything | Test: a request sent straight to the API, bypassing the interface |
| **RNF-05** | **Deleting does not erase the trail.** The record is marked as removed instead of being destroyed, so it is still possible to tell what existed and when it was withdrawn | Soft delete |
| **RNF-06** | **No endpoint can be asked for an unbounded amount of data.** A listing with no ceiling exhausts the server's memory long before anyone notices | Hard cap in the query |
| **RNF-07** | **A failure is understandable to us and opaque to the caller.** Errors are logged with enough context to find them; the client receives a code and a message, never a stack trace revealing how the system is built | Centralised error handler |
| **RNF-08** | **A rule is written once.** The same schema validates at runtime, produces the TypeScript type and generates the API documentation — so the three cannot drift apart and start disagreeing | Shared schemas |
| **RNF-09** | **Nothing is welded to one provider.** Storage is reached through an interface, and the application starts the same whether it runs as a serverless function or as a long-lived container | Storage port · application separated from its bootstrap |
| **RNF-10** | **Someone else can run this.** A person who has never seen the project brings the whole environment up with two commands. **Every start is a fresh environment**: the database is recreated and migrated from scratch, so nobody works against leftovers from a previous session | `npm run db:up` + `npm run dev` |
| **RNF-11** | **Required configuration is validated before the process accepts traffic.** If a required environment variable is missing, the process does not start, and the message names which one — instead of failing confusingly minutes or hours later, in the middle of a real operation. **One exception, for RNF-10:** `.env.example` carries placeholder R2 credentials, so a first run boots without a Cloudflare account; only the file routes fail until real ones are set | Zod schema over `process.env`, run on import |

---

## 3. Endpoint map

Each row reads as the script for its tests: **the error column is the list of cases to
cover.**

| Method | Path | Session | Ownership | Input | Success | Errors | Requirement |
|---|---|---|---|---|---|---|---|
| `POST` | `/auth/register` | — | — | email, password | `201` | `400` `409` | RF-01 |
| `POST` | `/auth/login` | — | — | email, password | `200` `{ id, email }` + cookie | `400` `401` | RF-02 |
| `GET` | `/auth/me` | ✓ | — | — | `200` `{ id, email }` | `401` | RF-03 |
| `POST` | `/auth/logout` | — | — | — | `204` + cookie cleared | — | RF-04 |
| `POST` | `/cases` | ✓ | — | title, description | `201` | `400` `401` | RF-05 |
| `GET` | `/cases` | ✓ | — | status, sort | `200` `{ items, total }` | `400` `401` | RF-06 |
| `GET` | `/cases/:id` | ✓ | ✓ | — | `200` | `400` `401` `403` `404` | RF-07 |
| `PATCH` | `/cases/:id` | ✓ | ✓ | title, description, status | `200` | `400` `401` `403` `404` | RF-08 |
| `DELETE` | `/cases/:id` | ✓ | ✓ | — | `204` | `400` `401` `403` `404` `500` | RF-09 |
| `POST` | `/cases/:id/file/upload-url` | ✓ | ✓ | fileName, contentType, size | `200` | `400` `401` `403` `404` `409` | RF-10 |
| `POST` | `/cases/:id/file/complete` | ✓ | ✓ | key | `200` | `400` `401` `403` `404` `409` | RF-11 |
| `GET` | `/cases/:id/file/download-url` | ✓ | ✓ | — | `200` | `400` `401` `403` `404` | RF-12 |
| `GET` | `/health` | — | — | — | `200` | — | — |
| `GET` | `/openapi.json` | — | — | — | `200` | — | — |

**Ownership ✓** means the route passes through the middleware that loads the case and
checks it belongs to whoever is asking.

### Middleware order, and why

```ts
router.patch('/:id',
  requireAuth,                 // 1. cryptography. No database
  validateParams(idSchema),    // 2. is :id a UUID?     → 400
  validateBody(updateCaseSchema), // 3. read the body, is it valid? → 400 / 413
  requireOwnedCase,               // 4. NOW the query      → 404 / 403
  update,                         // 5. the work
)
```

**Cheap before expensive.** A request carrying a malformed identifier and an invalid body
is rejected **without touching the database**. Validating after querying wastes a round
trip on every malformed request.

The file routes add one step before the query, for rules a schema cannot hold because they
depend on the environment or on the session:

| Route | Step | Rejects without querying |
|---|---|---|
| `POST /cases/:id/file/upload-url` | `checkDeclaredFile` | A type outside the allowlist, a declared size over the limit (RF-10) |
| `POST /cases/:id/file/complete` | `checkUploadKey` | A key not signed for the session's user and the case in the URL (RF-11) |

So a malformed request answers `400` even against someone else's case, as an invalid body
already does: the `403` needs the query, and the query comes last.

---

## 4. Flows

### Authentication

```mermaid
sequenceDiagram
    participant B as Browser
    participant A as API
    participant D as Postgres

    Note over B,D: Registration
    B->>A: POST /auth/register { email, password }
    A->>A: validate · normalise email to lowercase
    A->>D: does that email exist?
    alt already taken
        A-->>B: 409
    else available
        A->>A: argon2.hash(password)
        A->>D: INSERT user
        A-->>B: 201 { id, email }
    end

    Note over B,D: Login
    B->>A: POST /auth/login { email, password }
    A->>D: SELECT by normalised email
    A->>A: argon2.verify
    alt wrong credentials
        A-->>B: 401 · same message whether or not the email exists
    else correct
        A->>A: sign JWT { sub, email } · 8 h
        A-->>B: 200 + Set-Cookie session=…; HttpOnly; Secure; SameSite=Lax
    end

    Note over B,D: Any protected request
    B->>A: GET /cases  (the browser attaches the cookie by itself)
    A->>A: requireAuth · jwtVerify
    alt invalid signature or expired
        A-->>B: 401 + Set-Cookie session=; Expires=1970 (cleared)
    else valid
        A->>D: query scoped to req.user.id
        A-->>B: 200
    end
```

The client never takes part in managing the token: it does not store it, read it, attach it
or check whether it expired. The browser does all of that. That is what `httpOnly` is for.

### Case lifecycle

```mermaid
stateDiagram-v2
    [*] --> OPEN: POST /cases
    OPEN --> CLOSED: PATCH status=CLOSED
    CLOSED --> OPEN: PATCH status=OPEN
    OPEN --> Deleted: DELETE
    CLOSED --> Deleted: DELETE
    Deleted --> [*]

    note right of CLOSED
        A closed case is still
        editable and can be
        reopened (RF-08)
    end note

    note right of Deleted
        deletedAt is set.
        The object IS deleted.
        Every operation → 404 (RF-09b)
    end note
```

There is no transition machine restricting anything: with two states there would be nothing
to forbid, and blocking `CLOSED → OPEN` would be wrong, because a resolved problem can
reappear.

### Evidence

```mermaid
sequenceDiagram
    participant B as Browser
    participant A as API
    participant D as Postgres
    participant S as Storage (R2)

    Note over B,S: 1 · Ask permission to upload
    B->>A: POST /cases/:id/file/upload-url<br/>{ fileName, contentType, size }
    A->>A: valid session? case owned?<br/>type allowed? size within limit?<br/>case without a file yet? (else 409)
    A->>A: build key with a uuid, under pending/
    A->>S: sign PUT (valid 300 s)
    A-->>B: { uploadUrl, key, expiresIn }

    Note over B,S: 2 · Upload the binary — does NOT pass through the API
    B->>S: PUT uploadUrl<br/>Content-Type identical to the signed one
    S-->>B: 200 OK

    Note over B,S: 3 · Confirm, with real verification
    B->>A: POST /cases/:id/file/complete { key }
    A->>A: key shaped pending/{user}/{THIS case}/{uuid}-{name}?<br/>(else 400 FILE_KEY_MISMATCH)
    A->>A: does the case already hold this key? (a double click)<br/>→ 200 { case }, nothing deleted, storage not asked
    A->>S: HeadObject(key)
    alt object missing
        S-->>A: 404
        A-->>B: 400 FILE_NOT_UPLOADED
    else real size over the limit, or real type not allowed
        S-->>A: ContentLength / ContentType
        A->>S: DeleteObject(key)
        A-->>B: 400 FILE_REJECTED
    else deleted, or another file stored, before the write
        A->>S: DeleteObject(copy)
        A-->>B: 404 / 409 FILE_ALREADY_ATTACHED
    else everything checks out
        S-->>A: ContentLength / ContentType
        A->>S: CopyObject pending/ → users/
        A->>D: UPDATE case SET fileKey, fileName, fileSize, fileType<br/>WHERE not deleted AND no file yet
        A->>S: DeleteObject(pending key)<br/>(if it fails, the 24 h rule removes it)
        A-->>B: 200 { case }
    end

    Note over B,S: Later · Download
    B->>A: GET /cases/:id/file/download-url
    A->>S: sign GET (valid 60 s)
    A-->>B: { downloadUrl, expiresIn: 60 }
    B->>S: GET downloadUrl
    S-->>B: the file
```

**Why three steps and not one.** The binary never crosses the server: it consumes no
memory, no execution time, and hits no request size limit. The API only moves metadata.

**Why confirmation comes after, and the key is not stored when signing.** Signing does not
guarantee the upload happens: the tab may close, the network may drop. Storing the
reference at signing time would leave the case pointing at an object that does not exist.

**Why a presigned `PUT` cannot enforce the size.** The signature covers the address, the
method and the content type — **not the byte count**. A client can declare two megabytes,
pass validation, and then upload five hundred with the same URL. Storage accepts it because
the signature is valid. `HeadObject` in step three is what turns a declared limit into a
real one.

---

## 5. Known limitations

**This is what the system does NOT do.** Each entry describes a real gap, why it is
accepted, and how it would be resolved. **Nothing under "how it would be resolved" is part
of this project.**

### One piece of evidence per case

In practice a case usually carries several proofs. The specification fixes a single file
reference and singular endpoints.

**How it would be resolved.** Move the file columns into a table of their own, one row per
file, all pointing at the same case — a one-to-many relation. Endpoints would identify
which one. The real cost sits in the interface: a file list, with delete and download per
row.

### Evidence is never replaced

Once a case carries a file, asking for another upload answers `409`. Replacing it would
delete the previous proof and leave no sign that it existed — the opposite of what an
evidence record is for. Uploading is a `POST`, which adds; changing a case is `PATCH`, and
it does not reach the file. A wrong attachment is corrected by deleting the case, which
leaves its trail, and creating a new one.

**How it would be resolved.** Keep every version: the one-to-many table above, where a new
upload adds a row instead of overwriting one, so the history of the evidence survives.

### Two states

`OPEN` and `CLOSED` describe two situations, but a real workflow usually has intermediate
phases between "detected" and "resolved", and endings that are not equivalent: resolved,
consciously accepted, or not a problem after all. All three end up as `CLOSED` today and
become indistinguishable, although any count treats them separately.

**How it would be resolved.** Widen the status enum and add a transition machine. With two
states that machine has nothing to forbid; it only makes sense from three onwards.

### A `403` confirms that a case exists

Answering `403` for another user's case, as the brief asks, says something a `404` would
not: that the identifier belongs to a real case. Nothing else leaks — not its title, its
state, or its owner.

It does not add up to a way in. Identifiers are v4 uuids, 122 random bits, so they cannot
be walked: the only way to hold one is for someone to pass it on, and by then the `403`
confirms what they already knew. **How it would be resolved.** Answer `404` for anything
that is not yours, which is what GitHub does with a private repository — at the cost of a
client that can no longer tell a wrong identifier from a borrowed one.

### No change log

There is no record of when the status changed or how many times. Reopening a case is
possible but invisible afterwards.

**How it would be resolved.** A table of events written **in the same transaction** as each
change. It would also enable freezing a closed case, which without it does not pay off: you
would guarantee nothing changed after closing, but not what it said before.

### File retention

The object is deleted immediately. Where an attachment is evidentiary material,
retention is usually an obligation with a deadline rather than a preference.

| Option | Why not |
|---|---|
| **Immediate deletion** | **Chosen.** It avoids accumulating material that was explicitly asked to be removed |
| A trash prefix expiring after 30 days | Introduces an intermediate state, and without roles there is nobody to decide a restore |
| Cold storage for years | Cloudflare R2 offers no archive tier equivalent to Glacier. If long retention were a requirement, that would argue for S3 |

**Guarantee adopted: no file is left orphaned.** The object is deleted before the
database is touched; if that fails, the database is untouched and the operation errors.
Retrying works, because deleting an object that no longer exists does not fail.

### The file contents are not inspected

Even with `HeadObject`, the API does not inspect **the content**. An executable renamed to
`.pdf` and declared as one passes every check: it exists, weighs what was declared, and its
type matches the signature.

Why the risk is accepted: the file is **never served from the application's domain**. It
lives in private storage, is delivered through a signed link with a download disposition,
so its content cannot execute in the web's context. The risk sits on the downloader's
machine, which is where it already was.

**How it would be resolved.** Check the first bytes during confirmation — a ranged request
downloads eight bytes and verifies a PDF starts with `%PDF` and a PNG with `‰PNG` — and an
asynchronous antivirus scan afterwards.

### Rate limiting is approximate

The counter lives in each instance's memory. On a serverless platform several instances
serve in parallel and share no state, so the effective limit multiplies by the number of
active instances.

**How it would be resolved.** A shared counter store. It is the same constraint that makes
a circuit breaker unworkable here: both patterns need state between requests, and the
serverless model does not guarantee it.

### The file routes have no rate limit

Only the authentication routes are limited. A signed-in user can ask for upload links in a
loop and upload to each one, and every upload is a paid storage operation. The damage is
bounded: an object never confirmed is deleted after 24 hours, and each weighs at most
the size limit. A lock per case — no new link while one awaits confirmation — was
considered and dropped: it does not stop someone who opens a thousand cases, and it blocks
the honest user who closed the tab mid-upload until the link expires.

**How it would be resolved.** A per-user limit on the file routes, which inherits the
limitation above.

### A lost connection while saving can leave a spare file

Storage and the database cannot change in one transaction. If the connection drops while
a confirmation writes the file onto its case, the API cannot know whether the database
will still commit that write, so it keeps the copy rather than risk a case pointing at a
deleted file. If the write never lands and the user never confirms again, that copy stays
in `users/…` with no case referring to it; its path is in the log.

**How it would be resolved.** A scheduled job comparing the bucket with the database —
which a serverless deployment cannot host — or a table of pending writes reconciled on
the next request.

### The upload link is not tied to one file

A link accepts any bytes of the signed type until it expires, and each `PUT` overwrites the
previous one. Confirmation checks whatever is there at that moment: its size and type, not
that it is the file the user picked.

**How it would be resolved — not yet verified on R2.** The browser computes the file's
SHA-256 and sends it when asking for the link; the API signs it into the `PUT`, and storage
rejects any other bytes. S3 supports this; R2's documentation does not say whether it
does. It would replace the adapter's current rule of signing no checksum at all, which
exists because the API never holds the file to compute one.

### The token cannot be revoked

A JWT is stateless: the server keeps no list of active sessions. While the token has not
expired it is valid, and **there is no way to invalidate it**. There is no "sign out
everywhere" and no way to revoke a single session. A stolen token is usable for up to 8
hours.

What mitigates it: travelling in an `httpOnly` cookie, a cross-site scripting attack cannot
read it. What remains is theft through machine access or a compromised browser.

Why 8 hours: OWASP's session management guidance sets the absolute timeout by how long
the application is normally used, and suggests 4 to 8 hours for one used through a working
day. Shorter, and without a renewal mechanism the token would expire mid-task: the next
save answers `401` and whatever was being typed is lost. Longer buys nothing, since nobody
works a case for a whole day, and only widens the window a stolen token stays usable.

**How it would be resolved.** Two options, in increasing cost:

| Option | What it buys | Cost |
|---|---|---|
| **A sessions table** | The token carries a session identifier; the server keeps a row it can mark as revoked. Real revocation, sign-out-everywhere, and a visible "active sessions" list | One extra query on every authenticated request. Statelessness is partly given up |
| **Short access token plus rotating refresh token** | The industry default. A stolen access token stops working within minutes | The hard part is not the concept but concurrency: when several requests expire at once they all try to renew, and rotation invalidates the token the others are using. A single-flight lock is required on the client |

Neither is implemented. The sessions table is the better value per hour and is the first
candidate if the scope ever widens.

### Pagination is not exposed in the interface

The listing is bounded on the server at 100 cases, the most recent first by default. Past
that, the older ones are not returned — but not silently: `total` tells the client how many
match, so it can say that some are missing. The envelope accepts pagination fields without
breaking consumers. Only the page parameters and the controls are missing.

### `db:up` does not know whether `.env` points at Docker or at Neon

RNF-10 requires a fresh database on every start, so the script runs
`docker compose down --volumes` and then applies migrations unconditionally. If `.env` is
ever pointed at Neon instead of the local container — for example to work locally against
the remote database — the destroy step only reaches Docker, but the migration step still
runs against whatever `DIRECT_URL` resolves to. There is no check in between.

**How it would be resolved.** Have the script refuse to continue unless `DIRECT_URL`
resolves to `localhost`, so pointing `.env` at Neon fails loudly instead of migrating it by
accident.
