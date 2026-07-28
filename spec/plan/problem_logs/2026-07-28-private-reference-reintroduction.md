# Private Reference Reintroduction

- Date: 2026-07-28
- Status: fixed in working tree
- Area: host database ownership documentation
- Severity: security hygiene regression

## Summary

A previously removed private-project identifier was reintroduced in a source-code comment on the remote default branch. This is a regression because the repository had already completed a private-reference cleanup.

## Evidence

- Remote source commit: `20a266edd3507509f072149fffc7745a85813d04`
- Affected file: `host/plugin-db.ts`
- A case-insensitive scan using the external audit term set found one match in the current tree.
- The broader LUDIARS private-reference scan found no other matches.

## Regression Context

The 2026-07-27 history cleanup recorded zero remaining bus-related identifiers, URLs, and route details. A later default-branch update contained an example identifier that matched the removed project vocabulary.

## Cause

A documentation example used a project-derived identifier instead of a neutral placeholder.

## Fix Requirements

- Replace the project-derived example with a generic plugin prefix.
- Keep the current source tree free of every term in the external audit set.
- Publish the sanitized tree as a fresh root commit without the old repository history.

## Verification

- Re-run the specific and broader external audit term sets against the staged snapshot.
- Confirm the new repository contains exactly one commit on `main`.
- Confirm no test or generated output reintroduces the removed vocabulary.

## Follow-up

Keep the old repository private and archived after transfer. Apply the same pre-publication scan when recreating the remaining affected repositories.
