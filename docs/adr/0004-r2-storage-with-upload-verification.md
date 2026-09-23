# ADR-0004 · Cloudflare R2, with real verification of the upload

**Status:** accepted · **Date:** 2026-09-22

## Context

The file must not cross the API: the backend issues a presigned URL and the browser uploads
and downloads directly against storage.

One detail of that mechanism shapes everything else. **A presigned `PUT` signs the address,
the method and the content type — but not the byte count.** The client declares it will
upload two megabytes, that declaration is validated, the URL is signed, and then five
hundred can be uploaded with the same URL. Storage accepts it because the signature is
valid.

And the brief is explicit about confirmation: *persist the file reference after the upload,
not blindly before it.*

## Decision

**Cloudflare R2**, which implements the S3 protocol, using the official AWS SDK.

**Confirmation does not trust the client.** Before storing the reference, the API asks
storage what is actually there, with `HeadObject`:

| What is checked | Without that check |
|---|---|
| The object exists | Ghost records: the case shows an attachment whose download always fails |
| Its real size | The declared limit is never verified |
| Its real type | Something other than what was validated ends up stored |
| The key belongs to that case and user | Someone could attach an object that is not theirs |

If size or type do not match, the object **is destroyed** before the request is rejected:
otherwise it would sit there consuming space with no case claiming it.

The signature also points at a temporary area, `pending/`. Confirmation moves the object to
its final location, and a bucket lifecycle rule destroys anything left unconfirmed for
twenty-four hours. So someone who uploads a file and closes the tab leaves no permanent
orphan, and no cleanup process is needed — which a deployment without permanent servers
could not host anyway.

## Alternatives considered

**AWS S3.** Same protocol, but it charges for every download. R2 charges nothing for
egress, which is where the bill surprises people.

**Vercel Blob.** Its client upload uses a token of its own rather than an S3 presigned URL.
It would satisfy the spirit of the brief but would not exercise the pattern it asks for.

**Trusting the `200 OK` storage returns to the browser.** That is the signal the upload
succeeded, but it reaches the client, and the client can lie: calling confirmation with an
invented key without having uploaded anything is enough.

## Consequences

**In favour.** The binary never consumes the API's memory or execution time. Switching
provider is three environment variables, because the code speaks the S3 protocol rather
than Cloudflare's. And the verification closes three holes with a single call.

**Against.** One extra round trip to storage on every confirmation, plus the copy that
moves the object out of the temporary area. Around two hundred milliseconds in total,
happening in the background while the interface shows progress.

**What remains uncovered.** The API never sees the bytes during the upload, so an
executable renamed to `.pdf` and declared as one passes every check. This is accepted
because the file is never served from the application's domain: it lives in a private
bucket, is delivered through a signed link with a download disposition, and so its content
cannot execute in the web's context. The full mitigation — verifying the first bytes and an
asynchronous antivirus scan — is out of scope.
