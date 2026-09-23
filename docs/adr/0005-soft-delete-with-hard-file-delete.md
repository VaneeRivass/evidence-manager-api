# ADR-0005 · Soft delete for the record, real destruction of the file

**Status:** accepted · **Date:** 2026-09-22

## Context

The brief asks that deleting a case removes the record and, if it has one, the object in
storage as well. It also lists soft delete among the additions it values when explained.

A case is a record with traceability value: it matters to know what existed and when it was
withdrawn. The attached binary, on the other hand, takes up space and costs money, and
keeping it after an explicit request to delete is justified neither by audit nor by cost.

There is also a consistency problem: the database and storage are **two distinct systems
with no shared transaction**. Either can fail on its own.

## Decision

Deleting a case sets its `deletedAt` column instead of removing the row, and **the object
is genuinely destroyed**.

The order is not arbitrary:

```
1. Destroy the object in storage
2. If it fails → return an error without touching the database. The user retries
3. If it succeeds → set deletedAt and clear the file reference
```

The other way round would lose the object's key before deleting it, and the orphan would be
permanent. In this order, a failure halfway is fixed by retrying, because **destroying an
object that no longer exists does not produce an error**.

From outside the API the behaviour is indistinguishable from a hard delete: the response is
`204`, the case disappears from the list, and reading, updating or deleting it again
returns `404` even knowing its identifier.

## Alternatives considered

**Removing the row.** That is what the brief describes literally. Rejected because it loses
traceability while gaining nothing: the row occupies a few hundred bytes.

**Keeping the binary too, in a trash area with an expiry.** Copying it to a `trash/` prefix
and letting a bucket rule expire it after thirty days. Rejected because it introduces an
intermediate state the brief does not contemplate and, without roles, there is nobody to
decide a restore.

**Cold storage for multi-year retention.** Cloudflare R2 offers no tier equivalent to
Glacier. If long-term retention were a requirement, that would be an argument for S3.

**Forbidding deletion of closed cases.** Considered and rejected: blocking deletion while
allowing edits has no principle behind it. If a closed case were a finished record that
must not be touched, editing would be forbidden too — and immutability was already dropped
because, without a change log, it guarantees nothing changed after closing but says nothing
about what it held before.

## Consequences

**In favour.** Who created what, when, under which title and when it was withdrawn are all
preserved. No orphaned objects: retrying always converges. And no requirement observable
through the API is broken.

**Against.** **Every case query must filter on the deletion marker.** Forgetting it in a
single route shows deleted records, and it is a silent failure. This is mitigated by
concentrating every case query in one service file and in the middleware that loads the
case, which every `/cases/:id` route passes through.

**What is not preserved.** Traceability reaches the metadata. The file's content is
destroyed, and without a change log there is no record of the status transitions that
preceded the deletion either.
